import { Router } from 'express';
import { z } from 'zod';
import { SanctionType } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { moderationService, warnThresholdSchema, type AntiRaidConfigInput } from '../../../src/services/ModerationService';
import { antiRaidService } from '../../../src/services/AntiRaidService';
import { antiNukeService, ANTI_NUKE_ACTIONS, ANTI_NUKE_PUNISHMENTS, type AntiNukeAction } from '../../../src/services/AntiNukeService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema, discordIdArray, optionalDiscordId, optionalText, checkbox, pageQuery } from '../../lib/validate';
import { jsonArray } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserNames } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const PAGE_SIZE = 20;
const TABS = ['config', 'antiraid', 'lockdown', 'sanctions', 'warnings', 'stats'] as const;

export const SANCTION_TYPE_LABELS: Record<SanctionType, string> = {
  BAN: 'Bannissement',
  TEMPBAN: 'Ban temporaire',
  UNBAN: 'Débannissement',
  KICK: 'Expulsion',
  WARN: 'Avertissement',
  UNWARN: 'Avertissement retiré',
  TIMEOUT: 'Exclusion temporaire',
  UNTIMEOUT: 'Fin d’exclusion',
  MUTE: 'Mute',
  UNMUTE: 'Unmute',
  PURGE: 'Purge',
  LOCK: 'Salon verrouillé',
  UNLOCK: 'Salon déverrouillé',
  SLOWMODE: 'Mode lent',
  LOCKDOWN: 'Lockdown',
  LOCKDOWN_END: 'Fin de lockdown',
};
const NEGATIVE_TYPES = new Set<SanctionType>(['BAN', 'TEMPBAN', 'KICK', 'WARN', 'TIMEOUT', 'MUTE', 'LOCKDOWN', 'LOCK']);

const pageQuerySchema = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'config'), z.enum(TABS)),
  type: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(SanctionType).optional()),
  user: z.preprocess((v) => (v === '' ? undefined : v), discordIdSchema.optional()),
  case: z.preprocess((v) => (v === '' || v === undefined ? undefined : Number(v)), z.number().int().positive().optional()),
  warnUser: z.preprocess((v) => (v === '' ? undefined : v), discordIdSchema.optional()),
  page: pageQuery,
});

/** Seuil saisi dans l'éditeur : durée en minutes → secondes. */
const thresholdInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const t = v as Record<string, unknown>;
  const out: Record<string, unknown> = { count: Number(t.count), action: t.action };
  const minutes = t.durationMinutes !== undefined && t.durationMinutes !== '' ? Number(t.durationMinutes) : typeof t.duration === 'number' ? t.duration / 60 : undefined;
  if (minutes !== undefined && Number.isFinite(minutes) && (t.action === 'TIMEOUT' || t.action === 'TEMPBAN')) out.duration = Math.round(minutes * 60);
  return out;
}, warnThresholdSchema);

const configBody = z.object({
  thresholdsJson: jsonArray(thresholdInput, 25),
  muteRoleId: optionalDiscordId,
  dmOnSanction: checkbox,
});

const num = (min: number, max: number, def: number) => z.preprocess((v) => (v === '' || v === undefined ? def : Number(v)), z.number().int().min(min).max(max));
const domainList = z.preprocess((v) => (typeof v === 'string' ? v.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean) : Array.isArray(v) ? v : []), z.array(z.string().max(253)).max(100));

/** Champs `antiNuke_<action>_max` / `antiNuke_<action>_seconds` du formulaire (un par action surveillée). */
const antiNukeThresholdFields = Object.fromEntries(ANTI_NUKE_ACTIONS.flatMap((a) => [[`antiNuke_${a}_max`, num(1, 100, 1)], [`antiNuke_${a}_seconds`, num(1, 600, 10)]])) as Record<`antiNuke_${AntiNukeAction}_max` | `antiNuke_${AntiNukeAction}_seconds`, ReturnType<typeof num>>;

const antiRaidBody = z.object({
  antiNukeEnabled: checkbox,
  antiNukeBotAdd: checkbox,
  antiNukePunishment: z.enum(ANTI_NUKE_PUNISHMENTS).default('STRIP_ROLES'),
  antiNukeLockdown: checkbox,
  antiNukeRestoreBans: checkbox,
  antiNukeDm: checkbox,
  antiNukeExemptTeam: checkbox,
  antiNukeWhitelist: z.preprocess((v) => (typeof v === 'string' ? v.split(/[\s,;]+/).filter(Boolean) : v), discordIdArray),
  ...antiNukeThresholdFields,
  exemptRoleIds: discordIdArray,
  exemptChannelIds: discordIdArray,
  antiSpamEnabled: checkbox,
  antiSpamMaxMessages: num(2, 50, 6),
  antiSpamIntervalSeconds: num(1, 120, 5),
  antiSpamTimeoutMinutes: num(1, 28 * 1440, 10),
  antiMassMentionEnabled: checkbox,
  antiMassMentionMax: num(2, 100, 5),
  antiMassMentionTimeoutMinutes: num(1, 28 * 1440, 10),
  antiLinkEnabled: checkbox,
  antiLinkBlockInvites: checkbox,
  antiLinkBlockLinks: checkbox,
  antiLinkWhitelist: domainList,
  antiLinkAction: z.enum(['DELETE', 'TIMEOUT']).default('DELETE'),
  antiLinkTimeoutMinutes: num(1, 28 * 1440, 5),
  antiNewAccountEnabled: checkbox,
  antiNewAccountMinAgeDays: num(1, 365, 7),
  antiNewAccountAction: z.enum(['KICK', 'QUARANTINE']).default('KICK'),
  antiNewAccountQuarantineRoleId: optionalDiscordId,
  antiBotEnabled: checkbox,
  antiBotAllowedIds: z.preprocess((v) => (typeof v === 'string' ? v.split(/[\s,;]+/).filter(Boolean) : v), discordIdArray),
  antiMassJoinEnabled: checkbox,
  antiMassJoinMax: num(2, 500, 10),
  antiMassJoinIntervalSeconds: num(1, 600, 10),
  antiMassJoinLockdown: checkbox,
});

const ANTI_NUKE_ACTION_LABELS: { key: AntiNukeAction; label: string }[] = [
  { key: 'ban', label: 'Bannissements' },
  { key: 'kick', label: 'Expulsions' },
  { key: 'channelDelete', label: 'Suppressions de salons' },
  { key: 'channelCreate', label: 'Créations de salons' },
  { key: 'roleDelete', label: 'Suppressions de rôles' },
  { key: 'roleCreate', label: 'Créations de rôles' },
  { key: 'webhookCreate', label: 'Créations de webhooks' },
  { key: 'memberRoleUpdate', label: 'Attributions de rôles dangereux' },
  { key: 'pruneMembers', label: 'Prunes de membres' },
];

const lockdownBody = z.object({ enabled: checkbox, reason: optionalText(300) });
const warningParams = z.object({ warningId: z.coerce.number().int().positive() });
const reasonBody = z.object({ reason: optionalText(300) });
const clearBody = z.object({ userId: discordIdSchema, reason: optionalText(300) });

/** Pages Modération : configuration, anti-raid, lockdown, sanctions, avertissements, statistiques. */
export function createModerationRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/moderation`;

  router.get(
    '/moderation',
    validate({ query: pageQuerySchema }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof pageQuerySchema>>(req);
      const [modConfig, sanctions, stats, selectedCase, warnings] = await Promise.all([
        moderationService.getConfig(guild.id),
        moderationService.listSanctions(guild.id, { type: query.type, userId: query.user, page: query.page, pageSize: PAGE_SIZE }),
        moderationService.stats(guild.id, 30),
        query.case ? moderationService.getCase(guild.id, query.case) : Promise.resolve(null),
        query.warnUser ? moderationService.getWarnings(guild.id, query.warnUser, { activeOnly: false }) : Promise.resolve([]),
      ]);
      const names = await resolveUserNames(client, guild.id, [...sanctions.items.flatMap((s) => [s.userId, s.moderatorId]), selectedCase?.userId, selectedCase?.moderatorId, query.warnUser, ...warnings.map((w) => w.moderatorId), modConfig.lockdownState?.actorId]);
      const baseQuery = new URLSearchParams({ tab: 'sanctions', ...(query.type ? { type: query.type } : {}), ...(query.user ? { user: query.user } : {}) }).toString();
      const types = Object.values(SanctionType);
      const statTotal = Math.max(...types.map((t) => stats.byType[t] ?? 0), 1);
      render(res, 'moderation', {
        title: 'Modération',
        page: 'moderation',
        tab: query.tab,
        filters: query,
        modConfig,
        antiRaid: modConfig.antiRaid,
        antiNukeActions: ANTI_NUKE_ACTION_LABELS,
        sanctions: sanctions.items,
        pagination: { page: sanctions.page, pages: sanctions.pages, total: sanctions.total, pageSize: PAGE_SIZE },
        baseQuery,
        selectedCase,
        warnings,
        stats,
        statRows: types.filter((t) => (stats.byType[t] ?? 0) > 0).map((t) => ({ type: t, label: SANCTION_TYPE_LABELS[t], count: stats.byType[t] ?? 0, pct: Math.round(((stats.byType[t] ?? 0) / statTotal) * 1000) / 10 })),
        names,
        sanctionTypes: types.map((t) => ({ value: t, label: SANCTION_TYPE_LABELS[t], negative: NEGATIVE_TYPES.has(t) })),
        typeLabels: SANCTION_TYPE_LABELS,
        negativeTypes: [...NEGATIVE_TYPES],
        modules: { moderation: config.modules.moderation, antiraid: config.modules.antiraid },
      });
    }),
  );

  router.post(
    '/moderation/config',
    validate({ body: configBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=config`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof configBody>>(req);
        if (body.muteRoleId && !guild.roles.some((r) => r.id === body.muteRoleId)) throw new HttpError(400, 'Rôle mute inconnu.');
        await moderationService.updateConfig(guild.id, { warnThresholds: body.thresholdsJson, muteRoleId: body.muteRoleId, dmOnSanction: body.dmOnSanction });
        broadcastToGuild(guild.id, 'moderation:update', { guildId: guild.id, kind: 'config' });
        flash(req, 'success', `Configuration enregistrée (${body.thresholdsJson.length} seuil(s) d’escalade).`);
      },
    ),
  );

  router.post(
    '/moderation/antiraid',
    validate({ body: antiRaidBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=antiraid`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body: b } = valid<z.infer<typeof antiRaidBody>>(req);
        const input: AntiRaidConfigInput = {
          exemptRoleIds: [...new Set(b.exemptRoleIds)],
          exemptChannelIds: [...new Set(b.exemptChannelIds)],
          antiSpam: { enabled: b.antiSpamEnabled, maxMessages: b.antiSpamMaxMessages, intervalSeconds: b.antiSpamIntervalSeconds, timeoutSeconds: b.antiSpamTimeoutMinutes * 60 },
          antiMassMention: { enabled: b.antiMassMentionEnabled, maxMentions: b.antiMassMentionMax, timeoutSeconds: b.antiMassMentionTimeoutMinutes * 60 },
          antiLink: { enabled: b.antiLinkEnabled, blockInvites: b.antiLinkBlockInvites, blockLinks: b.antiLinkBlockLinks, whitelistDomains: b.antiLinkWhitelist, action: b.antiLinkAction, timeoutSeconds: b.antiLinkTimeoutMinutes * 60 },
          antiNewAccount: { enabled: b.antiNewAccountEnabled, minAgeDays: b.antiNewAccountMinAgeDays, action: b.antiNewAccountAction, quarantineRoleId: b.antiNewAccountQuarantineRoleId },
          antiBot: { enabled: b.antiBotEnabled, allowedBotIds: [...new Set(b.antiBotAllowedIds)] },
          antiMassJoin: { enabled: b.antiMassJoinEnabled, maxJoins: b.antiMassJoinMax, intervalSeconds: b.antiMassJoinIntervalSeconds, lockdown: b.antiMassJoinLockdown },
          antiNuke: {
            enabled: b.antiNukeEnabled,
            botAddProtection: b.antiNukeBotAdd,
            punishment: b.antiNukePunishment,
            lockdownOnTrigger: b.antiNukeLockdown,
            restoreBans: b.antiNukeRestoreBans,
            dmExecutor: b.antiNukeDm,
            exemptTeamRoles: b.antiNukeExemptTeam,
            whitelistUserIds: [...new Set(b.antiNukeWhitelist)],
            thresholds: Object.fromEntries(ANTI_NUKE_ACTIONS.map((a) => [a, { max: b[`antiNuke_${a}_max`], intervalSeconds: b[`antiNuke_${a}_seconds`] }])),
          },
        };
        if (input.antiNewAccount!.action === 'QUARANTINE' && !input.antiNewAccount!.quarantineRoleId) throw new HttpError(400, 'Choisissez un rôle de quarantaine pour l’action « Quarantaine ».');
        await moderationService.updateAntiRaidConfig(guild.id, input);
        antiRaidService.invalidate(guild.id);
        antiNukeService.invalidate(guild.id);
        broadcastToGuild(guild.id, 'moderation:update', { guildId: guild.id, kind: 'antiraid' });
        flash(req, 'success', 'Protections anti-raid enregistrées.');
      },
    ),
  );

  router.post(
    '/moderation/lockdown',
    validate({ body: lockdownBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=lockdown`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof lockdownBody>>(req);
        if (!client.isReady()) throw new HttpError(503, "Le bot n'est pas connecté : le lockdown ne peut pas être modifié.");
        const result = await moderationService.setLockdown(guild.id, body.enabled, req.session.user!.id, body.reason ?? null);
        broadcastToGuild(guild.id, 'moderation:update', { guildId: guild.id, kind: 'lockdown', enabled: body.enabled });
        if (!result.changed) flash(req, 'info', body.enabled ? 'Le lockdown est déjà actif.' : 'Aucun lockdown actif.');
        else flash(req, 'success', `${body.enabled ? 'Lockdown activé' : 'Lockdown levé'} : ${result.channels} salon(s) modifié(s)${result.failed ? `, ${result.failed} échec(s)` : ''}.`);
      },
    ),
  );

  router.post(
    '/moderation/warnings/:warningId(\\d+)/remove',
    validate({ params: warningParams, body: reasonBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=warnings${typeof req.body?.userId === 'string' ? `&warnUser=${encodeURIComponent(req.body.userId)}` : ''}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof reasonBody>, unknown, z.infer<typeof warningParams>>(req);
        const result = await moderationService.removeWarning(params.warningId, req.session.user!.id, body.reason ?? null, guild.id);
        if (!result) throw new HttpError(404, 'Avertissement introuvable ou déjà levé.');
        broadcastToGuild(guild.id, 'moderation:warning', { guildId: guild.id, userId: result.warning.userId, removed: params.warningId });
        flash(req, 'success', `Avertissement #${params.warningId} retiré (cas #${result.sanction.caseNumber}).`);
        return `${base(guild.id)}?tab=warnings&warnUser=${result.warning.userId}`;
      },
    ),
  );

  router.post(
    '/moderation/warnings/clear',
    validate({ body: clearBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=warnings${typeof req.body?.userId === 'string' ? `&warnUser=${encodeURIComponent(req.body.userId)}` : ''}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof clearBody>>(req);
        const result = await moderationService.clearWarnings(guild.id, body.userId, req.session.user!.id, body.reason ?? null);
        broadcastToGuild(guild.id, 'moderation:warning', { guildId: guild.id, userId: body.userId, cleared: result.cleared });
        flash(req, result.cleared ? 'success' : 'info', result.cleared ? `${result.cleared} avertissement(s) effacé(s).` : 'Aucun avertissement actif pour ce membre.');
      },
    ),
  );

  return router;
}
