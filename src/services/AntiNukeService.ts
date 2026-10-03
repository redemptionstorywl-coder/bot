import { AuditLogEvent, EmbedBuilder, PermissionFlagsBits, type Client, type Guild, type GuildAuditLogsEntry, type GuildMember, type User } from 'discord.js';
import type { SanctionType } from '@prisma/client';
import { prisma } from '../database/client';
import { guildConfigService, type ResolvedGuildConfig } from './GuildConfigService';
import { auditReason, moderationService, type AntiNukeAction, type AntiNukeConfig, type AntiNukePunishment } from './ModerationService';
import { SlidingWindow } from './AntiRaidService';
import { loggingService } from './LoggingService';
import { scheduler } from './SchedulerService';
import { translationService, type Translator } from './TranslationService';
import { env } from '../config/env';
import { BRAND } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { hasTeamRole } from '../utils/permissions';
import { childLogger } from '../utils/logger';

export { antiNukeConfigSchema, DEFAULT_ANTI_NUKE, ANTI_NUKE_ACTIONS, ANTI_NUKE_PUNISHMENTS, type AntiNukeAction, type AntiNukeConfig, type AntiNukeConfigInput, type AntiNukePunishment } from './ModerationService';

const log = childLogger('AntiNukeService');

/** Permissions considérées dangereuses : un rôle qui en porte une est retiré par la punition STRIP_ROLES. */
export const DANGEROUS_PERMISSIONS: readonly bigint[] = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageWebhooks,
];

/** Correspondance type d'audit log → action anti-nuke. */
const AUDIT_TO_ACTION: Partial<Record<AuditLogEvent, AntiNukeAction>> = {
  [AuditLogEvent.MemberBanAdd]: 'ban',
  [AuditLogEvent.MemberKick]: 'kick',
  [AuditLogEvent.ChannelDelete]: 'channelDelete',
  [AuditLogEvent.ChannelCreate]: 'channelCreate',
  [AuditLogEvent.RoleDelete]: 'roleDelete',
  [AuditLogEvent.RoleCreate]: 'roleCreate',
  [AuditLogEvent.WebhookCreate]: 'webhookCreate',
  [AuditLogEvent.MemberRoleUpdate]: 'memberRoleUpdate',
  [AuditLogEvent.MemberPrune]: 'pruneMembers',
};

/** Forme minimale d'un rôle pour `dangerousRoles` (compatible Role de discord.js). */
export interface RoleLike {
  id: string;
  permissions: { has(permission: bigint): boolean };
  managed?: boolean;
}

/** Rôles portant au moins une permission dangereuse (les rôles gérés par une intégration ne peuvent pas être retirés). */
export function dangerousRoles<R extends RoleLike>(roles: Iterable<R>): R[] {
  const out: R[] = [];
  for (const role of roles) {
    if (role.managed) continue;
    if (DANGEROUS_PERMISSIONS.some((p) => role.permissions.has(p))) out.push(role);
  }
  return out;
}

export interface ExemptionInput {
  executorId: string;
  guildOwnerId: string;
  botId: string;
  cfg: AntiNukeConfig;
  /** env().OWNER_IDS */
  ownerIds?: readonly string[];
  /** Membre exécuteur (pour `exemptTeamRoles`) */
  member?: GuildMember | null;
  gcfg?: ResolvedGuildConfig | null;
}

/** Exemptions : bot lui-même, propriétaire, OWNER_IDS, whitelist, et (option) rôles équipe / admin configurés. */
export function isExemptExecutor(input: ExemptionInput): boolean {
  const { executorId, cfg } = input;
  if (executorId === input.botId || executorId === input.guildOwnerId) return true;
  if ((input.ownerIds ?? []).includes(executorId)) return true;
  if (cfg.whitelistUserIds.includes(executorId)) return true;
  if (cfg.exemptTeamRoles && input.member) {
    if (hasTeamRole(input.member)) return true;
    if (input.gcfg?.adminRoleIds.some((r) => input.member!.roles.cache.has(r))) return true;
  }
  return false;
}

/** Déclencheur : une action surveillée, ou l'ajout d'un bot (`botAddProtection`). */
export type AntiNukeTrigger = AntiNukeAction | 'botAdd';

export interface Evaluation {
  action: AntiNukeTrigger;
  count: number;
  max: number;
  intervalSeconds: number;
  /** Seuil atteint : la fenêtre a été réinitialisée. */
  triggered: boolean;
}

export interface PunishmentOutcome {
  /** Punition effectivement appliquée (`NONE` : échec ou exécuteur introuvable) */
  applied: AntiNukePunishment | 'BOT_BAN' | 'NONE';
  /** Clé i18n (moderation.antinuke.results.*) décrivant le résultat */
  resultKey: string;
  strippedRoleIds: string[];
}

export interface TriggerResult {
  evaluation: Evaluation;
  outcome: PunishmentOutcome;
  caseNumber: number | null;
  restoredBans: number;
  lockdown: boolean;
}

/**
 * Anti-nuke : protège contre une application externe ou un compte compromis qui bannit en masse,
 * supprime salons / rôles, crée des webhooks… L'exécuteur est lu dans l'audit log
 * (`Events.GuildAuditLogEntryCreate`, fallback `fetchAuditLogs`), compté en fenêtre glissante par
 * action, puis puni (strip des rôles dangereux / kick / ban ; un bot est toujours banni).
 * Tout en mémoire : zéro requête SQL par événement (config via le cache de ModerationService).
 */
export class AntiNukeService {
  private client: Client | null = null;
  readonly windows = new SlidingWindow();
  /** Entrées d'audit log déjà traitées (id) : dédoublonnage événement gateway + fallback. */
  private readonly seenEntries = new TTLCache<true>(5 * 60_000, 20_000);
  /** Serveurs dont le flux GuildAuditLogEntryCreate est actif : le fallback fetchAuditLogs y est inutile. */
  private readonly liveGuilds = new TTLCache<true>(10 * 60_000, 5000);
  /** Exécuteur déjà puni récemment : évite une double punition pendant la même rafale. */
  private readonly punished = new TTLCache<true>(60_000, 5000);
  /** Bans effectués par un exécuteur (clé guild:executor) pour `restoreBans`. */
  private readonly bansByExecutor = new Map<string, { userId: string; at: number }[]>();

  attach(client: Client): void {
    this.client = client;
    if (!scheduler.registered.includes('antinuke:gc')) {
      scheduler.register({
        name: 'antinuke:gc',
        intervalMs: 60_000,
        run: async () => {
          this.windows.gc(15 * 60_000);
          const min = Date.now() - 15 * 60_000;
          for (const [key, list] of this.bansByExecutor) {
            const kept = list.filter((b) => b.at > min);
            if (kept.length) this.bansByExecutor.set(key, kept);
            else this.bansByExecutor.delete(key);
          }
        },
      });
    }
  }

  get attached(): boolean {
    return this.client !== null;
  }

  // ─────────────────────────── Config ───────────────────────────

  async getConfig(guildId: string): Promise<AntiNukeConfig> {
    return (await moderationService.getAntiRaidConfig(guildId)).antiNuke;
  }

  /** Remplace la configuration anti-nuke complète (validée par Zod). */
  async updateConfig(guildId: string, antiNuke: AntiNukeConfig): Promise<AntiNukeConfig> {
    const cfg = await moderationService.updateAntiRaidConfig(guildId, { antiNuke });
    this.invalidate(guildId);
    return cfg.antiNuke;
  }

  /** Invalide le cache de config + les fenêtres du serveur (commande / dashboard). */
  invalidate(guildId: string): void {
    moderationService.invalidate(guildId);
    this.windows.resetPrefix(guildId);
    this.punished.invalidatePrefix(`${guildId}:`);
    for (const key of this.bansByExecutor.keys()) if (key.startsWith(`${guildId}:`)) this.bansByExecutor.delete(key);
  }

  /** Vrai si le flux d'audit log temps réel est actif pour ce serveur (le fallback peut être ignoré). */
  isLive(guildId: string): boolean {
    return this.liveGuilds.has(guildId);
  }

  // ─────────────────────────── Logique pure (testable) ───────────────────────────

  /**
   * Compte une action de l'exécuteur dans sa fenêtre glissante. Pure (hors mise à jour de la fenêtre) :
   * aucune I/O. Au franchissement du seuil la fenêtre est réinitialisée et `triggered` vaut true.
   */
  evaluate(guildId: string, executorId: string, action: AntiNukeAction, cfg: AntiNukeConfig, now = Date.now()): Evaluation {
    const threshold = cfg.thresholds[action];
    const key = `${guildId}:${executorId}:${action}`;
    const count = this.windows.hit(key, threshold.intervalSeconds * 1000, now);
    const triggered = count >= threshold.max;
    if (triggered) this.windows.reset(key);
    return { action, count, max: threshold.max, intervalSeconds: threshold.intervalSeconds, triggered };
  }

  /** Vrai si l'entrée d'audit log a déjà été traitée (et la marque comme vue sinon). */
  markSeen(guildId: string, entryId: string): boolean {
    const key = `${guildId}:${entryId}`;
    if (this.seenEntries.has(key)) return true;
    this.seenEntries.set(key, true);
    return false;
  }

  /** Action anti-nuke correspondant à une entrée d'audit log, ou null si non surveillée. */
  actionFor(entry: GuildAuditLogsEntry, guild: Guild): AntiNukeAction | null {
    const action = AUDIT_TO_ACTION[entry.action];
    if (!action) return null;
    if (action === 'memberRoleUpdate') {
      // Seul l'ajout d'un rôle à permissions dangereuses compte.
      const added = entry.changes.filter((c) => c.key === '$add').flatMap((c) => (Array.isArray(c.new) ? (c.new as { id: string }[]) : []));
      const roles = added.map((r) => guild.roles.cache.get(r.id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
      return dangerousRoles(roles).length ? action : null;
    }
    return action;
  }

  // ─────────────────────────── Handlers Discord ───────────────────────────

  /**
   * Point d'entrée principal (`Events.GuildAuditLogEntryCreate`). Également appelé par les fallbacks
   * (entrée récupérée via fetchAuditLogs) : le dédoublonnage par id rend l'appel idempotent.
   */
  async handleAuditEntry(entry: GuildAuditLogsEntry, guild: Guild, opts: { live?: boolean } = {}): Promise<TriggerResult | null> {
    if (opts.live !== false) this.liveGuilds.set(guild.id, true);
    const executorId = entry.executorId;
    if (!executorId) return null;
    const botId = guild.client.user?.id ?? '';
    if (executorId === botId) return null;
    if (this.markSeen(guild.id, entry.id)) return null;

    const gcfg = await guildConfigService.get(guild.id);
    if (!gcfg?.modules.antiraid) return null;
    const cfg = await this.getConfig(guild.id);
    if (!cfg.enabled) return null;

    if (entry.action === AuditLogEvent.BotAdd) {
      if (!cfg.botAddProtection || !entry.targetId) return null;
      return this.handleBotAdd(guild, entry.targetId, executorId, cfg, gcfg);
    }

    const action = this.actionFor(entry, guild);
    if (!action) return null;
    const member = cfg.exemptTeamRoles ? await guild.members.fetch(executorId).catch(() => null) : null;
    if (isExemptExecutor({ executorId, guildOwnerId: guild.ownerId, botId, cfg, ownerIds: env().OWNER_IDS, member, gcfg })) return null;

    if (action === 'ban' && entry.targetId) {
      const key = `${guild.id}:${executorId}`;
      const list = this.bansByExecutor.get(key) ?? [];
      list.push({ userId: entry.targetId, at: entry.createdTimestamp });
      this.bansByExecutor.set(key, list);
    }

    const evaluation = this.evaluate(guild.id, executorId, action, cfg, entry.createdTimestamp);
    if (!evaluation.triggered) return null;
    return this.trigger(guild, executorId, evaluation, cfg, gcfg);
  }

  /**
   * Fallback sans `GuildAuditLogEntryCreate` : cherche l'entrée récente dans l'audit log puis la traite.
   * Ignoré si le flux temps réel est actif pour ce serveur.
   */
  async handleFallback(guild: Guild, type: AuditLogEvent, targetId?: string | null): Promise<void> {
    if (this.isLive(guild.id)) return;
    const gcfg = await guildConfigService.get(guild.id);
    if (!gcfg?.modules.antiraid) return;
    const cfg = await this.getConfig(guild.id);
    if (!cfg.enabled) return;
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
    const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
    if (!logs) return;
    const now = Date.now();
    const entry = logs.entries.find((e) => now - e.createdTimestamp < 15_000 && (!targetId || e.targetId === targetId));
    if (!entry) return;
    await this.handleAuditEntry(entry as GuildAuditLogsEntry, guild, { live: false });
  }

  /** Bot ajouté : expulsé (sauf ajouteur exempté) et l'ajouteur est puni. */
  async handleBotAdd(guild: Guild, botUserId: string, executorId: string, cfg: AntiNukeConfig, gcfg: ResolvedGuildConfig): Promise<TriggerResult | null> {
    const botId = guild.client.user?.id ?? '';
    const member = cfg.exemptTeamRoles ? await guild.members.fetch(executorId).catch(() => null) : null;
    if (isExemptExecutor({ executorId, guildOwnerId: guild.ownerId, botId, cfg, ownerIds: env().OWNER_IDS, member, gcfg })) return null;
    const { t } = await moderationService.guildTranslator(guild.id);
    const addedBot = await guild.members.fetch(botUserId).catch(() => null);
    let kicked = false;
    if (addedBot?.kickable) {
      moderationService.markRecent(guild.id, 'kick', botUserId);
      kicked = await addedBot.kick(auditReason(guild.client.user ?? { id: botId }, t('moderation.antinuke.reasons.bot_add'))).then(() => true).catch(() => false);
      if (!kicked) moderationService.consumeRecent(guild.id, 'kick', botUserId);
    }
    const evaluation: Evaluation = { action: 'botAdd', count: 1, max: 1, intervalSeconds: 0, triggered: true };
    return this.trigger(guild, executorId, evaluation, cfg, gcfg, { botUserId, botKicked: kicked });
  }

  // ─────────────────────────── Déclenchement ───────────────────────────

  private async trigger(guild: Guild, executorId: string, evaluation: Evaluation, cfg: AntiNukeConfig, gcfg: ResolvedGuildConfig, extra: { botUserId?: string; botKicked?: boolean } = {}): Promise<TriggerResult | null> {
    const punishKey = `${guild.id}:${executorId}`;
    if (this.punished.has(punishKey)) return null;
    this.punished.set(punishKey, true);

    const { t, lang } = await moderationService.guildTranslator(guild.id);
    const bot = guild.client.user;
    if (!bot) return null;
    const actionLabel = t(`moderation.antinuke.actions.${evaluation.action}`);
    const reason = evaluation.action === 'botAdd' ? t('moderation.antinuke.reasons.bot_add') : t('moderation.antinuke.reasons.trigger', { count: evaluation.count, action: actionLabel, seconds: evaluation.intervalSeconds });

    const executorMember = await guild.members.fetch(executorId).catch(() => null);
    const executorUser = executorMember?.user ?? (await guild.client.users.fetch(executorId).catch(() => null));
    const outcome = await this.punish(guild, executorId, executorMember, cfg.punishment, auditReason(bot, reason));

    // Sanction (case) : type le plus proche de la punition appliquée.
    const type: SanctionType = outcome.applied === 'BAN' || outcome.applied === 'BOT_BAN' ? 'BAN' : outcome.applied === 'KICK' ? 'KICK' : 'WARN';
    const sanction = await moderationService
      .createSanction({ guildId: guild.id, type, userId: executorId, moderatorId: bot.id, reason, metadata: { antiNuke: true, trigger: evaluation.action, count: evaluation.count, max: evaluation.max, intervalSeconds: evaluation.intervalSeconds, punishment: outcome.applied, strippedRoleIds: outcome.strippedRoleIds, botUserId: extra.botUserId ?? null } })
      .catch((err) => {
        log.error({ err, guild: guild.id }, 'Anti-nuke : création de la case impossible');
        return null;
      });
    if (type === 'BAN' && outcome.applied !== 'NONE') {
      await prisma.ban.updateMany({ where: { guildId: guild.id, userId: executorId, active: true }, data: { active: false } }).catch(() => null);
      await prisma.ban.create({ data: { guildId: guild.id, userId: executorId, moderatorId: bot.id, reason } }).catch(() => null);
    }

    // Lockdown optionnel.
    let lockdown = false;
    if (cfg.lockdownOnTrigger) {
      lockdown = await moderationService
        .setLockdown(guild.id, true, bot.id, reason)
        .then((r) => r.changed)
        .catch((err) => {
          log.error({ err, guild: guild.id }, 'Anti-nuke : lockdown impossible');
          return false;
        });
    }

    // Rétablissement des bans effectués par l'exécuteur.
    let restoredBans = 0;
    if (evaluation.action === 'ban' && cfg.restoreBans && outcome.applied !== 'NONE') restoredBans = await this.restoreBans(guild, executorId, evaluation.intervalSeconds, t);

    // DM à l'exécuteur humain.
    let dmSent = false;
    if (cfg.dmExecutor && executorUser && !executorUser.bot) dmSent = await this.dmExecutor(guild, executorUser, evaluation, outcome, sanction?.caseNumber ?? null);

    await this.alert(guild, gcfg, t, lang, { executorId, executorUser, evaluation, outcome, sanction: sanction?.caseNumber ?? null, restoredBans, lockdown, dmSent, extra });
    return { evaluation, outcome, caseNumber: sanction?.caseNumber ?? null, restoredBans, lockdown };
  }

  /** Applique la punition configurée. Un bot exécuteur est banni quelle que soit la punition. */
  private async punish(guild: Guild, executorId: string, member: GuildMember | null, punishment: AntiNukePunishment, auditLabel: string): Promise<PunishmentOutcome> {
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    const none = (resultKey: string): PunishmentOutcome => ({ applied: 'NONE', resultKey, strippedRoleIds: [] });
    if (!me) return none('moderation.antinuke.results.failed');

    const isBot = member?.user.bot ?? false;
    const wantBan = isBot || punishment === 'BAN';

    if (wantBan) {
      if (member && !member.bannable) return none('moderation.antinuke.results.hierarchy');
      if (!me.permissions.has(PermissionFlagsBits.BanMembers)) return none('moderation.antinuke.results.missing_permissions');
      moderationService.markRecent(guild.id, 'ban', executorId);
      const ok = await guild.members.ban(executorId, { reason: auditLabel }).then(() => true).catch(() => false);
      if (!ok) {
        moderationService.consumeRecent(guild.id, 'ban', executorId);
        return none('moderation.antinuke.results.failed');
      }
      return { applied: isBot ? 'BOT_BAN' : 'BAN', resultKey: isBot ? 'moderation.antinuke.results.bot_banned' : 'moderation.antinuke.results.banned', strippedRoleIds: [] };
    }

    if (!member) return none('moderation.antinuke.results.not_found');
    if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) return none('moderation.antinuke.results.hierarchy');

    if (punishment === 'KICK') {
      if (!member.kickable) return none('moderation.antinuke.results.hierarchy');
      moderationService.markRecent(guild.id, 'kick', executorId);
      const ok = await member.kick(auditLabel).then(() => true).catch(() => false);
      if (!ok) {
        moderationService.consumeRecent(guild.id, 'kick', executorId);
        return none('moderation.antinuke.results.failed');
      }
      return { applied: 'KICK', resultKey: 'moderation.antinuke.results.kicked', strippedRoleIds: [] };
    }

    // STRIP_ROLES
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return none('moderation.antinuke.results.missing_permissions');
    const roles = member.roles.cache.filter((r) => r.id !== guild.id);
    const dangerous = dangerousRoles(roles.values());
    if (!dangerous.length) return none('moderation.antinuke.results.no_dangerous_roles');
    const dangerousIds = new Set(dangerous.map((r) => r.id));
    const keep = roles.filter((r) => !dangerousIds.has(r.id));
    moderationService.markRecent(guild.id, 'roles', executorId);
    const ok = await member.roles.set(keep, auditLabel).then(() => true).catch(() => false);
    if (!ok) {
      moderationService.consumeRecent(guild.id, 'roles', executorId);
      return none('moderation.antinuke.results.failed');
    }
    return { applied: 'STRIP_ROLES', resultKey: 'moderation.antinuke.results.stripped', strippedRoleIds: [...dangerousIds] };
  }

  private async restoreBans(guild: Guild, executorId: string, intervalSeconds: number, t: Translator): Promise<number> {
    const key = `${guild.id}:${executorId}`;
    const list = this.bansByExecutor.get(key) ?? [];
    this.bansByExecutor.delete(key);
    const min = Date.now() - Math.max(intervalSeconds, 60) * 1000;
    const bot = guild.client.user;
    let restored = 0;
    for (const { userId, at } of list) {
      if (at < min || userId === executorId) continue;
      moderationService.markRecent(guild.id, 'unban', userId);
      const ok = await guild.bans.remove(userId, auditReason(bot ?? { id: executorId }, t('moderation.antinuke.reasons.restore', { executor: executorId }))).then(() => true).catch(() => false);
      if (!ok) {
        moderationService.consumeRecent(guild.id, 'unban', userId);
        continue;
      }
      restored++;
      await prisma.ban.updateMany({ where: { guildId: guild.id, userId, active: true }, data: { active: false } }).catch(() => null);
    }
    return restored;
  }

  private async dmExecutor(guild: Guild, user: User, evaluation: Evaluation, outcome: PunishmentOutcome, caseNumber: number | null): Promise<boolean> {
    const gcfg = await guildConfigService.get(guild.id);
    const lang = await translationService.resolveLanguage({ guildId: guild.id, userId: user.id, guildDefault: gcfg?.defaultLanguage, enabledLanguages: gcfg?.enabledLanguages });
    const t = translationService.bind(lang, guild.id);
    const embed = new EmbedBuilder()
      .setColor(BRAND.colors.danger)
      .setTitle(t('moderation.antinuke.dm.title', { server: guild.name }))
      .setDescription(t('moderation.antinuke.dm.description', { server: guild.name, action: t(`moderation.antinuke.actions.${evaluation.action}`), count: evaluation.count, seconds: evaluation.intervalSeconds, punishment: t(outcome.resultKey, { count: outcome.strippedRoleIds.length }) }))
      .setFooter({ text: `${caseNumber ? `${t('moderation.case', { number: caseNumber })} • ` : ''}${BRAND.footer}` })
      .setTimestamp();
    return user.send({ embeds: [embed] }).then(() => true).catch(() => false);
  }

  /** Alerte rouge dans SECURITY (+ MODERATION si distinct) avec mention des rôles admin configurés. */
  private async alert(
    guild: Guild,
    gcfg: ResolvedGuildConfig,
    t: Translator,
    lang: string,
    info: { executorId: string; executorUser: User | null; evaluation: Evaluation; outcome: PunishmentOutcome; sanction: number | null; restoredBans: number; lockdown: boolean; dmSent: boolean; extra: { botUserId?: string; botKicked?: boolean } },
  ): Promise<void> {
    const { evaluation, outcome } = info;
    const actionLabel = t(`moderation.antinuke.actions.${evaluation.action}`);
    const title = t('moderation.antinuke.log_title', { action: actionLabel });
    const description =
      evaluation.action === 'botAdd'
        ? t('moderation.antinuke.log_bot_add', { executor: `<@${info.executorId}>`, bot: info.extra.botUserId ? `<@${info.extra.botUserId}>` : t('core.none'), kicked: info.extra.botKicked ? t('core.yes') : t('core.no') })
        : t('moderation.antinuke.log_description', { executor: `<@${info.executorId}>`, count: evaluation.count, action: actionLabel, seconds: evaluation.intervalSeconds, max: evaluation.max });
    const executorLine = `<@${info.executorId}>${info.executorUser ? ` • ${info.executorUser.tag}` : ''} (\`${info.executorId}\`)`;
    const fields = [
      { name: t('moderation.antinuke.fields.executor'), value: executorLine, inline: true },
      { name: t('moderation.antinuke.fields.punishment'), value: `${t(outcome.resultKey, { count: outcome.strippedRoleIds.length })}${info.sanction ? ` (${t('moderation.case', { number: info.sanction })})` : ''}`, inline: true },
      { name: t('moderation.antinuke.fields.dm'), value: info.dmSent ? t('core.yes') : t('core.no'), inline: true },
    ];
    if (outcome.strippedRoleIds.length) fields.push({ name: t('moderation.antinuke.fields.stripped_roles'), value: outcome.strippedRoleIds.map((id) => `<@&${id}>`).join(' '), inline: false });
    if (evaluation.action === 'ban') fields.push({ name: t('moderation.antinuke.fields.restored_bans'), value: String(info.restoredBans), inline: true });
    if (info.lockdown) fields.push({ name: t('moderation.antinuke.fields.lockdown'), value: t('core.yes'), inline: true });

    await loggingService.log({
      guildId: guild.id,
      category: 'SECURITY',
      action: `antinuke.${evaluation.action}`,
      title,
      description,
      fields,
      actorId: guild.client.user?.id ?? null,
      targetId: info.executorId,
      color: BRAND.colors.danger,
      thumbnail: info.executorUser?.displayAvatarURL({ size: 128 }),
      data: { trigger: evaluation.action, count: evaluation.count, max: evaluation.max, intervalSeconds: evaluation.intervalSeconds, punishment: outcome.applied, strippedRoleIds: outcome.strippedRoleIds, restoredBans: info.restoredBans, lockdown: info.lockdown, caseNumber: info.sanction, lang },
    });

    // Ping des rôles admin configurés : message (avec contenu) dans SECURITY et MODERATION.
    if (!gcfg.modules.logs) return;
    const mentions = gcfg.adminRoleIds.map((id) => `<@&${id}>`).join(' ');
    const content = mentions ? t('moderation.antinuke.ping', { roles: mentions }) : null;
    const secChannel = gcfg.logChannels.SECURITY ?? gcfg.logChannels.SYSTEM;
    const modChannel = gcfg.logChannels.MODERATION;
    const embed = new EmbedBuilder().setColor(BRAND.colors.danger).setTitle(title).setDescription(description).addFields(fields).setTimestamp().setFooter({ text: BRAND.footer });
    const targets = new Set<string>();
    if (modChannel && modChannel !== secChannel) targets.add(modChannel);
    if (content && secChannel) targets.add(secChannel);
    for (const channelId of targets) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel?.isTextBased()) continue;
      const payload = channelId === secChannel ? { content: content ?? undefined, allowedMentions: { roles: gcfg.adminRoleIds } } : { content: content ?? undefined, embeds: [embed], allowedMentions: { roles: gcfg.adminRoleIds } };
      await channel.send(payload).catch(() => null);
    }
  }
}

export const antiNukeService = new AntiNukeService();
