import { Router } from 'express';
import { z } from 'zod';
import type { GuildMember } from 'discord.js';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { validate, valid, discordIdSchema, checkbox, optionalText } from '../../lib/validate';
import { HttpError } from '../../lib/errors';
import { resolveUserProfiles, requireBotGuild } from '../../lib/names';
import { formAction } from '../../lib/serviceErrors';
import { flash } from '../../lib/flash';
import { broadcastToGuild } from '../../sockets';
import { moderationService } from '../../../src/services/ModerationService';
import { fivemService } from '../../../src/services/FiveMService';
import { fivemSyncService } from '../../../src/services/FiveMSyncService';
import { banGameTargets, defaultBanInGame } from '../../../src/services/fivem/sync';
import { canModerate } from '../../../src/utils/permissions';
import { parseDuration } from '../../../src/utils/time';
import { SANCTION_TYPE_LABELS } from './moderation';

const searchQuery = z.object({ q: z.string().trim().max(100).optional().default('') });
const memberParams = z.object({ guildId: discordIdSchema, userId: discordIdSchema });
/** Bannir depuis la fiche membre : durée vide = définitif ; `inGame` = case « Aussi en jeu (FiveM) ». */
const banBody = z.object({ reason: optionalText(512), duration: optionalText(32), inGame: checkbox });
const unbanBody = z.object({ reason: optionalText(512), inGame: checkbox });

/** Résumé « en jeu » d'un ban / unban du dashboard (serveurs FiveM qui reçoivent l'action). */
function gameSummary(count: number, hasServers: boolean, inGame: boolean): string {
  if (!hasServers) return '';
  if (!inGame || !count) return ' Non appliqué en jeu.';
  return ` Envoyé à ${count} serveur(s) FiveM.`;
}
const LIMIT = 50;

interface MemberRow {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bot: boolean;
  joinedAt: Date | null;
  roles: { id: string; name: string; color: string }[];
  roleCount: number;
}

function toRow(member: GuildMember): MemberRow {
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#a1a1aa' : r.hexColor }));
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 64 }),
    bot: member.user.bot,
    joinedAt: member.joinedAt,
    roles: roles.slice(0, 4),
    roleCount: roles.length,
  };
}

/** GET /guilds/:guildId/members (+ /members/:userId) — lecture seule. */
export function createMembersRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/members',
    validate({ query: searchQuery }),
    wrap(async (req, res) => {
      const guildView = res.locals.guild!;
      const { query } = valid<unknown, z.infer<typeof searchQuery>>(req);
      const guild = client.guilds.cache.get(guildView.id);
      if (!guild) throw new HttpError(503, 'Serveur indisponible.');
      let members: GuildMember[] = [];
      if (query.q) {
        if (/^\d{15,22}$/.test(query.q)) {
          const one = await guild.members.fetch({ user: query.q }).catch(() => null);
          members = one ? [one] : [];
        } else {
          const found = await guild.members.fetch({ query: query.q, limit: LIMIT }).catch(() => null);
          members = found ? [...found.values()] : [...guild.members.cache.filter((m) => m.displayName.toLowerCase().includes(query.q.toLowerCase()) || m.user.username.toLowerCase().includes(query.q.toLowerCase())).values()].slice(0, LIMIT);
        }
      } else {
        if (guild.members.cache.size < Math.min(LIMIT, guild.memberCount)) await guild.members.fetch({ limit: LIMIT }).catch(() => null);
        members = [...guild.members.cache.values()].sort((a, b) => (b.joinedTimestamp ?? 0) - (a.joinedTimestamp ?? 0)).slice(0, LIMIT);
      }
      render(res, 'members', {
        title: 'Membres',
        page: 'members',
        q: query.q,
        members: members.map((m) => toRow(m)),
        cached: guild.members.cache.size,
        total: guild.memberCount,
      });
    }),
  );

  router.get(
    '/members/:userId',
    validate({ params: memberParams }),
    wrap(async (req, res) => {
      const guildView = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof memberParams>>(req);
      const guild = client.guilds.cache.get(guildView.id);
      if (!guild) throw new HttpError(503, 'Serveur indisponible.');
      const member = await guild.members.fetch({ user: params.userId }).catch(() => null);
      const user = member?.user ?? (await client.users.fetch(params.userId).catch(() => null));
      if (!user) throw new HttpError(404, 'Membre introuvable.');
      const [warnings, sanctions, tickets, dbUser, players, fivemServers, ban] = await Promise.all([
        prisma.warning.findMany({ where: { guildId: guild.id, userId: params.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        prisma.sanction.findMany({ where: { guildId: guild.id, userId: params.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        prisma.ticket.findMany({ where: { guildId: guild.id, userId: params.userId }, orderBy: { createdAt: 'desc' }, take: 50, include: { type: true } }),
        prisma.user.findUnique({ where: { id: params.userId } }),
        // Joueurs FiveM liés à ce compte Discord (lecture seule)
        prisma.fiveMPlayer.findMany({ where: { guildId: guild.id, discordId: params.userId }, orderBy: { lastSeenAt: 'desc' }, take: 5 }),
        fivemService.listServers(guild.id),
        Promise.resolve()
          .then(() => guild.bans.fetch({ user: params.userId, force: true }))
          .catch(() => null),
      ]);
      const moderators = await resolveUserProfiles(client, guild.id, [...(sanctions ?? []).map((s) => s.moderatorId), ...(warnings ?? []).map((w) => w.moderatorId)]);
      const roles = member
        ? member.roles.cache
            .filter((r) => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#a1a1aa' : r.hexColor }))
        : [];
      render(res, 'member', {
        title: member?.displayName ?? user.username,
        page: 'members',
        member: {
          id: user.id,
          username: user.username,
          displayName: member?.displayName ?? user.globalName ?? user.username,
          avatarUrl: (member ?? user).displayAvatarURL({ size: 128 }),
          bot: user.bot,
          createdAt: user.createdAt,
          joinedAt: member?.joinedAt ?? null,
          inGuild: Boolean(member),
          roles,
          timeoutUntil: member?.communicationDisabledUntil ?? null,
          knownSince: dbUser?.createdAt ?? null,
        },
        warnings: warnings ?? [],
        sanctions: sanctions ?? [],
        tickets: tickets ?? [],
        players: players ?? [],
        banState: { banned: Boolean(ban), reason: ban?.reason ?? null, fivem: fivemServers.length > 0, inGameDefault: defaultBanInGame(fivemServers), canBan: !user.bot && user.id !== guild.ownerId && user.id !== client.user?.id },
        moderators,
        sanctionLabels: SANCTION_TYPE_LABELS,
        crumbs: [{ label: member?.displayName ?? user.username }],
      });
    }),
  );

  // ───── Bannir / débannir depuis la fiche (case « Aussi en jeu ») ─────

  router.post(
    '/members/:userId/ban',
    validate({ params: memberParams, body: banBody }),
    formAction(
      (req, res) => `/guilds/${res.locals.guild!.id}/members/${String(req.params.userId)}`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof banBody>, unknown, z.infer<typeof memberParams>>(req);
        const guild = requireBotGuild(client, guildView.id);
        const actorId = req.session.user!.id;
        if (params.userId === actorId) throw new HttpError(400, 'Vous ne pouvez pas vous bannir vous-même.');
        if (params.userId === guild.ownerId || params.userId === client.user?.id) throw new HttpError(400, 'Ce compte ne peut pas être banni.');
        const duration = body.duration ? parseDuration(body.duration) : null;
        if (body.duration && (!duration || duration <= 0)) throw new HttpError(400, 'Durée invalide. Exemples : 30m, 1h30m, 2d, 1w.');
        const target = await client.users.fetch(params.userId).catch(() => null);
        if (!target) throw new HttpError(404, 'Utilisateur introuvable.');
        const [member, actorMember] = await Promise.all([guild.members.fetch(params.userId).catch(() => null), guild.members.fetch(actorId).catch(() => null)]);
        if (member) {
          if (actorMember && !canModerate(actorMember, member)) throw new HttpError(403, 'Son rôle le plus élevé est supérieur ou égal au vôtre.');
          if (!member.bannable) throw new HttpError(400, 'Le bot ne peut pas bannir ce membre (rôle supérieur ou égal au sien).');
        }
        const moderator = (await client.users.fetch(actorId).catch(() => null)) ?? target.client.user;
        const servers = await fivemService.listServers(guild.id);
        fivemSyncService.prepareDiscordBan('ban', guild.id, params.userId, body.inGame);
        try {
          const result = await moderationService.ban({ guild, target, moderator, reason: body.reason ?? null, duration, metadata: { source: 'dashboard' } });
          broadcastToGuild(guild.id, 'moderation:update', { guildId: guild.id, kind: 'ban', userId: params.userId });
          flash(req, 'success', `${target.username} banni${duration ? ' temporairement' : ''} (cas #${result.sanction.caseNumber}).${gameSummary(banGameTargets(servers, body.inGame).length, servers.length > 0, body.inGame)}`);
        } catch (err) {
          fivemSyncService.abortDiscordBan('ban', guild.id, params.userId);
          throw err;
        }
      },
    ),
  );

  router.post(
    '/members/:userId/unban',
    validate({ params: memberParams, body: unbanBody }),
    formAction(
      (req, res) => `/guilds/${res.locals.guild!.id}/members/${String(req.params.userId)}`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof unbanBody>, unknown, z.infer<typeof memberParams>>(req);
        const guild = requireBotGuild(client, guildView.id);
        const moderator = (await client.users.fetch(req.session.user!.id).catch(() => null)) ?? client.user!;
        const servers = await fivemService.listServers(guild.id);
        const banned = await guild.bans.fetch({ user: params.userId, force: true }).catch(() => null);
        if (!banned) {
          // Pas banni de Discord : débannissement en jeu seulement (si la case est cochée).
          const count = body.inGame ? await fivemSyncService.pushBanToGame(guild, params.userId, 'unban', true) : 0;
          if (!count) throw new HttpError(400, 'Ce membre n’est pas banni de Discord.');
          flash(req, 'success', `Pas de ban Discord : débannissement envoyé à ${count} serveur(s) FiveM.`);
          return;
        }
        fivemSyncService.prepareDiscordBan('unban', guild.id, params.userId, body.inGame);
        try {
          const result = await moderationService.unban({ guild, userId: params.userId, moderator, reason: body.reason ?? null, metadata: { source: 'dashboard' } });
          broadcastToGuild(guild.id, 'moderation:update', { guildId: guild.id, kind: 'unban', userId: params.userId });
          flash(req, 'success', `Débanni (cas #${result.sanction.caseNumber}).${gameSummary(banGameTargets(servers, body.inGame).length, servers.length > 0, body.inGame)}`);
        } catch (err) {
          fivemSyncService.abortDiscordBan('unban', guild.id, params.userId);
          throw err;
        }
      },
    ),
  );

  return router;
}
