import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Collection,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type User,
} from 'discord.js';
import { Prisma, SanctionType, type Sanction, type Warning } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { CHANNELS_REMAPPED_EVENT, guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { translationService, type Translator } from './TranslationService';
import { scheduler } from './SchedulerService';
import { welcomeService } from './WelcomeService';
import { roleService } from './RoleService';
import { ticketService } from './TicketService';
import { eventService } from './EventService';
import { giveawayService } from './GiveawayService';
import { pollService } from './PollService';
import { BRAND } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { discordTimestamp, formatDuration } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('ModerationService');

// ─────────────────────────── Schémas Zod ───────────────────────────

const snowflake = z.string().regex(/^\d{15,22}$/, 'ID Discord attendu');

/** Seuil d'escalade : atteint quand le nombre d'avertissements actifs est EXACTEMENT `count`. */
export const warnThresholdSchema = z.object({
  count: z.number().int().min(1).max(100),
  action: z.enum(['TIMEOUT', 'KICK', 'BAN', 'TEMPBAN']),
  /** Durée en secondes (TIMEOUT / TEMPBAN). Défaut : 1h pour TIMEOUT, 24h pour TEMPBAN. */
  duration: z.number().int().min(60).max(365 * 86400).optional(),
});
export type WarnThreshold = z.infer<typeof warnThresholdSchema>;

export const DEFAULT_WARN_THRESHOLDS: WarnThreshold[] = [
  { count: 3, action: 'TIMEOUT', duration: 3600 },
  { count: 5, action: 'KICK' },
  { count: 7, action: 'BAN' },
];

/** Liste de seuils : triée par `count`, un seul seuil par valeur (le dernier gagne). */
export const warnThresholdsSchema = z
  .array(warnThresholdSchema)
  .max(25)
  .transform((list) => {
    const byCount = new Map<number, WarnThreshold>();
    for (const t of list) byCount.set(t.count, t);
    return [...byCount.values()].sort((a, b) => a.count - b.count);
  });

const domain = z
  .string()
  .min(1)
  .max(253)
  .transform((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));

/** Actions surveillées par l'anti-nuke (clé = type d'action dans l'audit log). */
export const ANTI_NUKE_ACTIONS = ['ban', 'kick', 'channelDelete', 'channelCreate', 'roleDelete', 'roleCreate', 'webhookCreate', 'memberRoleUpdate', 'pruneMembers'] as const;
export type AntiNukeAction = (typeof ANTI_NUKE_ACTIONS)[number];
export const ANTI_NUKE_PUNISHMENTS = ['STRIP_ROLES', 'KICK', 'BAN'] as const;
export type AntiNukePunishment = (typeof ANTI_NUKE_PUNISHMENTS)[number];

const nukeThreshold = (max: number, intervalSeconds: number) =>
  z
    .object({
      max: z.number().int().min(1).max(100).default(max),
      intervalSeconds: z.number().int().min(1).max(600).default(intervalSeconds),
    })
    .default({});

/**
 * Configuration anti-nuke (ModerationConfig.antiRaid.antiNuke) : seuils par action en fenêtre glissante
 * (exécuteur lu dans l'audit log), punition de l'exécuteur, protection contre l'ajout de bots.
 * Exemptés d'office : propriétaire du serveur, OWNER_IDS, le bot lui-même, `whitelistUserIds`.
 * Les rôles équipe / admin ne sont PAS exemptés sauf `exemptTeamRoles` (un compte compromis en porte souvent un).
 */
export const antiNukeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  thresholds: z
    .object({
      ban: nukeThreshold(3, 10),
      kick: nukeThreshold(3, 10),
      channelDelete: nukeThreshold(2, 10),
      channelCreate: nukeThreshold(5, 10),
      roleDelete: nukeThreshold(2, 10),
      roleCreate: nukeThreshold(5, 10),
      webhookCreate: nukeThreshold(2, 10),
      /** Ajout d'un rôle à permissions dangereuses à un membre */
      memberRoleUpdate: nukeThreshold(3, 10),
      pruneMembers: nukeThreshold(1, 60),
    })
    .default({}),
  /** Tout bot ajouté par un non-exempté est expulsé et l'ajouteur sanctionné */
  botAddProtection: z.boolean().default(true),
  /** STRIP_ROLES : retire les rôles à permissions dangereuses ; un bot exécuteur est toujours banni */
  punishment: z.enum(ANTI_NUKE_PUNISHMENTS).default('STRIP_ROLES'),
  lockdownOnTrigger: z.boolean().default(false),
  whitelistUserIds: z.array(snowflake).max(50).default([]),
  exemptTeamRoles: z.boolean().default(false),
  dmExecutor: z.boolean().default(true),
  /** Dé-bannir les membres bannis par l'exécuteur dans la fenêtre */
  restoreBans: z.boolean().default(true),
});
export type AntiNukeConfig = z.infer<typeof antiNukeConfigSchema>;
export type AntiNukeConfigInput = z.input<typeof antiNukeConfigSchema>;
export const DEFAULT_ANTI_NUKE: AntiNukeConfig = antiNukeConfigSchema.parse({});

/**
 * Configuration anti-raid (ModerationConfig.antiRaid). Chaque protection a `enabled` + ses paramètres.
 * `antiRaidConfigSchema.parse({})` renvoie la configuration par défaut complète.
 */
export const antiRaidConfigSchema = z.object({
  /** Rôles exemptés de toutes les protections (en plus du staff / admin) */
  exemptRoleIds: z.array(snowflake).max(50).default([]),
  /** Salons exemptés des protections de message */
  exemptChannelIds: z.array(snowflake).max(100).default([]),
  antiSpam: z
    .object({
      enabled: z.boolean().default(true),
      maxMessages: z.number().int().min(2).max(50).default(6),
      intervalSeconds: z.number().int().min(1).max(120).default(5),
      timeoutSeconds: z.number().int().min(60).max(28 * 86400).default(600),
    })
    .default({}),
  antiMassMention: z
    .object({
      enabled: z.boolean().default(true),
      maxMentions: z.number().int().min(2).max(100).default(5),
      timeoutSeconds: z.number().int().min(60).max(28 * 86400).default(600),
    })
    .default({}),
  antiLink: z
    .object({
      enabled: z.boolean().default(false),
      /** Invitations Discord (discord.gg/…) */
      blockInvites: z.boolean().default(true),
      /** Tous les liens http(s) hors liste blanche */
      blockLinks: z.boolean().default(false),
      whitelistDomains: z.array(domain).max(100).default([]),
      action: z.enum(['DELETE', 'TIMEOUT']).default('DELETE'),
      timeoutSeconds: z.number().int().min(60).max(28 * 86400).default(300),
    })
    .default({}),
  antiNewAccount: z
    .object({
      enabled: z.boolean().default(false),
      minAgeDays: z.number().int().min(1).max(365).default(7),
      action: z.enum(['KICK', 'QUARANTINE']).default('KICK'),
      quarantineRoleId: snowflake.nullable().default(null),
    })
    .default({}),
  antiBot: z
    .object({
      enabled: z.boolean().default(false),
      allowedBotIds: z.array(snowflake).max(100).default([]),
    })
    .default({}),
  antiMassJoin: z
    .object({
      enabled: z.boolean().default(true),
      maxJoins: z.number().int().min(2).max(500).default(10),
      intervalSeconds: z.number().int().min(1).max(600).default(10),
      /** Déclencher automatiquement le lockdown */
      lockdown: z.boolean().default(true),
    })
    .default({}),
  antiNuke: antiNukeConfigSchema.default({}),
});
export type AntiRaidConfig = z.infer<typeof antiRaidConfigSchema>;
export type AntiRaidConfigInput = z.input<typeof antiRaidConfigSchema>;
export const DEFAULT_ANTI_RAID: AntiRaidConfig = antiRaidConfigSchema.parse({});

/** Permission SendMessages de @everyone sur un salon avant le lockdown. */
export type LockdownChannelState = 'allow' | 'deny' | 'neutral' | 'none';
export const lockdownStateSchema = z.object({
  at: z.string(),
  actorId: z.string(),
  reason: z.string().nullable().default(null),
  channels: z.record(z.string(), z.enum(['allow', 'deny', 'neutral', 'none'])),
});
export type LockdownState = z.infer<typeof lockdownStateSchema>;

/** Mise à jour partielle acceptée par le dashboard / les commandes. */
export const moderationConfigUpdateSchema = z.object({
  warnThresholds: warnThresholdsSchema.optional(),
  muteRoleId: snowflake.nullable().optional(),
  dmOnSanction: z.boolean().optional(),
  antiRaid: antiRaidConfigSchema.optional(),
});
export type ModerationConfigUpdate = z.input<typeof moderationConfigUpdateSchema>;

export interface ResolvedModerationConfig {
  guildId: string;
  warnThresholds: WarnThreshold[];
  muteRoleId: string | null;
  dmOnSanction: boolean;
  antiRaid: AntiRaidConfig;
  lockdownActive: boolean;
  lockdownState: LockdownState | null;
  updatedAt: Date | null;
}

// ─────────────────────────── Types publics ───────────────────────────

export interface SanctionResult {
  sanction: Sanction;
  /** Le DM a-t-il été envoyé à l'utilisateur ? */
  dmSent: boolean;
}

export interface WarnEscalation {
  threshold: WarnThreshold;
  sanction: Sanction | null;
  /** Message d'erreur (clé i18n) si l'action automatique n'a pas pu être appliquée */
  error: string | null;
}

export interface WarnResult extends SanctionResult {
  warning: Warning;
  activeCount: number;
  escalation: WarnEscalation | null;
}

export interface CreateSanctionInput {
  guildId: string;
  type: SanctionType;
  userId?: string | null;
  moderatorId: string;
  reason?: string | null;
  duration?: number | null;
  channelId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SanctionListQuery {
  userId?: string;
  type?: SanctionType;
  page?: number;
  pageSize?: number;
}

export interface SanctionPage {
  items: Sanction[];
  total: number;
  page: number;
  pages: number;
}

export type PurgeFilter = 'all' | 'bots' | 'humans' | 'links' | 'files' | 'embeds';

export interface PurgeOptions {
  amount: number;
  userId?: string | null;
  filter?: PurgeFilter;
}

export interface LockdownResult {
  changed: boolean;
  channels: number;
  failed: number;
}

/** Actions "lève la sanction" : embed violet, pas rouge. */
const POSITIVE_TYPES: ReadonlySet<SanctionType> = new Set<SanctionType>(['UNBAN', 'UNWARN', 'UNTIMEOUT', 'UNMUTE', 'UNLOCK', 'LOCKDOWN_END']);
/** Sanctions pour lesquelles on envoie un DM à l'utilisateur. */
const DM_TYPES: ReadonlySet<SanctionType> = new Set<SanctionType>(['BAN', 'TEMPBAN', 'KICK', 'WARN', 'UNWARN', 'TIMEOUT', 'UNTIMEOUT', 'MUTE', 'UNMUTE']);
const LOCKDOWN_CHANNEL_TYPES = new Set<ChannelType>([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);
const URL_REGEX = /https?:\/\/\S+/i;

const CONFIG_TTL_MS = 60_000;
const RECENT_ACTION_TTL_MS = 20_000;
const CASE_RETRIES = 3;

/** Retourne le seuil atteint EXACTEMENT par `activeCount`, ou null. */
export function resolveEscalation(activeCount: number, thresholds: WarnThreshold[]): WarnThreshold | null {
  return thresholds.find((t) => t.count === activeCount) ?? null;
}

/** Raison écrite dans l'audit log Discord. */
export function auditReason(moderator: { id: string; tag?: string; username?: string }, reason?: string | null): string {
  const who = moderator.tag ?? moderator.username ?? moderator.id;
  return `${who} (${moderator.id})${reason ? ` • ${reason}` : ''}`.slice(0, 512);
}

// ─────────────────────────── /clear serveur (nuke) : fonctions pures + remap base ───────────────────────────

/** Types de salons vidés par /clear serveur (forums, vocaux, catégories et threads sont ignorés). */
export const NUKE_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set<ChannelType>([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
/** Pause entre deux salons (limites de débit Discord sur la création / suppression de salons). */
export const NUKE_DELAY_MS = 1500;

export interface NukeChannelInfo {
  id: string;
  name: string;
  type: ChannelType;
  /** Position du salon dans sa catégorie */
  position: number;
  /** Position de la catégorie parente (-1 sans catégorie) */
  parentPosition: number;
  /** Le bot peut gérer (cloner / supprimer) ce salon */
  manageable: boolean;
}

export type NukeSkipReason = 'ticket' | 'no_permission';

/**
 * Sélectionne les salons à recréer, dans l'ordre d'affichage (catégorie puis position).
 * Seuls les salons texte / annonces sont concernés ; les salons de tickets sont ignorés sauf `includeTickets`.
 */
export function selectNukeTargets(
  channels: NukeChannelInfo[],
  opts: { ticketChannelIds: ReadonlySet<string>; includeTickets: boolean },
): { targets: NukeChannelInfo[]; skipped: { id: string; name: string; reason: NukeSkipReason }[] } {
  const targets: NukeChannelInfo[] = [];
  const skipped: { id: string; name: string; reason: NukeSkipReason }[] = [];
  for (const c of channels) {
    if (!NUKE_CHANNEL_TYPES.has(c.type)) continue;
    if (!opts.includeTickets && opts.ticketChannelIds.has(c.id)) skipped.push({ id: c.id, name: c.name, reason: 'ticket' });
    else if (!c.manageable) skipped.push({ id: c.id, name: c.name, reason: 'no_permission' });
    else targets.push(c);
  }
  targets.sort((a, b) => a.parentPosition - b.parentPosition || a.position - b.position || a.id.localeCompare(b.id));
  return { targets, skipped };
}

/** Confirmation de /clear serveur : le nom saisi doit être EXACTEMENT celui du serveur (espaces de bord ignorés). */
export function isGuildNameConfirmed(input: string | null | undefined, guildName: string): boolean {
  if (typeof input !== 'string') return false;
  const typed = input.trim();
  return typed.length > 0 && typed === guildName.trim();
}

/** Lignes de base remappées par table + éléments à republier. */
export interface ChannelRemapResult {
  counts: Record<string, number>;
  ticketPanelIds: number[];
  roleMenuIds: number[];
  eventIds: number[];
  giveawayIds: number[];
  pollIds: number[];
}

/**
 * Remplace en base toutes les références aux anciens salons (`map` : ancien ID → nouvel ID) d'un serveur.
 *  - salons de logs, bienvenue / départ, whitelist (review), School RP (config + classes), sourdines de salon ;
 *  - panneaux de tickets et role menus : salon remappé, messageId remis à null (à republier) ;
 *  - annonces : salon remappé, messages publiés oubliés ;
 *  - événements / giveaways / sondages ACTIFS : salon remappé, messageId à null (à republier) ;
 *  - statut FiveM : statusChannelId remappé, statusMessageId à null (le service republie le statut) ;
 *  - reaction roles des salons recréés : supprimés (leurs messages n'existent plus) ;
 *  - tickets : uniquement si `includeTickets`.
 */
export async function remapChannelReferences(guildId: string, map: Record<string, string>, opts: { includeTickets?: boolean } = {}): Promise<ChannelRemapResult> {
  const oldIds = Object.keys(map);
  const result: ChannelRemapResult = { counts: {}, ticketPanelIds: [], roleMenuIds: [], eventIds: [], giveawayIds: [], pollIds: [] };
  if (!oldIds.length) return result;
  const next = (id: string | null | undefined): string | null => (id && map[id] ? map[id]! : null);
  const count = (table: string, n: number) => {
    if (n) result.counts[table] = (result.counts[table] ?? 0) + n;
  };
  const inOld = { in: oldIds };

  // Salons de logs
  for (const row of await prisma.logChannel.findMany({ where: { guildId, channelId: inOld } })) {
    await prisma.logChannel.update({ where: { id: row.id }, data: { channelId: next(row.channelId)! } });
    count('logChannel', 1);
  }

  // Bienvenue / départ
  const welcome = await prisma.welcomeConfig.findUnique({ where: { guildId } });
  if (next(welcome?.channelId)) {
    await prisma.welcomeConfig.update({ where: { guildId }, data: { channelId: next(welcome!.channelId) } });
    count('welcomeConfig', 1);
  }
  const leave = await prisma.leaveConfig.findUnique({ where: { guildId } });
  if (next(leave?.channelId)) {
    await prisma.leaveConfig.update({ where: { guildId }, data: { channelId: next(leave!.channelId) } });
    count('leaveConfig', 1);
  }

  // Panneaux de tickets (republiés ensuite)
  for (const row of await prisma.ticketPanel.findMany({ where: { guildId, channelId: inOld } })) {
    await prisma.ticketPanel.update({ where: { id: row.id }, data: { channelId: next(row.channelId)!, messageId: null } });
    result.ticketPanelIds.push(row.id);
    count('ticketPanel', 1);
  }

  // Role menus (republiés ensuite)
  for (const row of await prisma.roleMenu.findMany({ where: { guildId, channelId: inOld } })) {
    await prisma.roleMenu.update({ where: { id: row.id }, data: { channelId: next(row.channelId), messageId: null } });
    result.roleMenuIds.push(row.id);
    count('roleMenu', 1);
  }

  // Reaction roles : les messages ont disparu avec l'ancien salon
  const rr = await prisma.reactionRole.deleteMany({ where: { guildId, channelId: inOld } });
  count('reactionRole', rr.count ?? 0);

  // Annonces : nouveau salon, anciens messages oubliés
  for (const row of await prisma.announcement.findMany({ where: { guildId, channelId: inOld } })) {
    await prisma.announcement.update({ where: { id: row.id }, data: { channelId: next(row.channelId), messages: [] } });
    count('announcement', 1);
  }

  // Événements / giveaways / sondages actifs (republiés ensuite)
  for (const row of await prisma.event.findMany({ where: { guildId, channelId: inOld, status: { in: ['SCHEDULED', 'ONGOING'] } } })) {
    await prisma.event.update({ where: { id: row.id }, data: { channelId: next(row.channelId)!, messageId: null } });
    result.eventIds.push(row.id);
    count('event', 1);
  }
  for (const row of await prisma.giveaway.findMany({ where: { guildId, channelId: inOld, ended: false } })) {
    await prisma.giveaway.update({ where: { id: row.id }, data: { channelId: next(row.channelId)!, messageId: null } });
    result.giveawayIds.push(row.id);
    count('giveaway', 1);
  }
  for (const row of await prisma.poll.findMany({ where: { guildId, channelId: inOld, ended: false } })) {
    await prisma.poll.update({ where: { id: row.id }, data: { channelId: next(row.channelId)!, messageId: null } });
    result.pollIds.push(row.id);
    count('poll', 1);
  }

  // Statut FiveM (seules les colonnes statusChannelId / statusMessageId sont modifiées)
  for (const [oldId, newId] of Object.entries(map)) {
    const r = await prisma.fiveMServer.updateMany({ where: { guildId, statusChannelId: oldId }, data: { statusChannelId: newId, statusMessageId: null } });
    count('fiveMServer', r.count ?? 0);
  }

  // School RP
  for (const row of await prisma.schoolClass.findMany({ where: { guildId, channelId: inOld } })) {
    await prisma.schoolClass.update({ where: { id: row.id }, data: { channelId: next(row.channelId) } });
    count('schoolClass', 1);
  }
  const school = await prisma.schoolConfig.findUnique({ where: { guildId } });
  if (school && (next(school.applicationChannelId) || next(school.announceChannelId))) {
    await prisma.schoolConfig.update({
      where: { guildId },
      data: { applicationChannelId: next(school.applicationChannelId) ?? school.applicationChannelId, announceChannelId: next(school.announceChannelId) ?? school.announceChannelId },
    });
    count('schoolConfig', 1);
  }

  // Whitelist (salon de review)
  const whitelist = await prisma.whitelistConfig.findUnique({ where: { guildId } });
  if (next(whitelist?.reviewChannelId)) {
    await prisma.whitelistConfig.update({ where: { guildId }, data: { reviewChannelId: next(whitelist!.reviewChannelId) } });
    count('whitelistConfig', 1);
  }

  // Sourdines de salon programmées (/mute-salon)
  for (const row of await prisma.channelMute.findMany({ where: { guildId, channelId: inOld } })) {
    await prisma.channelMute.update({ where: { id: row.id }, data: { channelId: next(row.channelId)! } });
    count('channelMute', 1);
  }

  // Tickets (uniquement si leurs salons ont été recréés)
  if (opts.includeTickets) {
    for (const row of await prisma.ticket.findMany({ where: { guildId, channelId: inOld, status: { not: 'DELETED' } } })) {
      await prisma.ticket.update({ where: { id: row.id }, data: { channelId: next(row.channelId)! } });
      count('ticket', 1);
    }
  }
  return result;
}

export interface NukeGuildReport {
  cleared: { oldId: string; newId: string; name: string }[];
  skipped: { id: string; name: string; reason: NukeSkipReason }[];
  errors: { id: string; name: string; error: string }[];
  remap: ChannelRemapResult;
  durationMs: number;
  sanction: Sanction;
}

/** Champs d'embed du rapport de /clear serveur (DM à l'exécuteur + salon de logs). */
export function nukeReportFields(t: Translator, lang: string, report: Omit<NukeGuildReport, 'sanction'>): { name: string; value: string; inline: boolean }[] {
  const list = (items: string[]) => (items.length ? items.join(', ').slice(0, 1000) : '—');
  const remapped = Object.entries(report.remap.counts).map(([table, n]) => `${table} ×${n}`);
  return [
    { name: t('moderation.nuke_guild.report_cleared', { count: report.cleared.length }), value: list(report.cleared.map((c) => `#${c.name}`)), inline: false },
    { name: t('moderation.nuke_guild.report_skipped', { count: report.skipped.length }), value: list(report.skipped.map((c) => `#${c.name} (${t(`moderation.nuke_guild.skip_${c.reason}`)})`)), inline: false },
    { name: t('moderation.nuke_guild.report_errors', { count: report.errors.length }), value: list(report.errors.map((e) => `${e.name === 'republish' ? '' : `#${e.name} : `}${e.error}`)), inline: false },
    { name: t('moderation.nuke_guild.report_remapped'), value: list(remapped), inline: false },
    { name: t('moderation.nuke_guild.report_duration'), value: formatDuration(Math.max(1, Math.round(report.durationMs / 1000)), lang), inline: true },
  ];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Service de modération : sanctions numérotées (cases), avertissements avec escalade,
 * bans / timeouts / mutes temporaires, lockdown, purge, slowmode, lock. API utilisée
 * par les commandes, l'anti-raid, les événements de logs et le dashboard.
 */
export class ModerationService {
  private client: Client | null = null;
  private readonly configCache = new TTLCache<ResolvedModerationConfig>(CONFIG_TTL_MS, 2000);
  /** Actions récentes faites par le bot : évite les doublons avec les listeners d'audit log. */
  private readonly recentActions = new TTLCache<true>(RECENT_ACTION_TTL_MS, 5000);

  /** À appeler une fois au ready : garde le client + enregistre la tâche d'expiration. */
  attach(client: Client): void {
    this.client = client;
    if (!scheduler.registered.includes('moderation:expire')) {
      scheduler.register({
        name: 'moderation:expire',
        intervalMs: 30_000,
        run: async () => {
          await this.expireTick();
        },
      });
    }
    if (!scheduler.registered.includes('moderation:channel-unmute')) {
      scheduler.register({
        name: 'moderation:channel-unmute',
        intervalMs: 15_000,
        run: async () => {
          await this.channelUnmuteTick();
        },
      });
    }
  }

  get attached(): boolean {
    return this.client !== null;
  }

  // ─────────────────────────── Configuration ───────────────────────────

  async getConfig(guildId: string): Promise<ResolvedModerationConfig> {
    const cached = this.configCache.get(guildId);
    if (cached) return cached;
    const row = await prisma.moderationConfig.findUnique({ where: { guildId } });
    const resolved = this.resolveConfig(guildId, row);
    this.configCache.set(guildId, resolved);
    return resolved;
  }

  private resolveConfig(guildId: string, row: Prisma.ModerationConfigGetPayload<object> | null): ResolvedModerationConfig {
    const thresholds = warnThresholdsSchema.safeParse(row?.warnThresholds ?? DEFAULT_WARN_THRESHOLDS);
    const antiRaid = antiRaidConfigSchema.safeParse(row?.antiRaid ?? {});
    const lockdown = row?.lockdownState ? lockdownStateSchema.safeParse(row.lockdownState) : null;
    if (!thresholds.success) log.warn({ guildId, issues: thresholds.error.issues }, 'warnThresholds invalide, défauts utilisés');
    if (!antiRaid.success) log.warn({ guildId, issues: antiRaid.error.issues }, 'antiRaid invalide, défauts utilisés');
    return {
      guildId,
      warnThresholds: thresholds.success ? thresholds.data : DEFAULT_WARN_THRESHOLDS,
      muteRoleId: row?.muteRoleId ?? null,
      dmOnSanction: row?.dmOnSanction ?? true,
      antiRaid: antiRaid.success ? antiRaid.data : DEFAULT_ANTI_RAID,
      lockdownActive: row?.lockdownActive ?? false,
      lockdownState: lockdown?.success ? lockdown.data : null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** Mise à jour partielle (validée par Zod). Lance une ZodError si invalide. */
  async updateConfig(guildId: string, partial: ModerationConfigUpdate): Promise<ResolvedModerationConfig> {
    const data = moderationConfigUpdateSchema.parse(partial);
    const update: Prisma.ModerationConfigUncheckedUpdateInput = {};
    if (data.warnThresholds !== undefined) update.warnThresholds = toJson(data.warnThresholds);
    if (data.muteRoleId !== undefined) update.muteRoleId = data.muteRoleId;
    if (data.dmOnSanction !== undefined) update.dmOnSanction = data.dmOnSanction;
    if (data.antiRaid !== undefined) update.antiRaid = toJson(data.antiRaid);
    await prisma.moderationConfig.upsert({
      where: { guildId },
      create: { guildId, ...(update as Omit<Prisma.ModerationConfigUncheckedCreateInput, 'guildId'>) },
      update,
    });
    this.invalidate(guildId);
    return this.getConfig(guildId);
  }

  invalidate(guildId: string): void {
    this.configCache.delete(guildId);
    guildConfigService.emit('moderation:update', guildId);
  }

  async getAntiRaidConfig(guildId: string): Promise<AntiRaidConfig> {
    return (await this.getConfig(guildId)).antiRaid;
  }

  /** Fusion profonde (une protection à la fois possible) puis validation complète. */
  async updateAntiRaidConfig(guildId: string, partial: Partial<AntiRaidConfigInput>): Promise<AntiRaidConfig> {
    const current = await this.getAntiRaidConfig(guildId);
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(partial)) {
      if (value === undefined) continue;
      const existing = (current as Record<string, unknown>)[key];
      merged[key] = value && typeof value === 'object' && !Array.isArray(value) && existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing, ...value } : value;
    }
    const cfg = await this.updateConfig(guildId, { antiRaid: antiRaidConfigSchema.parse(merged) });
    return cfg.antiRaid;
  }

  // ─────────────────────────── Actions récentes (dédoublonnage) ───────────────────────────

  markRecent(guildId: string, kind: string, userId: string): void {
    this.recentActions.set(`${guildId}:${kind}:${userId}`, true);
  }

  /** Vrai si le bot vient d'effectuer cette action (et consomme le marqueur). */
  consumeRecent(guildId: string, kind: string, userId: string): boolean {
    const key = `${guildId}:${kind}:${userId}`;
    const hit = this.recentActions.has(key);
    if (hit) this.recentActions.delete(key);
    return hit;
  }

  // ─────────────────────────── Cases ───────────────────────────

  /**
   * Crée une sanction avec un caseNumber séquentiel par serveur (max+1 dans une transaction,
   * réessayé en cas de collision sur l'index unique guildId+caseNumber).
   */
  async createSanction(input: CreateSanctionInput): Promise<Sanction> {
    let lastError: unknown;
    for (let attempt = 0; attempt < CASE_RETRIES; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const agg = await tx.sanction.aggregate({ where: { guildId: input.guildId }, _max: { caseNumber: true } });
          const caseNumber = (agg?._max?.caseNumber ?? 0) + 1;
          return tx.sanction.create({
            data: {
              guildId: input.guildId,
              caseNumber,
              type: input.type,
              userId: input.userId ?? null,
              moderatorId: input.moderatorId,
              reason: input.reason ?? null,
              duration: input.duration ?? null,
              channelId: input.channelId ?? null,
              metadata: input.metadata ? toJson(input.metadata) : Prisma.JsonNull,
            },
          });
        });
      } catch (err) {
        lastError = err;
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('createSanction: échec après plusieurs tentatives');
  }

  async getCase(guildId: string, caseNumber: number): Promise<Sanction | null> {
    return prisma.sanction.findUnique({ where: { guildId_caseNumber: { guildId, caseNumber } } });
  }

  async listSanctions(guildId: string, query: SanctionListQuery = {}): Promise<SanctionPage> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 10));
    const where: Prisma.SanctionWhereInput = { guildId };
    if (query.userId) where.userId = query.userId;
    if (query.type) where.type = query.type;
    const [total, items] = await Promise.all([
      prisma.sanction.count({ where }),
      prisma.sanction.findMany({ where, orderBy: { caseNumber: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** Statistiques : nombre de sanctions par type sur `days` jours. */
  async stats(guildId: string, days = 30): Promise<{ total: number; byType: Partial<Record<SanctionType, number>>; activeWarnings: number; activeBans: number; activeMutes: number }> {
    const since = new Date(Date.now() - days * 86400_000);
    const [rows, activeWarnings, activeBans, activeMutes] = await Promise.all([
      prisma.sanction.groupBy({ by: ['type'], where: { guildId, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.warning.count({ where: { guildId, active: true } }),
      prisma.ban.count({ where: { guildId, active: true } }),
      prisma.mute.count({ where: { guildId, active: true } }),
    ]);
    const byType: Partial<Record<SanctionType, number>> = {};
    let total = 0;
    for (const r of rows) {
      byType[r.type] = r._count._all;
      total += r._count._all;
    }
    return { total, byType, activeWarnings, activeBans, activeMutes };
  }

  // ─────────────────────────── Warnings ───────────────────────────

  async getWarnings(guildId: string, userId: string, opts: { activeOnly?: boolean } = {}): Promise<Warning[]> {
    const where: Prisma.WarningWhereInput = { guildId, userId };
    if (opts.activeOnly !== false) where.active = true;
    return prisma.warning.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async countActiveWarnings(guildId: string, userId: string): Promise<number> {
    return prisma.warning.count({ where: { guildId, userId, active: true } });
  }

  async warn(opts: { guild: Guild; target: GuildMember; moderator: User; reason: string }): Promise<WarnResult> {
    const { guild, target, moderator, reason } = opts;
    const cfg = await this.getConfig(guild.id);
    const warning = await prisma.warning.create({ data: { guildId: guild.id, userId: target.id, moderatorId: moderator.id, reason } });
    const sanction = await this.createSanction({ guildId: guild.id, type: 'WARN', userId: target.id, moderatorId: moderator.id, reason, metadata: { warningId: warning.id } });
    const activeCount = await this.countActiveWarnings(guild.id, target.id);
    const dmSent = await this.notify(guild, target.user, sanction, { extra: { count: activeCount } });
    await this.logSanction(guild.id, sanction, { target: target.user, moderator, extraFields: [{ key: 'warn_count', value: String(activeCount), inline: true }] });

    let escalation: WarnEscalation | null = null;
    const threshold = resolveEscalation(activeCount, cfg.warnThresholds);
    if (threshold) escalation = await this.applyEscalation(guild, target, threshold, activeCount);
    return { sanction, warning, activeCount, dmSent, escalation };
  }

  private async applyEscalation(guild: Guild, target: GuildMember, threshold: WarnThreshold, activeCount: number): Promise<WarnEscalation> {
    const bot = guild.client.user;
    const { t } = await this.guildTranslator(guild.id);
    const reason = t('moderation.escalation.reason', { count: activeCount });
    try {
      let result: SanctionResult;
      switch (threshold.action) {
        case 'TIMEOUT':
          if (!target.moderatable) return { threshold, sanction: null, error: 'moderation.errors.bot_hierarchy' };
          result = await this.timeout({ guild, target, moderator: bot, reason, duration: threshold.duration ?? 3600, metadata: { escalation: true } });
          break;
        case 'KICK':
          if (!target.kickable) return { threshold, sanction: null, error: 'moderation.errors.bot_hierarchy' };
          result = await this.kick({ guild, target, moderator: bot, reason, metadata: { escalation: true } });
          break;
        case 'BAN':
          if (!target.bannable) return { threshold, sanction: null, error: 'moderation.errors.bot_hierarchy' };
          result = await this.ban({ guild, target: target.user, moderator: bot, reason, metadata: { escalation: true } });
          break;
        case 'TEMPBAN':
          if (!target.bannable) return { threshold, sanction: null, error: 'moderation.errors.bot_hierarchy' };
          result = await this.ban({ guild, target: target.user, moderator: bot, reason, duration: threshold.duration ?? 86400, metadata: { escalation: true } });
          break;
      }
      return { threshold, sanction: result.sanction, error: null };
    } catch (err) {
      log.error({ err, guild: guild.id, user: target.id, threshold }, 'Escalade impossible');
      return { threshold, sanction: null, error: 'moderation.errors.escalation_failed' };
    }
  }

  /** Retire un avertissement (le marque inactif) et crée une case UNWARN. `guildId` protège contre un ID d'un autre serveur. */
  async removeWarning(id: number, moderatorId: string, reason?: string | null, guildId?: string): Promise<{ warning: Warning; sanction: Sanction } | null> {
    const warning = await prisma.warning.findUnique({ where: { id } });
    if (!warning || !warning.active) return null;
    if (guildId && warning.guildId !== guildId) return null;
    const updated = await prisma.warning.update({ where: { id }, data: { active: false } });
    const sanction = await this.createSanction({ guildId: warning.guildId, type: 'UNWARN', userId: warning.userId, moderatorId, reason: reason ?? null, metadata: { warningId: id } });
    await this.logSanction(warning.guildId, sanction, { moderator: { id: moderatorId }, extraFields: [{ key: 'warning_id', value: `#${id}`, inline: true }] });
    const guild = this.client?.guilds.cache.get(warning.guildId);
    if (guild) {
      const user = await this.client?.users.fetch(warning.userId).catch(() => null);
      if (user) await this.notify(guild, user, sanction);
    }
    return { warning: updated, sanction };
  }

  async clearWarnings(guildId: string, userId: string, moderatorId: string, reason?: string | null): Promise<{ cleared: number; sanction: Sanction | null }> {
    const r = await prisma.warning.updateMany({ where: { guildId, userId, active: true }, data: { active: false } });
    if (!r.count) return { cleared: 0, sanction: null };
    const sanction = await this.createSanction({ guildId, type: 'UNWARN', userId, moderatorId, reason: reason ?? null, metadata: { cleared: r.count } });
    await this.logSanction(guildId, sanction, { moderator: { id: moderatorId }, extraFields: [{ key: 'cleared', value: String(r.count), inline: true }] });
    return { cleared: r.count, sanction };
  }

  // ─────────────────────────── Ban / Kick ───────────────────────────

  async ban(opts: { guild: Guild; target: User; moderator: User; reason?: string | null; duration?: number | null; deleteMessageSeconds?: number; metadata?: Record<string, unknown> }): Promise<SanctionResult> {
    const { guild, target, moderator } = opts;
    const reason = opts.reason ?? null;
    const duration = opts.duration ?? null;
    const type: SanctionType = duration ? 'TEMPBAN' : 'BAN';
    const expiresAt = duration ? new Date(Date.now() + duration * 1000) : null;
    const sanction = await this.createSanction({ guildId: guild.id, type, userId: target.id, moderatorId: moderator.id, reason, duration, metadata: { ...(opts.metadata ?? {}), expiresAt: expiresAt?.toISOString() ?? null } });
    // DM avant le ban : après, plus de serveur commun.
    const dmSent = await this.notify(guild, target, sanction);
    this.markRecent(guild.id, 'ban', target.id);
    try {
      await guild.members.ban(target.id, { reason: auditReason(moderator, reason), deleteMessageSeconds: opts.deleteMessageSeconds ?? 0 });
    } catch (err) {
      this.consumeRecent(guild.id, 'ban', target.id);
      throw err;
    }
    await prisma.ban.updateMany({ where: { guildId: guild.id, userId: target.id, active: true }, data: { active: false } });
    await prisma.ban.create({ data: { guildId: guild.id, userId: target.id, moderatorId: moderator.id, reason, expiresAt } });
    await this.logSanction(guild.id, sanction, { target, moderator });
    return { sanction, dmSent };
  }

  async unban(opts: { guild: Guild; userId: string; moderator: User; reason?: string | null; metadata?: Record<string, unknown> }): Promise<SanctionResult> {
    const { guild, userId, moderator } = opts;
    const reason = opts.reason ?? null;
    this.markRecent(guild.id, 'unban', userId);
    try {
      await guild.bans.remove(userId, auditReason(moderator, reason));
    } catch (err) {
      this.consumeRecent(guild.id, 'unban', userId);
      throw err;
    }
    await prisma.ban.updateMany({ where: { guildId: guild.id, userId, active: true }, data: { active: false } });
    const sanction = await this.createSanction({ guildId: guild.id, type: 'UNBAN', userId, moderatorId: moderator.id, reason, metadata: opts.metadata ?? null });
    const target = await guild.client.users.fetch(userId).catch(() => null);
    await this.logSanction(guild.id, sanction, { target, moderator });
    return { sanction, dmSent: false };
  }

  async kick(opts: { guild: Guild; target: GuildMember; moderator: User; reason?: string | null; metadata?: Record<string, unknown> }): Promise<SanctionResult> {
    const { guild, target, moderator } = opts;
    const reason = opts.reason ?? null;
    const sanction = await this.createSanction({ guildId: guild.id, type: 'KICK', userId: target.id, moderatorId: moderator.id, reason, metadata: opts.metadata ?? null });
    const dmSent = await this.notify(guild, target.user, sanction);
    this.markRecent(guild.id, 'kick', target.id);
    try {
      await target.kick(auditReason(moderator, reason));
    } catch (err) {
      this.consumeRecent(guild.id, 'kick', target.id);
      throw err;
    }
    await this.logSanction(guild.id, sanction, { target: target.user, moderator });
    return { sanction, dmSent };
  }

  // ─────────────────────────── Timeout / Mute ───────────────────────────

  async timeout(opts: { guild: Guild; target: GuildMember; moderator: User; reason?: string | null; duration: number; metadata?: Record<string, unknown> }): Promise<SanctionResult> {
    const { guild, target, moderator } = opts;
    const reason = opts.reason ?? null;
    const duration = Math.min(opts.duration, 28 * 86400);
    this.markRecent(guild.id, 'timeout', target.id);
    try {
      await target.timeout(duration * 1000, auditReason(moderator, reason));
    } catch (err) {
      this.consumeRecent(guild.id, 'timeout', target.id);
      throw err;
    }
    const sanction = await this.createSanction({ guildId: guild.id, type: 'TIMEOUT', userId: target.id, moderatorId: moderator.id, reason, duration, metadata: { ...(opts.metadata ?? {}), expiresAt: new Date(Date.now() + duration * 1000).toISOString() } });
    const dmSent = await this.notify(guild, target.user, sanction);
    await this.logSanction(guild.id, sanction, { target: target.user, moderator });
    return { sanction, dmSent };
  }

  async untimeout(opts: { guild: Guild; target: GuildMember; moderator: User; reason?: string | null }): Promise<SanctionResult> {
    const { guild, target, moderator } = opts;
    const reason = opts.reason ?? null;
    this.markRecent(guild.id, 'timeout', target.id);
    try {
      await target.timeout(null, auditReason(moderator, reason));
    } catch (err) {
      this.consumeRecent(guild.id, 'timeout', target.id);
      throw err;
    }
    const sanction = await this.createSanction({ guildId: guild.id, type: 'UNTIMEOUT', userId: target.id, moderatorId: moderator.id, reason });
    const dmSent = await this.notify(guild, target.user, sanction);
    await this.logSanction(guild.id, sanction, { target: target.user, moderator });
    return { sanction, dmSent };
  }

  /** Mute par rôle (ModerationConfig.muteRoleId). Lance `moderation.errors.no_mute_role` si non configuré. */
  async mute(opts: { guild: Guild; target: GuildMember; moderator: User; reason?: string | null; duration?: number | null; metadata?: Record<string, unknown> }): Promise<SanctionResult> {
    const { guild, target, moderator } = opts;
    const cfg = await this.getConfig(guild.id);
    if (!cfg.muteRoleId) throw new ModerationError('moderation.errors.no_mute_role');
    const role = guild.roles.cache.get(cfg.muteRoleId) ?? (await guild.roles.fetch(cfg.muteRoleId).catch(() => null));
    if (!role) throw new ModerationError('moderation.errors.mute_role_missing');
    const reason = opts.reason ?? null;
    const duration = opts.duration ?? null;
    const expiresAt = duration ? new Date(Date.now() + duration * 1000) : null;
    this.markRecent(guild.id, 'roles', target.id);
    try {
      await target.roles.add(role, auditReason(moderator, reason));
    } catch (err) {
      this.consumeRecent(guild.id, 'roles', target.id);
      throw err;
    }
    await prisma.mute.updateMany({ where: { guildId: guild.id, userId: target.id, active: true }, data: { active: false } });
    await prisma.mute.create({ data: { guildId: guild.id, userId: target.id, moderatorId: moderator.id, reason, expiresAt } });
    const sanction = await this.createSanction({ guildId: guild.id, type: 'MUTE', userId: target.id, moderatorId: moderator.id, reason, duration, metadata: { ...(opts.metadata ?? {}), roleId: role.id, expiresAt: expiresAt?.toISOString() ?? null } });
    const dmSent = await this.notify(guild, target.user, sanction);
    await this.logSanction(guild.id, sanction, { target: target.user, moderator });
    return { sanction, dmSent };
  }

  async unmute(opts: { guild: Guild; target: GuildMember; moderator: User; reason?: string | null; metadata?: Record<string, unknown> }): Promise<SanctionResult> {
    const { guild, target, moderator } = opts;
    const cfg = await this.getConfig(guild.id);
    const reason = opts.reason ?? null;
    if (cfg.muteRoleId && target.roles.cache.has(cfg.muteRoleId)) {
      this.markRecent(guild.id, 'roles', target.id);
      try {
        await target.roles.remove(cfg.muteRoleId, auditReason(moderator, reason));
      } catch (err) {
        this.consumeRecent(guild.id, 'roles', target.id);
        throw err;
      }
    }
    await prisma.mute.updateMany({ where: { guildId: guild.id, userId: target.id, active: true }, data: { active: false } });
    const sanction = await this.createSanction({ guildId: guild.id, type: 'UNMUTE', userId: target.id, moderatorId: moderator.id, reason, metadata: opts.metadata ?? null });
    const dmSent = await this.notify(guild, target.user, sanction);
    await this.logSanction(guild.id, sanction, { target: target.user, moderator });
    return { sanction, dmSent };
  }

  // ─────────────────────────── Salons ───────────────────────────

  /** Supprime jusqu'à `amount` messages (max 500, < 14 jours) selon le filtre. Retourne le nombre supprimé. */
  async purge(opts: { channel: GuildTextBasedChannel; moderator: User; options: PurgeOptions; reason?: string | null }): Promise<{ deleted: number; sanction: Sanction }> {
    const { channel, moderator, options } = opts;
    const amount = Math.min(500, Math.max(1, options.amount));
    const filter = options.filter ?? 'all';
    let deleted = 0;
    let before: string | undefined;
    let scanned = 0;
    while (deleted < amount && scanned < 1000) {
      const batch = (await channel.messages.fetch({ limit: 100, before })) as Collection<string, Message<true>>;
      if (!batch.size) break;
      scanned += batch.size;
      before = batch.last()?.id;
      const candidates = batch.filter((m) => this.matchesPurge(m, options.userId ?? null, filter)).first(amount - deleted);
      if (candidates.length) {
        const result = await channel.bulkDelete(candidates, true);
        deleted += result.size;
        // Messages trop vieux pour bulkDelete : on s'arrête (Discord refuse > 14 jours).
        if (result.size < candidates.length) break;
      }
      if (batch.size < 100) break;
    }
    const sanction = await this.createSanction({
      guildId: channel.guild.id,
      type: 'PURGE',
      userId: options.userId ?? null,
      moderatorId: moderator.id,
      reason: opts.reason ?? null,
      channelId: channel.id,
      metadata: { deleted, requested: amount, filter },
    });
    await this.logSanction(channel.guild.id, sanction, {
      moderator,
      target: null,
      extraFields: [
        { key: 'channel', value: `<#${channel.id}>`, inline: true },
        { key: 'deleted', value: String(deleted), inline: true },
        { key: 'filter', value: filter, inline: true },
      ],
    });
    return { deleted, sanction };
  }

  private matchesPurge(m: Message, userId: string | null, filter: PurgeFilter): boolean {
    if (m.pinned) return false;
    if (userId && m.author.id !== userId) return false;
    switch (filter) {
      case 'bots':
        return m.author.bot;
      case 'humans':
        return !m.author.bot;
      case 'links':
        return URL_REGEX.test(m.content);
      case 'files':
        return m.attachments.size > 0;
      case 'embeds':
        return m.embeds.length > 0;
      default:
        return true;
    }
  }

  async slowmode(opts: { channel: GuildTextBasedChannel; moderator: User; seconds: number; reason?: string | null }): Promise<Sanction> {
    const { channel, moderator } = opts;
    const seconds = Math.min(21600, Math.max(0, Math.floor(opts.seconds)));
    if (!('setRateLimitPerUser' in channel)) throw new ModerationError('moderation.errors.channel_unsupported');
    await channel.setRateLimitPerUser(seconds, auditReason(moderator, opts.reason));
    const sanction = await this.createSanction({ guildId: channel.guild.id, type: 'SLOWMODE', moderatorId: moderator.id, reason: opts.reason ?? null, channelId: channel.id, duration: seconds, metadata: { seconds } });
    await this.logSanction(channel.guild.id, sanction, { moderator, target: null, extraFields: [{ key: 'channel', value: `<#${channel.id}>`, inline: true }, { key: 'slowmode', value: seconds ? formatDuration(seconds) : '0', inline: true }] });
    return sanction;
  }

  /** Verrouille un salon : refuse SendMessages à @everyone (l'état précédent est conservé dans la case). */

  /**
   * Vide totalement un salon : clone à l'identique (nom, sujet, permissions, position, mode lent, NSFW, catégorie)
   * puis supprime l'original. Retourne le nouveau salon. Enregistre une case PURGE.
   */
  async nukeChannel(opts: { channel: GuildTextBasedChannel; moderator: User; reason?: string | null }): Promise<{ channel: GuildTextBasedChannel; sanction: Sanction }> {
    const { channel, moderator } = opts;
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) throw new ModerationError('moderation.errors.channel_type');
    const clone = await this.recreateChannel(channel, auditReason(moderator, opts.reason ?? 'clear salon'));
    await remapChannelReferences(channel.guild.id, { [channel.id]: clone.id }).then((r) => this.afterRemap(channel.guild, r)).catch((err) => log.warn({ err, channel: channel.id }, 'Remap après /clear salon incomplet'));
    const sanction = await this.createSanction({
      guildId: channel.guild.id,
      type: 'PURGE',
      userId: null,
      moderatorId: moderator.id,
      reason: opts.reason ?? null,
      channelId: clone.id,
      metadata: { nuke: true, oldChannelId: channel.id, name: channel.name },
    });
    await this.logSanction(channel.guild.id, sanction, { moderator, extraFields: [{ key: 'channel', value: `<#${clone.id}> (${channel.name})`, inline: true }] });
    return { channel: clone, sanction };
  }

  /** Salons en cours de suppression par /clear (les listeners channelDelete les ignorent : pas de ticket « supprimé », pas de log). */
  private readonly nukeDeletions = new TTLCache<true>(15 * 60_000, 5000);
  private readonly nukingGuilds = new Set<string>();

  isNukeDeletion(channelId: string): boolean {
    return this.nukeDeletions.has(channelId);
  }

  isNukingGuild(guildId: string): boolean {
    return this.nukingGuilds.has(guildId);
  }

  /**
   * Clone un salon texte / annonces à l'identique puis supprime l'original.
   * Les salons système (règles, mises à jour, alertes, messages système) sont réassignés au clone avant suppression.
   * En cas d'échec de suppression, le clone est supprimé et l'erreur relancée.
   */
  private async recreateChannel(channel: GuildTextBasedChannel, reason: string): Promise<GuildTextBasedChannel> {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) throw new ModerationError('moderation.errors.channel_type');
    const guild = channel.guild;
    const position = channel.position;
    const clone = await channel.clone({ reason });
    await clone.setPosition(position).catch(() => null);
    const systemPatch: { rulesChannel?: string; publicUpdatesChannel?: string; safetyAlertsChannel?: string; systemChannel?: string } = {};
    if (guild.rulesChannelId === channel.id) systemPatch.rulesChannel = clone.id;
    if (guild.publicUpdatesChannelId === channel.id) systemPatch.publicUpdatesChannel = clone.id;
    if (guild.safetyAlertsChannelId === channel.id) systemPatch.safetyAlertsChannel = clone.id;
    if (guild.systemChannelId === channel.id) systemPatch.systemChannel = clone.id;
    if (Object.keys(systemPatch).length) await guild.edit({ ...systemPatch, reason }).catch((err) => log.warn({ err, channel: channel.id }, 'Réassignation des salons système impossible'));
    this.nukeDeletions.set(channel.id, true);
    try {
      await channel.delete(reason);
    } catch (err) {
      this.nukeDeletions.delete(channel.id);
      await clone.delete(reason).catch(() => null);
      throw err;
    }
    return clone as GuildTextBasedChannel;
  }

  /** Invalide les caches et republie ce qui dépendait des anciens salons. Ne lance jamais. */
  private async afterRemap(guild: Guild, remap: ChannelRemapResult, opts: { includeTickets?: boolean } = {}): Promise<string[]> {
    const errors: string[] = [];
    const attempt = async (label: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (err) {
        errors.push(`${label}: ${(err as Error).message ?? String(err)}`.slice(0, 200));
        log.warn({ err, guild: guild.id, label }, 'Republication après recréation de salon impossible');
      }
    };
    guildConfigService.invalidate(guild.id);
    guildConfigService.emit(CHANNELS_REMAPPED_EVENT, guild.id);
    welcomeService.invalidate(guild.id);
    roleService.invalidate(guild.id); // vide aussi le cache des role menus et recharge les reaction roles suivis
    if (opts.includeTickets) await attempt('tickets', () => ticketService.loadOpenChannels());
    for (const id of remap.ticketPanelIds) await attempt(`ticket panel #${id}`, () => ticketService.republishPanel(id));
    for (const id of remap.roleMenuIds) {
      await attempt(`role menu #${id}`, async () => {
        const menu = await roleService.getRoleMenu(id);
        if (menu?.channelId) await roleService.publishRoleMenu(id, menu.channelId);
      });
    }
    for (const id of remap.eventIds) await attempt(`event #${id}`, async () => {
      const ev = await eventService.get(id);
      if (ev) await eventService.publish(ev);
    });
    for (const id of remap.giveawayIds) await attempt(`giveaway #${id}`, async () => {
      const g = await giveawayService.get(id);
      if (g) await giveawayService.publish(g);
    });
    for (const id of remap.pollIds) await attempt(`poll #${id}`, async () => {
      const p = await pollService.get(id);
      if (p) await pollService.publish(p);
    });
    return errors;
  }

  /**
   * /clear serveur : recrée à l'identique chaque salon texte / annonces gérable (dans l'ordre d'affichage,
   * pause de 1,5 s entre deux salons), puis remappe toutes les références de salons en base et republie
   * panneaux, role menus, événements, giveaways et sondages. Un seul nuke à la fois par serveur.
   * Les salons de tickets sont ignorés sauf `includeTickets`. Enregistre une case PURGE { nukeGuild: true }.
   */
  async nukeGuild(guild: Guild, moderator: User, opts: { includeTickets?: boolean; reason?: string | null; delayMs?: number } = {}): Promise<NukeGuildReport> {
    if (this.nukingGuilds.has(guild.id)) throw new ModerationError('moderation.nuke_guild.already_running');
    this.nukingGuilds.add(guild.id);
    const started = Date.now();
    const includeTickets = opts.includeTickets ?? false;
    const delayMs = opts.delayMs ?? NUKE_DELAY_MS;
    const reason = auditReason(moderator, opts.reason ?? 'clear serveur');
    try {
      const channels = await guild.channels.fetch();
      const ticketRows = await prisma.ticket.findMany({ where: { guildId: guild.id, status: { not: 'DELETED' } }, select: { channelId: true } });
      const infos: NukeChannelInfo[] = [];
      for (const c of channels.values()) {
        if (!c || c.isThread()) continue;
        infos.push({ id: c.id, name: c.name, type: c.type, position: c.position, parentPosition: c.parent?.position ?? -1, manageable: c.manageable && c.viewable });
      }
      const { targets, skipped } = selectNukeTargets(infos, { ticketChannelIds: new Set(ticketRows.map((r) => r.channelId)), includeTickets });
      const cleared: NukeGuildReport['cleared'] = [];
      const errors: NukeGuildReport['errors'] = [];
      for (const [index, info] of targets.entries()) {
        if (index > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const channel = channels.get(info.id);
        if (!channel || !channel.isTextBased() || channel.isThread()) continue;
        try {
          const clone = await this.recreateChannel(channel as GuildTextBasedChannel, reason);
          cleared.push({ oldId: info.id, newId: clone.id, name: info.name });
        } catch (err) {
          errors.push({ id: info.id, name: info.name, error: ((err as Error).message ?? String(err)).slice(0, 200) });
          log.warn({ err, guild: guild.id, channel: info.id }, '/clear serveur : salon non recréé');
        }
      }
      const map = Object.fromEntries(cleared.map((c) => [c.oldId, c.newId]));
      const remap = await remapChannelReferences(guild.id, map, { includeTickets });
      const republishErrors = await this.afterRemap(guild, remap, { includeTickets });
      for (const e of republishErrors) errors.push({ id: '-', name: 'republish', error: e });
      const durationMs = Date.now() - started;
      const sanction = await this.createSanction({
        guildId: guild.id,
        type: 'PURGE',
        userId: null,
        moderatorId: moderator.id,
        reason: opts.reason ?? null,
        channelId: null,
        metadata: { nukeGuild: true, includeTickets, channels: cleared.length, skipped: skipped.length, errors: errors.length, durationMs, map },
      });
      const report: NukeGuildReport = { cleared, skipped, errors, remap, durationMs, sanction };
      // Rapport dans le (nouveau) salon de logs Modération, sinon Sécurité.
      const { t, lang } = await this.guildTranslator(guild.id);
      const fresh = await guildConfigService.get(guild.id);
      await loggingService.log({
        guildId: guild.id,
        category: fresh?.logChannels.MODERATION || !fresh?.logChannels.SECURITY ? 'MODERATION' : 'SECURITY',
        action: 'mod.nuke_guild',
        title: t('moderation.nuke_guild.log_title', { number: sanction.caseNumber }),
        description: t('moderation.nuke_guild.log_description', { moderator: `<@${moderator.id}>` }),
        fields: nukeReportFields(t, lang, report),
        actorId: moderator.id,
        color: BRAND.colors.danger,
        data: { caseNumber: sanction.caseNumber, type: 'PURGE', metadata: sanction.metadata },
      });
      return report;
    } finally {
      this.nukingGuilds.delete(guild.id);
    }
  }

  async lockChannel(opts: { channel: GuildTextBasedChannel; moderator: User; reason?: string | null }): Promise<Sanction> {
    const { channel, moderator } = opts;
    if (channel.isThread() || !('permissionOverwrites' in channel)) throw new ModerationError('moderation.errors.channel_unsupported');
    const guild = channel.guild;
    const previous = this.everyoneSendState(channel);
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: auditReason(moderator, opts.reason) });
    const sanction = await this.createSanction({ guildId: guild.id, type: 'LOCK', moderatorId: moderator.id, reason: opts.reason ?? null, channelId: channel.id, metadata: { previous } });
    await this.logSanction(guild.id, sanction, { moderator, target: null, extraFields: [{ key: 'channel', value: `<#${channel.id}>`, inline: true }] });
    return sanction;
  }

  async unlockChannel(opts: { channel: GuildTextBasedChannel; moderator: User; reason?: string | null }): Promise<Sanction> {
    const { channel, moderator } = opts;
    if (channel.isThread() || !('permissionOverwrites' in channel)) throw new ModerationError('moderation.errors.channel_unsupported');
    const guild = channel.guild;
    const last = await prisma.sanction.findFirst({ where: { guildId: guild.id, channelId: channel.id, type: 'LOCK' }, orderBy: { createdAt: 'desc' } });
    const meta = (last?.metadata ?? null) as { previous?: LockdownChannelState } | null;
    const previous: LockdownChannelState = meta?.previous && meta.previous !== 'deny' ? meta.previous : 'neutral';
    await this.restoreEveryoneSend(channel, previous, auditReason(moderator, opts.reason));
    // Lève aussi une éventuelle sourdine programmée (/mute-salon).
    await prisma.channelMute.deleteMany({ where: { channelId: channel.id } });
    const sanction = await this.createSanction({ guildId: guild.id, type: 'UNLOCK', moderatorId: moderator.id, reason: opts.reason ?? null, channelId: channel.id, metadata: { restored: previous } });
    await this.logSanction(guild.id, sanction, { moderator, target: null, extraFields: [{ key: 'channel', value: `<#${channel.id}>`, inline: true }] });
    return sanction;
  }

  // ─────────────────────────── Sourdine de salon (/mute-salon) ───────────────────────────

  /**
   * Verrouille le salon (lockChannel) et, si `duration` (secondes) est fournie, programme le déverrouillage
   * automatique (ChannelMute, traité par `channelUnmuteTick`). Sans durée : équivalent à /lock.
   */
  async muteChannel(opts: { channel: GuildTextBasedChannel; moderator: User; reason?: string | null; duration?: number | null }): Promise<{ sanction: Sanction; expiresAt: Date | null }> {
    const { channel, moderator } = opts;
    const expiresAt = opts.duration ? new Date(Date.now() + opts.duration * 1000) : null;
    const sanction = await this.lockChannel({ channel, moderator, reason: opts.reason });
    if (expiresAt) {
      await prisma.channelMute.upsert({
        where: { channelId: channel.id },
        create: { guildId: channel.guild.id, channelId: channel.id, moderatorId: moderator.id, reason: opts.reason ?? null, expiresAt },
        update: { moderatorId: moderator.id, reason: opts.reason ?? null, expiresAt },
      });
      await prisma.sanction.update({ where: { id: sanction.id }, data: { duration: opts.duration ?? null, metadata: toJson({ ...((sanction.metadata as Record<string, unknown> | null) ?? {}), channelMute: true, expiresAt: expiresAt.toISOString() }) } }).catch(() => null);
    } else {
      await prisma.channelMute.deleteMany({ where: { channelId: channel.id } });
    }
    return { sanction, expiresAt };
  }

  /** Sourdine programmée active d'un salon, ou null. */
  async getChannelMute(channelId: string): Promise<{ expiresAt: Date; moderatorId: string; reason: string | null } | null> {
    const row = await prisma.channelMute.findUnique({ where: { channelId } });
    return row ? { expiresAt: row.expiresAt, moderatorId: row.moderatorId, reason: row.reason } : null;
  }

  /** Déverrouille les salons dont la sourdine a expiré (+ message « salon rouvert »). Toutes les 15 s. */
  async channelUnmuteTick(now = new Date()): Promise<number> {
    const client = this.client;
    if (!client?.user) return 0;
    const bot = client.user;
    const expired = await prisma.channelMute.findMany({ where: { expiresAt: { lte: now } }, take: 50 });
    let count = 0;
    for (const row of expired) {
      await prisma.channelMute.delete({ where: { id: row.id } }).catch(() => null);
      const guild = client.guilds.cache.get(row.guildId);
      const channel = guild?.channels.cache.get(row.channelId);
      if (!guild || !channel || !channel.isTextBased() || channel.isThread()) continue;
      try {
        const { t } = await this.guildTranslator(guild.id);
        await this.unlockChannel({ channel, moderator: bot, reason: t('moderation.expire.channel_mute') });
        const embed = new EmbedBuilder().setColor(BRAND.colors.primary).setTitle(t('moderation.mute_channel.reopened_title')).setDescription(t('moderation.mute_channel.reopened')).setFooter({ text: BRAND.footer });
        await channel.send({ embeds: [embed] }).catch(() => null);
        count++;
      } catch (err) {
        log.warn({ err, guild: row.guildId, channel: row.channelId }, 'Sourdine expirée : déverrouillage impossible');
      }
    }
    return count;
  }

  // ─────────────────────────── Lockdown ───────────────────────────

  /**
   * Active / désactive le lockdown du serveur. À l'activation : sauvegarde la permission SendMessages
   * de @everyone sur chaque salon texte puis la refuse partout ; à la désactivation : restaure exactement.
   */
  async setLockdown(guildId: string, enabled: boolean, actorId: string, reason?: string | null): Promise<LockdownResult> {
    if (!this.client) throw new Error('ModerationService non attaché au client');
    const guild = this.client.guilds.cache.get(guildId) ?? (await this.client.guilds.fetch(guildId));
    const cfg = await this.getConfig(guildId);
    if (cfg.lockdownActive === enabled) return { changed: false, channels: 0, failed: 0 };
    const actor = await this.client.users.fetch(actorId).catch(() => null);
    const auditLabel = auditReason(actor ?? { id: actorId }, reason);
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const channels = guild.channels.cache.filter((c) => LOCKDOWN_CHANNEL_TYPES.has(c.type) && 'permissionOverwrites' in c && c.permissionsFor(me).has(PermissionFlagsBits.ManageRoles));

    let ok = 0;
    let failed = 0;
    if (enabled) {
      const state: LockdownState = { at: new Date().toISOString(), actorId, reason: reason ?? null, channels: {} };
      for (const channel of channels.values()) {
        if (!('permissionOverwrites' in channel) || channel.isThread()) continue;
        const prev = this.everyoneSendState(channel);
        try {
          await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: auditLabel });
          state.channels[channel.id] = prev;
          ok++;
        } catch (err) {
          failed++;
          log.warn({ err, guild: guildId, channel: channel.id }, 'Lockdown : salon ignoré');
        }
      }
      await prisma.moderationConfig.upsert({
        where: { guildId },
        create: { guildId, lockdownActive: true, lockdownState: toJson(state) },
        update: { lockdownActive: true, lockdownState: toJson(state) },
      });
    } else {
      const state = cfg.lockdownState;
      for (const [channelId, prev] of Object.entries(state?.channels ?? {})) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !('permissionOverwrites' in channel) || channel.isThread()) continue;
        try {
          await this.restoreEveryoneSend(channel, prev, auditLabel);
          ok++;
        } catch (err) {
          failed++;
          log.warn({ err, guild: guildId, channel: channelId }, 'Lockdown : restauration impossible');
        }
      }
      await prisma.moderationConfig.upsert({
        where: { guildId },
        create: { guildId, lockdownActive: false, lockdownState: Prisma.DbNull },
        update: { lockdownActive: false, lockdownState: Prisma.DbNull },
      });
    }
    this.invalidate(guildId);

    const sanction = await this.createSanction({ guildId, type: enabled ? 'LOCKDOWN' : 'LOCKDOWN_END', moderatorId: actorId, reason: reason ?? null, metadata: { channels: ok, failed } });
    await this.announceLockdown(guild, enabled, actorId, reason ?? null, ok, sanction);
    return { changed: true, channels: ok, failed };
  }

  private async announceLockdown(guild: Guild, enabled: boolean, actorId: string, reason: string | null, channels: number, sanction: Sanction): Promise<void> {
    const { t, lang } = await this.guildTranslator(guild.id);
    const gcfg = await guildConfigService.get(guild.id);
    const color = enabled ? BRAND.colors.danger : BRAND.colors.primary;
    const title = t(enabled ? 'moderation.lockdown.alert_title' : 'moderation.lockdown.alert_end_title');
    const description = t(enabled ? 'moderation.lockdown.alert_description' : 'moderation.lockdown.alert_end_description', { server: guild.name, channels });
    const fields = [
      { name: t('core.moderator'), value: `<@${actorId}>`, inline: true },
      { name: t('core.reason'), value: reason ?? t('core.no_reason'), inline: true },
      { name: t('core.date'), value: discordTimestamp(new Date(), 'F'), inline: true },
    ];
    await loggingService.log({ guildId: guild.id, category: 'SECURITY', action: enabled ? 'lockdown.on' : 'lockdown.off', title, description, fields, actorId, color, data: { caseNumber: sanction.caseNumber, channels, reason, lang } });
    // Alerte également dans le salon MODERATION s'il est distinct du salon SECURITY.
    const secChannel = gcfg?.logChannels.SECURITY ?? gcfg?.logChannels.SYSTEM;
    const modChannel = gcfg?.logChannels.MODERATION;
    if (modChannel && modChannel !== secChannel) {
      const channel = guild.channels.cache.get(modChannel);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).addFields(fields).setTimestamp().setFooter({ text: `${t('moderation.case', { number: sanction.caseNumber })} • ${BRAND.footer}` });
        await channel.send({ embeds: [embed] }).catch(() => null);
      }
    }
  }

  private everyoneSendState(channel: { permissionOverwrites: { cache: Collection<string, { allow: { has(p: bigint): boolean }; deny: { has(p: bigint): boolean } }> }; guild: Guild }): LockdownChannelState {
    const ow = channel.permissionOverwrites.cache.get(channel.guild.id);
    if (!ow) return 'none';
    if (ow.allow.has(PermissionFlagsBits.SendMessages)) return 'allow';
    if (ow.deny.has(PermissionFlagsBits.SendMessages)) return 'deny';
    return 'neutral';
  }

  private async restoreEveryoneSend(channel: Extract<GuildTextBasedChannel, { permissionOverwrites: unknown }> | NonNullable<ReturnType<Guild['channels']['cache']['get']>>, prev: LockdownChannelState, reason: string): Promise<void> {
    if (!('permissionOverwrites' in channel) || channel.isThread()) return;
    const everyone = channel.guild.roles.everyone;
    switch (prev) {
      case 'allow':
        await channel.permissionOverwrites.edit(everyone, { SendMessages: true }, { reason });
        return;
      case 'deny':
        await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
        return;
      case 'neutral':
        await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
        return;
      case 'none': {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
        const ow = channel.permissionOverwrites.cache.get(everyone.id);
        if (ow && ow.allow.bitfield === 0n && ow.deny.bitfield === 0n) await ow.delete(reason).catch(() => null);
      }
    }
  }

  // ─────────────────────────── Expiration (tâche planifiée) ───────────────────────────

  /** Lève les tempbans et mutes expirés. Appelé toutes les 30 s par le scheduler. */
  async expireTick(now = new Date()): Promise<{ bans: number; mutes: number }> {
    const client = this.client;
    if (!client?.user) return { bans: 0, mutes: 0 };
    const bot = client.user;
    let bans = 0;
    let mutes = 0;

    const expiredBans = await prisma.ban.findMany({ where: { active: true, expiresAt: { lte: now } }, take: 50 });
    for (const ban of expiredBans) {
      await prisma.ban.update({ where: { id: ban.id }, data: { active: false } });
      const guild = client.guilds.cache.get(ban.guildId);
      if (!guild) continue;
      try {
        const { t } = await this.guildTranslator(guild.id);
        await this.unban({ guild, userId: ban.userId, moderator: bot, reason: t('moderation.expire.tempban'), metadata: { automatic: true, banId: ban.id } });
        bans++;
      } catch (err) {
        log.warn({ err, guild: ban.guildId, user: ban.userId }, 'Tempban expiré : unban impossible');
      }
    }

    const expiredMutes = await prisma.mute.findMany({ where: { active: true, expiresAt: { lte: now } }, take: 50 });
    for (const mute of expiredMutes) {
      await prisma.mute.update({ where: { id: mute.id }, data: { active: false } });
      const guild = client.guilds.cache.get(mute.guildId);
      if (!guild) continue;
      const member = await guild.members.fetch(mute.userId).catch(() => null);
      if (!member) continue;
      try {
        const { t } = await this.guildTranslator(guild.id);
        await this.unmute({ guild, target: member, moderator: bot, reason: t('moderation.expire.mute'), metadata: { automatic: true, muteId: mute.id } });
        mutes++;
      } catch (err) {
        log.warn({ err, guild: mute.guildId, user: mute.userId }, 'Mute expiré : unmute impossible');
      }
    }
    return { bans, mutes };
  }

  // ─────────────────────────── Helpers i18n / DM / logs ───────────────────────────

  async guildTranslator(guildId: string): Promise<{ t: Translator; lang: string }> {
    const cfg = await guildConfigService.get(guildId);
    const lang = cfg?.defaultLanguage ?? 'fr';
    return { t: translationService.bind(lang, guildId), lang };
  }

  /** Libellé traduit d'un type de sanction. */
  typeLabel(t: Translator, type: SanctionType): string {
    return t(`moderation.types.${type}`);
  }

  /** Embed sobre décrivant une sanction (DM, /case, réponses). */
  buildSanctionEmbed(t: Translator, lang: string, sanction: Sanction, opts: { serverName?: string; forDm?: boolean } = {}): EmbedBuilder {
    const positive = POSITIVE_TYPES.has(sanction.type);
    const embed = new EmbedBuilder()
      .setColor(positive ? BRAND.colors.primary : BRAND.colors.danger)
      .setTitle(opts.forDm ? t('moderation.dm.title', { server: opts.serverName ?? '' }) : t('moderation.case_title', { number: sanction.caseNumber, type: this.typeLabel(t, sanction.type) }))
      .setFooter({ text: `${t('moderation.case', { number: sanction.caseNumber })} • ${BRAND.footer}` })
      .setTimestamp(sanction.createdAt);
    if (opts.forDm) embed.setDescription(t('moderation.dm.description', { sanction: this.typeLabel(t, sanction.type), server: opts.serverName ?? '' }));
    const fields: { name: string; value: string; inline: boolean }[] = [];
    if (!opts.forDm) {
      if (sanction.userId) fields.push({ name: t('core.user'), value: `<@${sanction.userId}> (\`${sanction.userId}\`)`, inline: true });
      fields.push({ name: t('core.moderator'), value: `<@${sanction.moderatorId}>`, inline: true });
      if (sanction.channelId) fields.push({ name: t('core.channel'), value: `<#${sanction.channelId}>`, inline: true });
    }
    fields.push({ name: t('core.reason'), value: (sanction.reason ?? t('core.no_reason')).slice(0, 1024), inline: false });
    if (sanction.duration) {
      fields.push({ name: t('core.duration'), value: formatDuration(sanction.duration, lang), inline: true });
      const meta = (sanction.metadata ?? null) as { expiresAt?: string } | null;
      if (meta?.expiresAt) fields.push({ name: t('moderation.expires'), value: discordTimestamp(new Date(meta.expiresAt), 'R'), inline: true });
    }
    embed.addFields(fields);
    return embed;
  }

  /** Envoie le DM si la config le permet. Retourne true si envoyé. */
  private async notify(guild: Guild, user: User, sanction: Sanction, opts: { extra?: Record<string, string | number> } = {}): Promise<boolean> {
    if (!DM_TYPES.has(sanction.type) || user.bot) return false;
    const cfg = await this.getConfig(guild.id);
    if (!cfg.dmOnSanction) return false;
    const gcfg = await guildConfigService.get(guild.id);
    const lang = translationService.resolveLanguage(gcfg?.defaultLanguage);
    const t = translationService.bind(lang, guild.id);
    const embed = this.buildSanctionEmbed(t, lang, sanction, { serverName: guild.name, forDm: true });
    if (sanction.type === 'WARN' && opts.extra?.count !== undefined) embed.addFields({ name: t('moderation.warn_count'), value: String(opts.extra.count), inline: true });
    try {
      await user.send({ embeds: [embed] });
      return true;
    } catch {
      return false;
    }
  }

  private async logSanction(guildId: string, sanction: Sanction, opts: { target?: User | null; moderator: { id: string; tag?: string }; extraFields?: { key: string; value: string; inline?: boolean }[] }): Promise<void> {
    const { t, lang } = await this.guildTranslator(guildId);
    const positive = POSITIVE_TYPES.has(sanction.type);
    const fields: { name: string; value: string; inline?: boolean }[] = [];
    if (sanction.userId) fields.push({ name: t('core.user'), value: `<@${sanction.userId}>${opts.target ? ` • ${opts.target.tag}` : ''} (\`${sanction.userId}\`)`, inline: true });
    fields.push({ name: t('core.moderator'), value: `<@${opts.moderator.id}>`, inline: true });
    if (sanction.duration) fields.push({ name: t('core.duration'), value: formatDuration(sanction.duration, lang), inline: true });
    fields.push({ name: t('core.reason'), value: sanction.reason ?? t('core.no_reason'), inline: false });
    for (const f of opts.extraFields ?? []) fields.push({ name: t(`moderation.fields.${f.key}`), value: f.value, inline: f.inline ?? true });
    await loggingService.log({
      guildId,
      category: 'MODERATION',
      action: `mod.${sanction.type.toLowerCase()}`,
      title: t('moderation.case_title', { number: sanction.caseNumber, type: this.typeLabel(t, sanction.type) }),
      fields,
      actorId: opts.moderator.id,
      targetId: sanction.userId,
      color: positive ? BRAND.colors.primary : BRAND.colors.danger,
      thumbnail: opts.target?.displayAvatarURL({ size: 128 }) ?? undefined,
      data: { caseNumber: sanction.caseNumber, type: sanction.type, reason: sanction.reason, duration: sanction.duration, channelId: sanction.channelId, metadata: sanction.metadata },
    });
  }
}

/** Erreur métier portant une clé i18n (affichée à l'utilisateur via t()). */
export class ModerationError extends Error {
  constructor(
    public readonly key: string,
    public readonly vars?: Record<string, string | number>,
  ) {
    super(key);
    this.name = 'ModerationError';
  }
}

export const moderationService = new ModerationService();
