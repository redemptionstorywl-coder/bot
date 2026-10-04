import { AuditLogEvent, PermissionFlagsBits, type Client, type GuildMember, type Message } from 'discord.js';
import { guildConfigService, type ResolvedGuildConfig } from './GuildConfigService';
import { moderationService, type AntiRaidConfig } from './ModerationService';
import { loggingService } from './LoggingService';
import { scheduler } from './SchedulerService';
import { BRAND } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';

export { antiRaidConfigSchema, DEFAULT_ANTI_RAID, type AntiRaidConfig, type AntiRaidConfigInput } from './ModerationService';

const log = childLogger('AntiRaidService');

const INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|discord\.me)\/[\w-]+/i;
const URL_REGEX = /https?:\/\/([^\s/]+)/gi;

export type AntiRaidTrigger = 'spam' | 'mass_mention' | 'invite' | 'link' | 'new_account' | 'bot' | 'mass_join';

export interface MessageVerdict {
  trigger: AntiRaidTrigger;
  /** Supprimer le message */
  delete: boolean;
  /** Durée du timeout en secondes (0 = aucun) */
  timeoutSeconds: number;
}

/**
 * Fenêtre glissante en mémoire : compte les événements par clé sur `intervalMs`.
 * Aucune I/O ; purgée périodiquement par `gc()`.
 */
export class SlidingWindow {
  private readonly buckets = new Map<string, number[]>();

  /** Enregistre un événement et retourne le nombre d'événements dans la fenêtre. */
  hit(key: string, intervalMs: number, now = Date.now()): number {
    const list = this.buckets.get(key) ?? [];
    const min = now - intervalMs;
    const kept = list.filter((ts) => ts > min);
    kept.push(now);
    this.buckets.set(key, kept);
    return kept.length;
  }

  count(key: string, intervalMs: number, now = Date.now()): number {
    const list = this.buckets.get(key);
    if (!list) return 0;
    const min = now - intervalMs;
    return list.filter((ts) => ts > min).length;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Supprime toutes les clés égales à `prefix` ou commençant par `prefix:`. */
  resetPrefix(prefix: string): void {
    for (const k of this.buckets.keys()) if (k === prefix || k.startsWith(`${prefix}:`)) this.buckets.delete(k);
  }

  /** Supprime les entrées sans événement depuis `maxAgeMs`. */
  gc(maxAgeMs: number, now = Date.now()): number {
    let removed = 0;
    for (const [key, list] of this.buckets) {
      const last = list[list.length - 1];
      if (last === undefined || last < now - maxAgeMs) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Extrait les domaines (hôtes) des URLs http(s) d'un texte. */
export function extractDomains(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(URL_REGEX)) {
    const host = m[1]?.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
    if (host) out.push(host);
  }
  return out;
}

export function containsInvite(content: string): boolean {
  return INVITE_REGEX.test(content);
}

/** Vrai si `host` est le domaine ou un sous-domaine d'une entrée de la liste blanche. */
export function isWhitelisted(host: string, whitelist: string[]): boolean {
  return whitelist.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Anti-raid : anti-spam, anti-mass-mention, anti-lien / invitation, anti-compte récent,
 * anti-bot, anti-mass-join (→ lockdown). Tout en mémoire, zéro requête SQL par message :
 * config serveur via guildConfigService (cache) + ModerationConfig via moderationService (cache TTL).
 */
export class AntiRaidService {
  private client: Client | null = null;
  readonly messages = new SlidingWindow();
  readonly joins = new SlidingWindow();
  /** Utilisateurs déjà sanctionnés récemment : évite de ré-appliquer un timeout pendant la fenêtre. */
  private readonly punished = new TTLCache<true>(15_000, 10_000);
  /** Lockdown automatique déjà déclenché récemment pour ce serveur. */
  private readonly lockdownTriggered = new TTLCache<true>(60_000, 1000);
  /** Contrôles d'arrivée en cours / récents (`guild:user` → expulsé ?), partagés entre les écouteurs guildMemberAdd. */
  private readonly screenings = new TTLCache<Promise<boolean>>(30_000, 5000);

  attach(client: Client): void {
    this.client = client;
    if (!scheduler.registered.includes('antiraid:gc')) {
      scheduler.register({
        name: 'antiraid:gc',
        intervalMs: 60_000,
        run: async () => {
          this.messages.gc(5 * 60_000);
          this.joins.gc(15 * 60_000);
        },
      });
    }
  }

  get attached(): boolean {
    return this.client !== null;
  }

  // ─────────────────────────── Config ───────────────────────────

  getConfig(guildId: string): Promise<AntiRaidConfig> {
    return moderationService.getAntiRaidConfig(guildId);
  }

  updateConfig(guildId: string, partial: Parameters<typeof moderationService.updateAntiRaidConfig>[1]): Promise<AntiRaidConfig> {
    return moderationService.updateAntiRaidConfig(guildId, partial);
  }

  /** Invalide le cache de config + les fenêtres du serveur (appelé par le dashboard). */
  invalidate(guildId: string): void {
    moderationService.invalidate(guildId);
    this.messages.resetPrefix(guildId);
    this.joins.resetPrefix(guildId);
    this.punished.invalidatePrefix(`${guildId}:`);
    this.lockdownTriggered.delete(guildId);
  }

  // ─────────────────────────── Exemptions ───────────────────────────

  isExempt(member: GuildMember, gcfg: ResolvedGuildConfig, cfg: AntiRaidConfig, channelId?: string | null): boolean {
    if (member.user.bot && member.id === member.client.user?.id) return true;
    if (member.guild.ownerId === member.id) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
    const roles = member.roles.cache;
    if (gcfg.adminRoleIds.some((r) => roles.has(r)) || gcfg.staffRoleIds.some((r) => roles.has(r))) return true;
    if (cfg.exemptRoleIds.some((r) => roles.has(r))) return true;
    if (channelId && cfg.exemptChannelIds.includes(channelId)) return true;
    return false;
  }

  // ─────────────────────────── Analyse pure (testable) ───────────────────────────

  /**
   * Évalue un message sans effet de bord Discord (hors mise à jour de la fenêtre anti-spam).
   * Retourne le verdict le plus sévère ou null.
   */
  evaluateMessage(input: { guildId: string; userId: string; content: string; mentionCount: number; now?: number }, cfg: AntiRaidConfig): MessageVerdict | null {
    const now = input.now ?? Date.now();
    const key = `${input.guildId}:${input.userId}`;

    if (cfg.antiSpam.enabled) {
      const count = this.messages.hit(key, cfg.antiSpam.intervalSeconds * 1000, now);
      if (count >= cfg.antiSpam.maxMessages) {
        this.messages.reset(key);
        return { trigger: 'spam', delete: true, timeoutSeconds: cfg.antiSpam.timeoutSeconds };
      }
    }

    if (cfg.antiMassMention.enabled && input.mentionCount >= cfg.antiMassMention.maxMentions) {
      return { trigger: 'mass_mention', delete: true, timeoutSeconds: cfg.antiMassMention.timeoutSeconds };
    }

    if (cfg.antiLink.enabled) {
      const timeout = cfg.antiLink.action === 'TIMEOUT' ? cfg.antiLink.timeoutSeconds : 0;
      if (cfg.antiLink.blockInvites && containsInvite(input.content)) return { trigger: 'invite', delete: true, timeoutSeconds: timeout };
      if (cfg.antiLink.blockLinks) {
        const domains = extractDomains(input.content);
        if (domains.some((d) => !isWhitelisted(d, cfg.antiLink.whitelistDomains))) return { trigger: 'link', delete: true, timeoutSeconds: timeout };
      }
    }
    return null;
  }

  /** Âge minimal : vrai si le compte est trop récent. */
  isAccountTooYoung(createdTimestamp: number, minAgeDays: number, now = Date.now()): boolean {
    return now - createdTimestamp < minAgeDays * 86400_000;
  }

  // ─────────────────────────── Handlers Discord ───────────────────────────

  async handleMessage(message: Message): Promise<void> {
    if (!message.inGuild() || message.author.bot || message.system) return;
    const gcfg = await guildConfigService.get(message.guildId);
    if (!gcfg?.modules.antiraid) return;
    const cfg = await moderationService.getAntiRaidConfig(message.guildId);
    if (!cfg.antiSpam.enabled && !cfg.antiMassMention.enabled && !cfg.antiLink.enabled) return;
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;
    if (this.isExempt(member, gcfg, cfg, message.channelId)) return;

    const mentionCount = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
    const verdict = this.evaluateMessage({ guildId: message.guildId, userId: member.id, content: message.content, mentionCount }, cfg);
    if (!verdict) return;

    const { t } = await moderationService.guildTranslator(message.guildId);
    const reason = t(`moderation.antiraid.reasons.${verdict.trigger}`);

    if (verdict.delete) {
      if (verdict.trigger === 'spam') await this.deleteRecentMessages(message, member.id);
      else await message.delete().catch(() => null);
    }

    let caseNumber: number | null = null;
    const punishKey = `${message.guildId}:${member.id}`;
    if (verdict.timeoutSeconds > 0 && !this.punished.has(punishKey) && member.moderatable) {
      this.punished.set(punishKey, true);
      try {
        const r = await moderationService.timeout({ guild: message.guild, target: member, moderator: message.client.user, reason, duration: verdict.timeoutSeconds, metadata: { antiraid: verdict.trigger } });
        caseNumber = r.sanction.caseNumber;
      } catch (err) {
        log.warn({ err, guild: message.guildId, user: member.id }, 'Anti-raid : timeout impossible');
      }
    } else if (verdict.timeoutSeconds > 0 && this.punished.has(punishKey)) {
      return; // déjà sanctionné et loggé pendant cette fenêtre
    }

    await loggingService.log({
      guildId: message.guildId,
      category: 'SECURITY',
      action: `antiraid.${verdict.trigger}`,
      title: t('moderation.antiraid.log_title', { trigger: t(`moderation.antiraid.triggers.${verdict.trigger}`) }),
      fields: [
        { name: t('core.user'), value: `<@${member.id}> • ${member.user.tag} (\`${member.id}\`)`, inline: true },
        { name: t('core.channel'), value: `<#${message.channelId}>`, inline: true },
        { name: t('moderation.antiraid.action_taken'), value: this.describeAction(t, verdict, caseNumber), inline: true },
        { name: t('moderation.fields.content'), value: message.content ? message.content.slice(0, 1000) : t('core.none'), inline: false },
      ],
      actorId: message.client.user.id,
      targetId: member.id,
      color: BRAND.colors.danger,
      thumbnail: member.user.displayAvatarURL({ size: 128 }),
      data: { trigger: verdict.trigger, channelId: message.channelId, caseNumber, content: message.content.slice(0, 500) },
    });
  }

  private describeAction(t: (k: string, v?: Record<string, string | number>) => string, verdict: MessageVerdict, caseNumber: number | null): string {
    const parts: string[] = [];
    if (verdict.delete) parts.push(t('moderation.antiraid.actions.deleted'));
    if (verdict.timeoutSeconds > 0) parts.push(caseNumber ? t('moderation.antiraid.actions.timeout_case', { number: caseNumber }) : t('moderation.antiraid.actions.timeout_failed'));
    return parts.join(' • ') || t('core.none');
  }

  private async deleteRecentMessages(message: Message<true>, userId: string): Promise<void> {
    const channel = message.channel;
    if (!('bulkDelete' in channel)) {
      await message.delete().catch(() => null);
      return;
    }
    const recent = channel.messages.cache.filter((m) => m.author.id === userId && Date.now() - m.createdTimestamp < 60_000);
    if (!recent.has(message.id)) recent.set(message.id, message);
    await channel.bulkDelete(recent, true).catch(async () => {
      await message.delete().catch(() => null);
    });
  }

  /**
   * Contrôle anti-raid d'une arrivée, mémoïsé 30 s par membre : l'écouteur anti-raid le déclenche et les autres
   * écouteurs `guildMemberAdd` (autoroles, bienvenue) l'attendent pour ne pas accueillir un membre aussitôt expulsé.
   * Ne lance jamais ; retourne true si le membre a été expulsé.
   */
  screenMember(member: GuildMember): Promise<boolean> {
    const key = `${member.guild.id}:${member.id}`;
    const pending = this.screenings.get(key);
    if (pending) return pending;
    const run = this.handleMemberAdd(member).catch((err) => {
      log.warn({ err, guild: member.guild.id, user: member.id }, 'Anti-raid : contrôle d’arrivée en erreur');
      return false;
    });
    this.screenings.set(key, run);
    return run;
  }

  /** Anti-bot / anti-mass-join / anti-compte récent. Retourne true si le membre a été expulsé. */
  async handleMemberAdd(member: GuildMember): Promise<boolean> {
    const gcfg = await guildConfigService.get(member.guild.id);
    if (!gcfg?.modules.antiraid) return false;
    const cfg = await moderationService.getAntiRaidConfig(member.guild.id);
    const { t } = await moderationService.guildTranslator(member.guild.id);
    const bot = member.client.user;

    // Anti-bot : bots non autorisés expulsés, sauf ajoutés par un admin.
    if (member.user.bot) {
      if (!cfg.antiBot.enabled || cfg.antiBot.allowedBotIds.includes(member.id)) return false;
      const executor = await this.findBotAdder(member);
      if (executor && this.isAdmin(executor, gcfg)) return false;
      if (!member.kickable) return false;
      const reason = t('moderation.antiraid.reasons.bot');
      const kicked = await moderationService
        .kick({ guild: member.guild, target: member, moderator: bot, reason, metadata: { antiraid: 'bot', addedBy: executor?.id ?? null } })
        .then(() => true)
        .catch((err) => {
          log.warn({ err }, 'Anti-bot : kick impossible');
          return false;
        });
      await this.logSecurity(member, 'bot', t, [{ name: t('moderation.fields.added_by'), value: executor ? `<@${executor.id}>` : t('core.none'), inline: true }]);
      return kicked;
    }

    // Anti-mass-join : fenêtre par serveur → lockdown automatique.
    if (cfg.antiMassJoin.enabled) {
      const count = this.joins.hit(member.guild.id, cfg.antiMassJoin.intervalSeconds * 1000);
      if (count >= cfg.antiMassJoin.maxJoins && !this.lockdownTriggered.has(member.guild.id)) {
        this.lockdownTriggered.set(member.guild.id, true);
        this.joins.reset(member.guild.id);
        const reason = t('moderation.antiraid.reasons.mass_join', { count, seconds: cfg.antiMassJoin.intervalSeconds });
        if (cfg.antiMassJoin.lockdown) {
          await moderationService.setLockdown(member.guild.id, true, bot.id, reason).catch((err) => log.error({ err, guild: member.guild.id }, 'Lockdown automatique impossible'));
        } else {
          await loggingService.log({ guildId: member.guild.id, category: 'SECURITY', action: 'antiraid.mass_join', title: t('moderation.antiraid.log_title', { trigger: t('moderation.antiraid.triggers.mass_join') }), description: reason, actorId: bot.id, color: BRAND.colors.danger, data: { count } });
        }
      }
    }

    // Anti-compte récent.
    let kicked = false;
    if (cfg.antiNewAccount.enabled && this.isAccountTooYoung(member.user.createdTimestamp, cfg.antiNewAccount.minAgeDays)) {
      const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86400_000);
      const reason = t('moderation.antiraid.reasons.new_account', { days: cfg.antiNewAccount.minAgeDays });
      let action = t('core.none');
      if (cfg.antiNewAccount.action === 'QUARANTINE' && cfg.antiNewAccount.quarantineRoleId) {
        const ok = await member.roles.add(cfg.antiNewAccount.quarantineRoleId, reason).then(() => true).catch(() => false);
        action = ok ? t('moderation.antiraid.actions.quarantined', { role: `<@&${cfg.antiNewAccount.quarantineRoleId}>` }) : t('moderation.antiraid.actions.quarantine_failed');
      } else if (member.kickable) {
        const r = await moderationService.kick({ guild: member.guild, target: member, moderator: bot, reason, metadata: { antiraid: 'new_account', ageDays } }).catch(() => null);
        kicked = !!r;
        action = r ? t('moderation.antiraid.actions.kicked_case', { number: r.sanction.caseNumber }) : t('moderation.antiraid.actions.kick_failed');
      }
      await this.logSecurity(member, 'new_account', t, [
        { name: t('moderation.fields.account_age'), value: t('moderation.antiraid.days', { days: ageDays }), inline: true },
        { name: t('moderation.antiraid.action_taken'), value: action, inline: true },
      ]);
    }
    return kicked;
  }

  private isAdmin(member: GuildMember, gcfg: ResolvedGuildConfig): boolean {
    if (member.guild.ownerId === member.id) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return gcfg.adminRoleIds.some((r) => member.roles.cache.has(r));
  }

  private async findBotAdder(member: GuildMember): Promise<GuildMember | null> {
    const me = member.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 }).catch(() => null);
    const entry = logs?.entries.find((e) => e.targetId === member.id && Date.now() - e.createdTimestamp < 60_000);
    if (!entry?.executorId) return null;
    return member.guild.members.fetch(entry.executorId).catch(() => null);
  }

  private async logSecurity(member: GuildMember, trigger: AntiRaidTrigger, t: (k: string, v?: Record<string, string | number>) => string, fields: { name: string; value: string; inline?: boolean }[]): Promise<void> {
    await loggingService.log({
      guildId: member.guild.id,
      category: 'SECURITY',
      action: `antiraid.${trigger}`,
      title: t('moderation.antiraid.log_title', { trigger: t(`moderation.antiraid.triggers.${trigger}`) }),
      fields: [{ name: t('core.user'), value: `<@${member.id}> • ${member.user.tag} (\`${member.id}\`)`, inline: true }, ...fields],
      actorId: member.client.user.id,
      targetId: member.id,
      color: BRAND.colors.danger,
      thumbnail: member.user.displayAvatarURL({ size: 128 }),
      data: { trigger },
    });
  }
}

export const antiRaidService = new AntiRaidService();
