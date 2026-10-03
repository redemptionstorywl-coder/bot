import { Router } from 'express';
import { z } from 'zod';
import type { GuildMember } from 'discord.js';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { LANGUAGES } from '../../../src/config/constants';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { validate, valid, discordIdSchema } from '../../lib/validate';
import { HttpError } from '../../lib/errors';

const searchQuery = z.object({ q: z.string().trim().max(100).optional().default('') });
const memberParams = z.object({ guildId: discordIdSchema, userId: discordIdSchema });
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
  language: string | null;
}

function toRow(member: GuildMember, language: string | null): MemberRow {
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
    language,
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
      const ids = members.map((m) => m.id);
      const langRows = ids.length ? await prisma.userLanguage.findMany({ where: { guildId: guild.id, userId: { in: ids } } }) : [];
      const langMap = new Map(langRows.map((r) => [r.userId, r.language]));
      render(res, 'members', {
        title: 'Membres',
        page: 'members',
        q: query.q,
        members: members.map((m) => toRow(m, langMap.get(m.id) ?? null)),
        languages: Object.fromEntries(LANGUAGES.map((l) => [l.code, l])),
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
      const [language, warnings, sanctions, tickets, dbUser] = await Promise.all([
        prisma.userLanguage.findUnique({ where: { userId_guildId: { userId: params.userId, guildId: guild.id } } }),
        prisma.warning.findMany({ where: { guildId: guild.id, userId: params.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        prisma.sanction.findMany({ where: { guildId: guild.id, userId: params.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        prisma.ticket.findMany({ where: { guildId: guild.id, userId: params.userId }, orderBy: { createdAt: 'desc' }, take: 50, include: { type: true } }),
        prisma.user.findUnique({ where: { id: params.userId } }),
      ]);
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
          language: language?.language ?? null,
          knownSince: dbUser?.createdAt ?? null,
        },
        languages: Object.fromEntries(LANGUAGES.map((l) => [l.code, l])),
        warnings,
        sanctions,
        tickets,
      });
    }),
  );

  return router;
}
