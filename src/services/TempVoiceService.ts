import {
  ChannelType,
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type Guild,
  type GuildMember,
  type OverwriteResolvable,
  type VoiceBasedChannel,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import { Prisma, type TempVoiceConfig } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { scheduler } from './SchedulerService';
import { translationService } from './TranslationService';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';

const log = childLogger('TempVoice');

// ───────────────────────────── Constantes ─────────────────────────────

/** Salon « Créer un salon » du serveur principal : proposé (et utilisé) tant qu'aucun lobby n'est configuré. */
export const DEFAULT_LOBBY_ID = '1553447736790093944';
export const MAX_LOBBIES = 10;
export const MAX_RULES = 20;
export const MAX_USER_LIMIT = 99;
/** Longueur maximale d'un nom de salon Discord. */
export const CHANNEL_NAME_MAX = 100;
/** Longueur maximale du pseudo inséré à la place de `{name}`. */
export const MEMBER_NAME_MAX = 32;
/** Délai avant la suppression d'un salon vide (absorbe les reconnexions rapides). */
export const DELETE_GRACE_MS = 5_000;
/** Une création de salon par membre toutes les 10 s au maximum. */
export const CREATE_COOLDOWN_MS = 10_000;
/** Un log « permissions manquantes » par serveur toutes les 10 min au maximum. */
const ERROR_LOG_THROTTLE_MS = 10 * 60_000;
const NAME_TOKEN = '{name}';

export interface VoiceLanguagePreset {
  key: string;
  /** Nom de la langue dans la langue elle-même */
  label: string;
  emoji: string;
  /** Modèle du nom de salon dans cette langue (`{name}` = pseudo du membre) */
  template: string;
  /** Noms de rôles reconnus par la détection automatique (minuscules, sans accents) */
  keywords: string[];
}

/** Langues proposées : le propriétaire associe chacune à un rôle (fr → « 🇫🇷 Salon de {name} », en → « 🇬🇧 {name}'s lobby »…). */
export const VOICE_LANGUAGE_PRESETS: VoiceLanguagePreset[] = [
  { key: 'fr', label: 'Français', emoji: '🇫🇷', template: 'Salon de {name}', keywords: ['fr', 'francais', 'french', 'france', 'francophone'] },
  { key: 'en', label: 'English', emoji: '🇬🇧', template: "{name}'s lobby", keywords: ['en', 'english', 'anglais', 'uk', 'us', 'anglophone'] },
  { key: 'es', label: 'Español', emoji: '🇪🇸', template: 'Sala de {name}', keywords: ['es', 'espanol', 'spanish', 'espagnol', 'espana'] },
  { key: 'de', label: 'Deutsch', emoji: '🇩🇪', template: 'Raum von {name}', keywords: ['de', 'deutsch', 'german', 'allemand'] },
  { key: 'it', label: 'Italiano', emoji: '🇮🇹', template: 'Stanza di {name}', keywords: ['it', 'italiano', 'italian', 'italien'] },
  { key: 'pt', label: 'Português', emoji: '🇵🇹', template: 'Sala de {name}', keywords: ['pt', 'portugues', 'portuguese', 'portugais', 'br', 'brasil'] },
  { key: 'ar', label: 'العربية', emoji: '🇸🇦', template: 'غرفة {name}', keywords: ['ar', 'arabic', 'arabe', 'العربية', 'عربي'] },
  { key: 'tr', label: 'Türkçe', emoji: '🇹🇷', template: '{name} odası', keywords: ['tr', 'turkce', 'turkish', 'turc'] },
  { key: 'pl', label: 'Polski', emoji: '🇵🇱', template: 'Pokój {name}', keywords: ['pl', 'polski', 'polish', 'polonais'] },
  { key: 'ru', label: 'Русский', emoji: '🇷🇺', template: 'Комната {name}', keywords: ['ru', 'русский', 'russian', 'russe'] },
  { key: 'nl', label: 'Nederlands', emoji: '🇳🇱', template: 'Kamer van {name}', keywords: ['nl', 'nederlands', 'dutch', 'neerlandais'] },
];
export const CUSTOM_PRESET = 'custom';
export const FALLBACK_PRESET_KEY = 'en';

export function getVoicePreset(key: string | null | undefined): VoiceLanguagePreset | undefined {
  return VOICE_LANGUAGE_PRESETS.find((p) => p.key === key);
}

// ───────────────────────────── Schémas ─────────────────────────────

const snowflake = z.string().regex(/^\d{15,22}$/, 'identifiant Discord invalide');
/** Emoji Unicode (drapeau…) : pas d'espace ni d'emoji personnalisé (non affichés dans un nom de salon). */
export const voiceEmojiSchema = z
  .string()
  .trim()
  .max(16)
  .refine((s) => !/[\s<>@#:]/.test(s), 'emoji Unicode attendu (les emojis personnalisés ne s’affichent pas dans un nom de salon)');
export const voiceTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(90)
  .refine((s) => !/[\r\n]/.test(s), 'une seule ligne')
  .refine((s) => s.includes(NAME_TOKEN), 'le modèle doit contenir {name}');

export const voiceNameRuleSchema = z.object({
  preset: z.string().trim().max(16).default(CUSTOM_PRESET),
  emoji: voiceEmojiSchema.default(''),
  template: voiceTemplateSchema,
});
export type VoiceNameRule = z.infer<typeof voiceNameRuleSchema>;

export const voiceRuleSchema = voiceNameRuleSchema.extend({ roleId: snowflake });
export type VoiceRule = z.infer<typeof voiceRuleSchema>;

export const voiceRulesSchema = z.array(voiceRuleSchema).max(MAX_RULES);
export const lobbyIdsSchema = z.array(snowflake).max(MAX_LOBBIES);
export const userLimitSchema = z.number().int().min(0).max(MAX_USER_LIMIT).nullable();

export interface TempVoiceSettings {
  guildId: string;
  /** false tant que rien n'a été enregistré (le lobby par défaut est alors proposé et utilisé s'il existe) */
  configured: boolean;
  lobbyIds: string[];
  categoryId: string | null;
  userLimit: number | null;
  rules: VoiceRule[];
  fallback: VoiceNameRule;
  ownerPermissions: boolean;
  transferOwnership: boolean;
}

export type TempVoicePatch = Partial<Omit<TempVoiceSettings, 'guildId' | 'configured'>>;

/** Règle de repli par défaut : anglais. */
export function defaultFallback(): VoiceNameRule {
  const en = getVoicePreset(FALLBACK_PRESET_KEY)!;
  return { preset: en.key, emoji: en.emoji, template: en.template };
}

/** Règle prête à l'emploi pour un rôle et une langue proposée. */
export function ruleFromPreset(roleId: string, presetKey: string): VoiceRule {
  const preset = getVoicePreset(presetKey) ?? getVoicePreset(FALLBACK_PRESET_KEY)!;
  return { roleId, preset: preset.key, emoji: preset.emoji, template: preset.template };
}

function parseList<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Lecture tolérante d'une ligne de configuration (entrées invalides ignorées). */
export function toTempVoiceSettings(guildId: string, row: TempVoiceConfig | null | undefined): TempVoiceSettings {
  const fallback = row?.fallback ? voiceNameRuleSchema.safeParse(row.fallback) : null;
  const lobbies = parseList(snowflake, row?.lobbyIds);
  return {
    guildId,
    configured: Boolean(row),
    lobbyIds: [...new Set(lobbies)].slice(0, MAX_LOBBIES),
    categoryId: row?.categoryId ?? null,
    userLimit: typeof row?.userLimit === 'number' ? Math.max(0, Math.min(MAX_USER_LIMIT, row.userLimit)) : null,
    rules: parseList(voiceRuleSchema, row?.rules).slice(0, MAX_RULES),
    fallback: fallback?.success ? fallback.data : defaultFallback(),
    ownerPermissions: row?.ownerPermissions ?? true,
    transferOwnership: row?.transferOwnership ?? true,
  };
}

// ───────────────────────────── Noms de salons (fonctions pures) ─────────────────────────────

/** Coupe une chaîne sans casser un caractère (paires de substitution) pour tenir en `max` unités UTF-16. */
export function truncateUnits(s: string, max: number, ellipsis = '…'): string {
  if (s.length <= max) return s;
  const chars = Array.from(s);
  let out = '';
  const budget = Math.max(0, max - ellipsis.length);
  for (const c of chars) {
    if (out.length + c.length > budget) break;
    out += c;
  }
  return `${out.trimEnd()}${ellipsis}`;
}

/**
 * Nettoie un pseudo pour un nom de salon : caractères de contrôle, invisibles et de direction retirés,
 * espaces fusionnés, 32 caractères maximum. Chaîne vide si rien d'affichable.
 */
export function sanitizeMemberName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[­​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateUnits(cleaned, MEMBER_NAME_MAX);
}

/** Pseudo affiché du membre, sinon son nom d'utilisateur, sinon « ? ». */
export function memberDisplayName(member: { displayName?: string | null; user?: { globalName?: string | null; username?: string | null } | null }): string {
  return sanitizeMemberName(member.displayName) || sanitizeMemberName(member.user?.globalName) || sanitizeMemberName(member.user?.username) || '?';
}

/**
 * Nom du salon : `<emoji> <modèle avec {name}>`, 100 caractères maximum.
 * Si c'est trop long, seul le pseudo est raccourci (le modèle et le drapeau restent lisibles).
 */
export function buildChannelName(rule: Pick<VoiceNameRule, 'emoji' | 'template'>, name: string): string {
  const prefix = rule.emoji ? `${rule.emoji.trim()} ` : '';
  const template = rule.template.includes(NAME_TOKEN) ? rule.template : `${rule.template} ${NAME_TOKEN}`;
  const base = `${prefix}${template}`.replace(/\s+/g, ' ').trim();
  const occurrences = base.split(NAME_TOKEN).length - 1;
  const fixed = base.length - occurrences * NAME_TOKEN.length;
  const perName = Math.max(1, Math.floor((CHANNEL_NAME_MAX - fixed) / Math.max(1, occurrences)));
  const safeName = truncateUnits(name || '?', Math.min(perName, MEMBER_NAME_MAX));
  const full = base.split(NAME_TOKEN).join(safeName).replace(/\s+/g, ' ').trim();
  return truncateUnits(full, CHANNEL_NAME_MAX);
}

export interface ResolvedRule {
  rule: VoiceNameRule;
  /** Index de la règle appliquée ; -1 = règle de repli */
  index: number;
  roleId: string | null;
}

/** Première règle dont le membre a le rôle (dans l'ordre configuré), sinon la règle de repli. */
export function resolveRule(memberRoleIds: Iterable<string>, rules: readonly VoiceRule[], fallback: VoiceNameRule): ResolvedRule {
  const owned = memberRoleIds instanceof Set ? (memberRoleIds as Set<string>) : new Set(memberRoleIds);
  const index = rules.findIndex((r) => owned.has(r.roleId));
  if (index === -1) return { rule: fallback, index: -1, roleId: null };
  return { rule: rules[index]!, index, roleId: rules[index]!.roleId };
}

/** Modèle unique des salons créés : « <pseudo> Lobby » (sans drapeau ni langue). */
export const LOBBY_NAME_RULE: Pick<VoiceNameRule, 'emoji' | 'template'> = { emoji: '', template: '{name} Lobby' };

/** Nom complet du salon d'un membre : « <pseudo> Lobby », nettoyé, 100 caractères maximum. */
export function resolveChannelName(_memberRoleIds: Iterable<string>, displayName: string, _settings?: Pick<TempVoiceSettings, 'rules' | 'fallback'>): string {
  return buildChannelName(LOBBY_NAME_RULE, displayName);
}

const normalizeRoleName = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Détection des rôles de langue : un rôle est associé à une langue si son nom (sans emoji ni ponctuation)
 * est l'un des mots-clés de la langue, ou s'il contient son drapeau. Un rôle par langue, dans l'ordre des langues proposées.
 */
export function detectLanguageRoles(roles: readonly { id: string; name: string }[], existing: readonly VoiceRule[] = []): VoiceRule[] {
  const used = new Set(existing.map((r) => r.roleId));
  const out: VoiceRule[] = [];
  for (const preset of VOICE_LANGUAGE_PRESETS) {
    const match = roles.find((role) => {
      if (used.has(role.id)) return false;
      if (role.name.includes(preset.emoji)) return true;
      const words = normalizeRoleName(role.name);
      const parts = words.split(' ');
      // Codes courts (fr, en, de…) : nom exact uniquement ; mots complets (français, english…) : nom d'au plus deux mots.
      return preset.keywords.some((k) => words === k || (k.length > 2 && parts.length <= 2 && parts.includes(k)));
    });
    if (!match) continue;
    used.add(match.id);
    out.push(ruleFromPreset(match.id, preset.key));
  }
  return out;
}

/** Lobbies effectifs : ceux configurés, ou le salon par défaut tant que rien n'est enregistré (s'il existe). */
export function effectiveLobbyIds(settings: Pick<TempVoiceSettings, 'configured' | 'lobbyIds'>, channelExists: (id: string) => boolean): string[] {
  if (settings.configured) return settings.lobbyIds;
  return channelExists(DEFAULT_LOBBY_ID) ? [DEFAULT_LOBBY_ID] : [];
}

// ───────────────────────────── Décisions (fonctions pures) ─────────────────────────────

export type JoinDecision = { kind: 'ignore' } | { kind: 'move'; channelId: string } | { kind: 'create' } | { kind: 'rate_limited'; retryInMs: number };

/**
 * Un membre vient d'entrer dans un salon : que faire ?
 *  - ignore       : pas un lobby, module coupé, création déjà en cours pour ce membre
 *  - move         : il possède déjà un salon temporaire actif → il y est déplacé
 *  - rate_limited : il a créé un salon il y a moins de 10 s
 *  - create       : nouveau salon à son nom
 */
export function decideLobbyJoin(input: {
  joinedChannelId: string | null;
  lobbyIds: readonly string[];
  moduleEnabled: boolean;
  ownedChannelId: string | null;
  busy: boolean;
  lastCreatedAt: number | undefined;
  now: number;
  cooldownMs?: number;
}): JoinDecision {
  if (!input.moduleEnabled || !input.joinedChannelId || !input.lobbyIds.includes(input.joinedChannelId)) return { kind: 'ignore' };
  if (input.busy) return { kind: 'ignore' };
  if (input.ownedChannelId) return { kind: 'move', channelId: input.ownedChannelId };
  const cooldown = input.cooldownMs ?? CREATE_COOLDOWN_MS;
  if (input.lastCreatedAt !== undefined && input.now - input.lastCreatedAt < cooldown) return { kind: 'rate_limited', retryInMs: cooldown - (input.now - input.lastCreatedAt) };
  return { kind: 'create' };
}

/** Membre présent depuis le plus longtemps (ordre d'arrivée connu, sinon ordre de la liste). */
export function pickNewOwner(memberIds: readonly string[], joinedAt: ReadonlyMap<string, number>, previousOwnerId: string): string | null {
  const candidates = memberIds.filter((id) => id !== previousOwnerId);
  if (!candidates.length) return null;
  let best = candidates[0]!;
  let bestAt = joinedAt.get(best) ?? Number.POSITIVE_INFINITY;
  for (const id of candidates.slice(1)) {
    const at = joinedAt.get(id) ?? Number.POSITIVE_INFINITY;
    if (at < bestAt) {
      best = id;
      bestAt = at;
    }
  }
  return best;
}

export type LeaveDecision = { kind: 'schedule_delete' } | { kind: 'transfer'; newOwnerId: string } | { kind: 'keep' };

/**
 * Un membre vient de quitter un salon temporaire :
 *  - plus aucun humain → suppression après le délai de grâce ;
 *  - le créateur est parti, d'autres restent → transfert au plus ancien (si activé) ;
 *  - sinon rien.
 */
export function decideLeave(input: { remainingHumanIds: readonly string[]; leaverId: string; ownerId: string; transferEnabled: boolean; joinedAt: ReadonlyMap<string, number> }): LeaveDecision {
  if (!input.remainingHumanIds.length) return { kind: 'schedule_delete' };
  if (input.leaverId !== input.ownerId || !input.transferEnabled || input.remainingHumanIds.includes(input.ownerId)) return { kind: 'keep' };
  const next = pickNewOwner(input.remainingHumanIds, input.joinedAt, input.ownerId);
  return next ? { kind: 'transfer', newOwnerId: next } : { kind: 'keep' };
}

export interface StoredTempChannel {
  channelId: string;
  guildId: string;
  ownerId: string;
  lobbyId: string | null;
  createdAt: Date;
}

/** État d'un salon enregistré au démarrage : serveur absent, indisponible, salon disparu, ou salon présent avec N humains. */
export type ChannelProbe = { state: 'guild_missing' } | { state: 'guild_unavailable' } | { state: 'channel_missing' } | { state: 'present'; humans: number };

export interface CleanupPlan {
  /** Lignes à oublier (salon ou serveur disparu) */
  forget: string[];
  /** Salons vides à supprimer */
  remove: string[];
  /** Salons occupés (ou serveur momentanément indisponible) à garder en mémoire */
  keep: StoredTempChannel[];
}

/** Nettoyage au démarrage : salons supprimés pendant l'arrêt oubliés, salons restés vides supprimés, les autres repris. */
export function planStartupCleanup(rows: readonly StoredTempChannel[], probe: (row: StoredTempChannel) => ChannelProbe): CleanupPlan {
  const plan: CleanupPlan = { forget: [], remove: [], keep: [] };
  for (const row of rows) {
    const p = probe(row);
    if (p.state === 'guild_missing' || p.state === 'channel_missing') plan.forget.push(row.channelId);
    else if (p.state === 'guild_unavailable') plan.keep.push(row);
    else if (p.humans === 0) plan.remove.push(row.channelId);
    else plan.keep.push(row);
  }
  return plan;
}

// ───────────────────────────── Permissions ─────────────────────────────

/** Droits du créateur sur son salon. */
export const OWNER_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MoveMembers,
] as const;
/** Permissions du bot nécessaires pour créer les salons et y déplacer les membres. */
export const REQUIRED_BOT_PERMISSIONS = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel] as const;

/** Permissions manquantes au bot (niveau serveur) pour gérer les salons temporaires. */
export function missingBotPermissions(perms: Readonly<PermissionsBitField> | null | undefined): bigint[] {
  if (!perms) return [...REQUIRED_BOT_PERMISSIONS];
  if (perms.has(PermissionFlagsBits.Administrator)) return [];
  return REQUIRED_BOT_PERMISSIONS.filter((p) => !perms.has(p));
}

/**
 * Restreint une permission d'écrasement à ce que le bot peut accorder : Discord refuse la création d'un salon
 * dont les permissions donnent ou retirent un droit que le bot n'a pas (et « Gérer les rôles » hors administrateur).
 */
export function clampOverwriteBits(bits: bigint, botPerms: bigint): bigint {
  if ((botPerms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return bits;
  return bits & botPerms & ~PermissionFlagsBits.ManageRoles;
}

/** Permissions du nouveau salon : copie de celles du lobby (bornées), puis droits du créateur et du bot. */
export function buildOverwrites(input: {
  lobby: readonly { id: string; type: OverwriteType; allow: bigint; deny: bigint }[];
  botId: string;
  botPerms: bigint;
  ownerId: string;
  ownerPermissions: boolean;
}): OverwriteResolvable[] {
  const out = new Map<string, { id: string; type: OverwriteType; allow: bigint; deny: bigint }>();
  for (const o of input.lobby) out.set(o.id, { id: o.id, type: o.type, allow: clampOverwriteBits(o.allow, input.botPerms), deny: clampOverwriteBits(o.deny, input.botPerms) });
  const grant = (id: string, type: OverwriteType, bits: bigint) => {
    const allowed = clampOverwriteBits(bits, input.botPerms);
    const prev = out.get(id);
    out.set(id, { id, type, allow: (prev?.allow ?? 0n) | allowed, deny: (prev?.deny ?? 0n) & ~allowed });
  };
  const botBits = REQUIRED_BOT_PERMISSIONS.reduce((acc, p) => acc | p, 0n);
  grant(input.botId, OverwriteType.Member, botBits);
  if (input.ownerPermissions) grant(input.ownerId, OverwriteType.Member, OWNER_PERMISSIONS.reduce((acc, p) => acc | p, 0n));
  return [...out.values()].filter((o) => o.allow !== 0n || o.deny !== 0n);
}

// ───────────────────────────── Service ─────────────────────────────

interface TrackedChannel {
  guildId: string;
  ownerId: string;
  lobbyId: string | null;
  createdAt: Date;
  /** Heure d'arrivée de chaque membre présent (transfert au plus ancien) */
  joinedAt: Map<string, number>;
}

export interface ActiveTempChannel {
  channelId: string;
  ownerId: string;
  lobbyId: string | null;
  createdAt: Date;
  name: string | null;
  members: number;
  exists: boolean;
}

const isPermissionError = (err: unknown): boolean => err instanceof DiscordAPIError && (err.code === 50013 || err.code === 50001);
const isUnknownChannel = (err: unknown): boolean => err instanceof DiscordAPIError && err.code === 10003;

const humansIn = (channel: VoiceBasedChannel): string[] => [...channel.members.values()].filter((m) => !m.user.bot).map((m) => m.id);

/**
 * Salons vocaux temporaires (« Créer un salon ») : rejoindre un lobby crée un salon vocal au nom du membre
 * (langue choisie selon ses rôles), il y est déplacé ; le salon est supprimé quand il se vide.
 * Les salons actifs sont enregistrés en base pour être nettoyés après un redémarrage.
 */
export class TempVoiceService {
  private client: Client | null = null;
  private readonly configCache = new TTLCache<TempVoiceSettings>(5 * 60_000, 2000);
  private readonly channels = new Map<string, TrackedChannel>();
  /** `${guildId}:${ownerId}` → salon */
  private readonly owners = new Map<string, string>();
  private readonly deleteTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastCreate = new Map<string, number>();
  private readonly creating = new Set<string>();
  private readonly lastErrorLog = new Map<string, number>();

  async attach(client: Client): Promise<void> {
    this.client = client;
    if (!scheduler.registered.includes('vocal:sweep')) scheduler.register({ name: 'vocal:sweep', intervalMs: 60_000, run: () => this.sweep() });
    await this.restore(client);
  }

  // ───── Configuration ─────

  async getConfig(guildId: string): Promise<TempVoiceSettings> {
    return this.configCache.getOrSet(guildId, async () => toTempVoiceSettings(guildId, await prisma.tempVoiceConfig.findUnique({ where: { guildId } })));
  }

  async updateConfig(guildId: string, patch: TempVoicePatch): Promise<TempVoiceSettings> {
    const current = await this.getConfig(guildId);
    const next = {
      lobbyIds: patch.lobbyIds !== undefined ? lobbyIdsSchema.parse([...new Set(patch.lobbyIds)]) : current.configured ? current.lobbyIds : effectiveLobbyIds(current, (id) => this.channelExists(guildId, id)),
      categoryId: patch.categoryId !== undefined ? (patch.categoryId === null ? null : snowflake.parse(patch.categoryId)) : current.categoryId,
      userLimit: patch.userLimit !== undefined ? userLimitSchema.parse(patch.userLimit) : current.userLimit,
      rules: patch.rules !== undefined ? voiceRulesSchema.parse(dedupeRules(patch.rules)) : current.rules,
      fallback: patch.fallback !== undefined ? voiceNameRuleSchema.parse(patch.fallback) : current.fallback,
      ownerPermissions: patch.ownerPermissions ?? current.ownerPermissions,
      transferOwnership: patch.transferOwnership ?? current.transferOwnership,
    };
    const data = {
      lobbyIds: next.lobbyIds as Prisma.InputJsonValue,
      categoryId: next.categoryId,
      userLimit: next.userLimit,
      rules: next.rules as unknown as Prisma.InputJsonValue,
      fallback: next.fallback as unknown as Prisma.InputJsonValue,
      ownerPermissions: next.ownerPermissions,
      transferOwnership: next.transferOwnership,
    };
    await prisma.tempVoiceConfig.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
    const settings: TempVoiceSettings = { guildId, configured: true, ...next };
    this.configCache.set(guildId, settings);
    return settings;
  }

  /** Lobbies effectifs d'un serveur (configurés, ou le salon par défaut s'il existe). */
  lobbiesFor(guild: Guild | null | undefined, settings: TempVoiceSettings): string[] {
    return effectiveLobbyIds(settings, (id) => Boolean(guild?.channels.cache.get(id)?.isVoiceBased()));
  }

  private channelExists(guildId: string, id: string): boolean {
    return Boolean(this.client?.guilds.cache.get(guildId)?.channels.cache.get(id)?.isVoiceBased());
  }

  // ───── État ─────

  isTempChannel(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  ownedChannel(guildId: string, userId: string): string | null {
    return this.owners.get(`${guildId}:${userId}`) ?? null;
  }

  /** Salons temporaires actifs d'un serveur (base + état Discord en direct). */
  async listActive(guildId: string, guild?: Guild | null): Promise<ActiveTempChannel[]> {
    const rows = (await prisma.tempVoiceChannel.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } })) ?? [];
    return rows.map((r) => {
      const channel = guild?.channels.cache.get(r.channelId);
      const voice = channel?.isVoiceBased() ? channel : null;
      return { channelId: r.channelId, ownerId: r.ownerId, lobbyId: r.lobbyId, createdAt: r.createdAt, name: voice?.name ?? null, members: voice ? humansIn(voice).length : 0, exists: Boolean(voice) };
    });
  }

  // ───── Événements ─────

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.channelId === newState.channelId) return;
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    const now = Date.now();
    if (oldState.channelId && this.channels.has(oldState.channelId)) await this.onLeaveTemp(oldState, member);
    if (newState.channelId && this.channels.has(newState.channelId)) this.onJoinTemp(newState.channelId, member.id, now);
    if (newState.channelId && newState.channel) await this.onMaybeLobby(newState, member, now);
  }

  /** Salon supprimé (à la main ou par le bot) : on l'oublie. */
  async handleChannelDelete(channelId: string): Promise<void> {
    if (!this.channels.has(channelId)) {
      // Salon inconnu en mémoire (ex. après une erreur) : la base est quand même nettoyée.
      await prisma.tempVoiceChannel.deleteMany({ where: { channelId } }).catch(() => null);
      return;
    }
    await this.forget(channelId);
  }

  private onJoinTemp(channelId: string, userId: string, now: number): void {
    this.cancelDelete(channelId);
    const tracked = this.channels.get(channelId);
    if (tracked && !tracked.joinedAt.has(userId)) tracked.joinedAt.set(userId, now);
  }

  private async onLeaveTemp(oldState: VoiceState, member: GuildMember): Promise<void> {
    const channelId = oldState.channelId!;
    const tracked = this.channels.get(channelId);
    if (!tracked) return;
    tracked.joinedAt.delete(member.id);
    const channel = oldState.channel ?? oldState.guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) {
      await this.forget(channelId);
      return;
    }
    const settings = await this.getConfig(oldState.guild.id);
    const decision = decideLeave({ remainingHumanIds: humansIn(channel), leaverId: member.id, ownerId: tracked.ownerId, transferEnabled: settings.transferOwnership, joinedAt: tracked.joinedAt });
    if (decision.kind === 'schedule_delete') this.scheduleDelete(channelId);
    else if (decision.kind === 'transfer') await this.transferOwnership(channel, tracked, decision.newOwnerId, settings);
  }

  private async onMaybeLobby(state: VoiceState, member: GuildMember, now: number): Promise<void> {
    const guild = state.guild;
    const config = await guildConfigService.get(guild.id);
    if (!config?.modules.vocal) return;
    const settings = await this.getConfig(guild.id);
    const lobbies = this.lobbiesFor(guild, settings);
    const key = `${guild.id}:${member.id}`;
    const owned = this.owners.get(key) ?? null;
    const ownedAlive = owned && guild.channels.cache.get(owned)?.isVoiceBased() ? owned : null;
    if (owned && !ownedAlive) await this.forget(owned);
    const decision = decideLobbyJoin({ joinedChannelId: state.channelId, lobbyIds: lobbies, moduleEnabled: true, ownedChannelId: ownedAlive, busy: this.creating.has(key), lastCreatedAt: this.lastCreate.get(key), now });
    if (decision.kind === 'ignore') return;
    if (decision.kind === 'rate_limited') {
      log.debug({ guild: guild.id, member: member.id, retryInMs: decision.retryInMs }, 'Création de salon vocal limitée');
      return;
    }
    if (decision.kind === 'move') {
      const target = guild.channels.cache.get(decision.channelId);
      if (target?.isVoiceBased()) await member.voice.setChannel(target, 'Salon vocal temporaire').catch((err) => this.reportError(guild, err, 'move'));
      return;
    }
    this.creating.add(key);
    try {
      await this.createFor(member, state.channel as VoiceBasedChannel, settings);
    } finally {
      this.creating.delete(key);
    }
  }

  // ───── Création / suppression ─────

  private async createFor(member: GuildMember, lobby: VoiceBasedChannel, settings: TempVoiceSettings): Promise<void> {
    const guild = member.guild;
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    const missing = missingBotPermissions(me?.permissions);
    if (!me || missing.length) {
      await this.reportError(guild, null, 'permissions', missing);
      return;
    }
    const key = `${guild.id}:${member.id}`;
    this.lastCreate.set(key, Date.now());
    const name = resolveChannelName(member.roles.cache.keys(), memberDisplayName(member), settings);
    const category = settings.categoryId ? guild.channels.cache.get(settings.categoryId) : null;
    const parent = category && category.type === ChannelType.GuildCategory ? category.id : lobby.parentId;
    const lobbyOverwrites = [...lobby.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));
    const base = {
      name,
      type: ChannelType.GuildVoice as const,
      parent: parent ?? undefined,
      userLimit: settings.userLimit ?? lobby.userLimit ?? 0,
      bitrate: lobby.bitrate,
      rtcRegion: lobby.rtcRegion ?? undefined,
      videoQualityMode: lobby.type === ChannelType.GuildVoice ? (lobby as VoiceChannel).videoQualityMode ?? undefined : undefined,
      reason: `Salon vocal temporaire de ${member.user.tag}`,
    };
    let channel: VoiceChannel;
    try {
      channel = await guild.channels.create({ ...base, permissionOverwrites: buildOverwrites({ lobby: lobbyOverwrites, botId: me.id, botPerms: me.permissions.bitfield, ownerId: member.id, ownerPermissions: settings.ownerPermissions }) });
    } catch (err) {
      if (!isPermissionError(err)) {
        await this.reportError(guild, err, 'create');
        return;
      }
      // Permissions copiées refusées : salon créé avec celles de la catégorie.
      try {
        channel = await guild.channels.create(base);
      } catch (retryErr) {
        await this.reportError(guild, retryErr, 'create');
        return;
      }
    }

    const now = Date.now();
    this.track(channel.id, { guildId: guild.id, ownerId: member.id, lobbyId: lobby.id, createdAt: new Date(now), joinedAt: new Map() });
    await prisma.tempVoiceChannel
      .create({ data: { channelId: channel.id, guildId: guild.id, ownerId: member.id, lobbyId: lobby.id } })
      .catch((err) => log.error({ err, channel: channel.id }, 'Enregistrement du salon temporaire impossible'));

    // Le membre a pu quitter le lobby pendant la création : on ne le déplace que s'il attend encore dans un lobby.
    const current = member.voice.channelId;
    if (!current || !this.lobbiesFor(guild, settings).includes(current)) {
      this.scheduleDelete(channel.id);
      return;
    }
    try {
      await member.voice.setChannel(channel, 'Salon vocal temporaire');
      this.onJoinTemp(channel.id, member.id, now);
    } catch (err) {
      await this.reportError(guild, err, 'move');
      await this.deleteChannel(channel.id);
    }
  }

  private track(channelId: string, tracked: TrackedChannel): void {
    this.channels.set(channelId, tracked);
    this.owners.set(`${tracked.guildId}:${tracked.ownerId}`, channelId);
  }

  /** Programme la suppression (annulée si quelqu'un revient dans les 5 s). */
  scheduleDelete(channelId: string, delayMs = DELETE_GRACE_MS): void {
    this.cancelDelete(channelId);
    const timer = setTimeout(() => {
      this.deleteTimers.delete(channelId);
      void this.deleteIfEmpty(channelId).catch((err) => log.error({ err, channel: channelId }, 'Suppression du salon temporaire en erreur'));
    }, delayMs);
    timer.unref?.();
    this.deleteTimers.set(channelId, timer);
  }

  cancelDelete(channelId: string): void {
    const timer = this.deleteTimers.get(channelId);
    if (timer) clearTimeout(timer);
    this.deleteTimers.delete(channelId);
  }

  hasPendingDelete(channelId: string): boolean {
    return this.deleteTimers.has(channelId);
  }

  private async deleteIfEmpty(channelId: string): Promise<void> {
    const tracked = this.channels.get(channelId);
    if (!tracked) return;
    const channel = this.client?.guilds.cache.get(tracked.guildId)?.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) {
      await this.forget(channelId);
      return;
    }
    if (humansIn(channel).length) return;
    await this.deleteChannel(channelId);
  }

  private async deleteChannel(channelId: string): Promise<void> {
    const tracked = this.channels.get(channelId);
    const guild = tracked ? this.client?.guilds.cache.get(tracked.guildId) : null;
    const channel = guild?.channels.cache.get(channelId);
    if (channel) {
      try {
        await channel.delete('Salon vocal temporaire vide');
      } catch (err) {
        if (!isUnknownChannel(err)) {
          if (guild) await this.reportError(guild, err, 'delete');
          return;
        }
      }
    }
    await this.forget(channelId);
  }

  private async forget(channelId: string): Promise<void> {
    this.cancelDelete(channelId);
    const tracked = this.channels.get(channelId);
    this.channels.delete(channelId);
    if (tracked) {
      const key = `${tracked.guildId}:${tracked.ownerId}`;
      if (this.owners.get(key) === channelId) this.owners.delete(key);
    }
    await prisma.tempVoiceChannel.deleteMany({ where: { channelId } }).catch((err) => log.warn({ err, channel: channelId }, 'Oubli du salon temporaire impossible'));
  }

  private async transferOwnership(channel: VoiceBasedChannel, tracked: TrackedChannel, newOwnerId: string, settings: TempVoiceSettings): Promise<void> {
    const previous = tracked.ownerId;
    const oldKey = `${tracked.guildId}:${previous}`;
    if (this.owners.get(oldKey) === channel.id) this.owners.delete(oldKey);
    tracked.ownerId = newOwnerId;
    this.owners.set(`${tracked.guildId}:${newOwnerId}`, channel.id);
    await prisma.tempVoiceChannel.updateMany({ where: { channelId: channel.id }, data: { ownerId: newOwnerId } }).catch((err) => log.warn({ err }, 'Transfert du salon temporaire non enregistré'));
    if (settings.ownerPermissions) {
      try {
        await channel.permissionOverwrites.delete(previous, 'Salon vocal temporaire : créateur parti');
        const me = channel.guild.members.me;
        const bits = clampOverwriteBits(OWNER_PERMISSIONS.reduce((acc, p) => acc | p, 0n), me?.permissions.bitfield ?? 0n);
        await channel.permissionOverwrites.edit(newOwnerId, Object.fromEntries(new PermissionsBitField(bits).toArray().map((p) => [p, true])), { reason: 'Salon vocal temporaire : nouveau propriétaire', type: OverwriteType.Member });
      } catch (err) {
        await this.reportError(channel.guild, err, 'transfer');
      }
    }
    const t = await this.translator(channel.guild.id);
    await loggingService.log({
      guildId: channel.guild.id,
      category: 'VOICE',
      action: 'vocal.transfer',
      title: t('vocal.log.transfer_title'),
      description: t('vocal.log.transfer', { channel: `<#${channel.id}>`, from: `<@${previous}>`, to: `<@${newOwnerId}>` }),
      actorId: previous,
      targetId: newOwnerId,
      color: BRAND.colors.primary,
      skipDatabase: true,
    });
  }

  // ───── Démarrage / maintenance ─────

  /** Recharge les salons enregistrés : supprime ceux restés vides, oublie ceux disparus. */
  async restore(client: Client): Promise<CleanupPlan> {
    this.client = client;
    const rows = (await prisma.tempVoiceChannel.findMany()) ?? [];
    const plan = planStartupCleanup(rows, (row) => {
      const guild = client.guilds.cache.get(row.guildId);
      if (!guild) return { state: 'guild_missing' };
      if (!guild.available) return { state: 'guild_unavailable' };
      const channel = guild.channels.cache.get(row.channelId);
      if (!channel || !channel.isVoiceBased()) return { state: 'channel_missing' };
      return { state: 'present', humans: humansIn(channel).length };
    });
    const now = Date.now();
    for (const row of [...plan.keep, ...rows.filter((r) => plan.remove.includes(r.channelId))]) {
      const guild = client.guilds.cache.get(row.guildId);
      const channel = guild?.channels.cache.get(row.channelId);
      const present = channel?.isVoiceBased() ? humansIn(channel) : [];
      this.track(row.channelId, { guildId: row.guildId, ownerId: row.ownerId, lobbyId: row.lobbyId, createdAt: row.createdAt, joinedAt: new Map(present.map((id) => [id, now])) });
    }
    if (plan.forget.length) await prisma.tempVoiceChannel.deleteMany({ where: { channelId: { in: plan.forget } } }).catch((err) => log.warn({ err }, 'Nettoyage des salons temporaires disparus impossible'));
    for (const id of plan.remove) await this.deleteChannel(id);
    if (rows.length) log.info({ kept: plan.keep.length, removed: plan.remove.length, forgotten: plan.forget.length }, 'Salons vocaux temporaires repris');
    return plan;
  }

  /** Filet de sécurité périodique : salons vides sans suppression programmée, salons disparus, limites expirées. */
  async sweep(now = Date.now()): Promise<void> {
    for (const [channelId, tracked] of this.channels) {
      if (this.deleteTimers.has(channelId)) continue;
      const guild = this.client?.guilds.cache.get(tracked.guildId);
      if (!guild || !guild.available) continue;
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isVoiceBased()) await this.forget(channelId);
      else if (!humansIn(channel).length) this.scheduleDelete(channelId);
    }
    for (const [key, at] of this.lastCreate) if (now - at >= CREATE_COOLDOWN_MS) this.lastCreate.delete(key);
    for (const [key, at] of this.lastErrorLog) if (now - at >= ERROR_LOG_THROTTLE_MS) this.lastErrorLog.delete(key);
  }

  // ───── Erreurs ─────

  private async translator(guildId: string) {
    const config = await guildConfigService.get(guildId).catch(() => null);
    return translationService.bind(config?.defaultLanguage ?? 'fr', guildId);
  }

  /** Journalise une erreur (jamais d'exception) ; une entrée par serveur et par étape toutes les 10 min au plus. */
  private async reportError(guild: Guild, err: unknown, step: 'permissions' | 'create' | 'move' | 'delete' | 'transfer', missing: bigint[] = []): Promise<void> {
    const permission = step === 'permissions' || isPermissionError(err);
    log.warn({ err, guild: guild.id, step }, 'Salon vocal temporaire : erreur');
    // Membre déconnecté entre-temps (40032) : rien à signaler.
    if (err instanceof DiscordAPIError && err.code === 40032) return;
    const key = `${guild.id}:${permission ? 'permissions' : step}`;
    const last = this.lastErrorLog.get(key);
    if (last !== undefined && Date.now() - last < ERROR_LOG_THROTTLE_MS) return;
    this.lastErrorLog.set(key, Date.now());
    try {
      const t = await this.translator(guild.id);
      const names = missing.length ? new PermissionsBitField(missing.reduce((a, b) => a | b, 0n)).toArray().join(', ') : '';
      await loggingService.log({
        guildId: guild.id,
        category: 'VOICE',
        action: 'vocal.error',
        title: t('vocal.log.error_title'),
        description: permission ? t('vocal.log.missing_permissions', { permissions: names || 'ManageChannels, MoveMembers' }) : t('vocal.log.error', { step, details: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) }),
        color: BRAND.colors.danger,
      });
    } catch (logErr) {
      log.error({ err: logErr }, 'Log d’erreur du salon temporaire impossible');
    }
  }
}

/** Retire les doublons de rôle (la première règle d'un rôle l'emporte). */
export function dedupeRules(rules: readonly VoiceRule[]): VoiceRule[] {
  const seen = new Set<string>();
  return rules.filter((r) => (seen.has(r.roleId) ? false : (seen.add(r.roleId), true)));
}

export const tempVoiceService = new TempVoiceService();
