import { z } from 'zod';

/**
 * Synchronisation jeu ⇄ Discord : fonctions pures (testées dans tests/fivem/sync.test.ts).
 * Aucune dépendance Discord / Prisma ici : le service FiveMSyncService orchestre.
 */

const DISCORD_ID = /^\d{15,22}$/;

// ───────────── Identifiants FiveM ─────────────

export interface ParsedIdentifiers {
  license?: string;
  license2?: string;
  discordId?: string;
  steam?: string;
  fivemId?: string;
  xbl?: string;
  live?: string;
}

/**
 * Découpe la liste renvoyée par `GetPlayerIdentifiers` (`license:…`, `discord:123…`, `steam:…`, `fivem:…`).
 * Les identifiants `ip:` sont volontairement ignorés (jamais stockés).
 */
export function parseIdentifiers(identifiers: readonly string[] | null | undefined): ParsedIdentifiers {
  const out: ParsedIdentifiers = {};
  for (const raw of identifiers ?? []) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    const sep = id.indexOf(':');
    if (sep <= 0) continue;
    const prefix = id.slice(0, sep).toLowerCase();
    const value = id.slice(sep + 1);
    if (!value) continue;
    switch (prefix) {
      case 'license':
        out.license ??= `license:${value}`;
        break;
      case 'license2':
        out.license2 ??= `license2:${value}`;
        break;
      case 'discord':
        if (DISCORD_ID.test(value)) out.discordId ??= value;
        break;
      case 'steam':
        out.steam ??= `steam:${value}`;
        break;
      case 'fivem':
        out.fivemId ??= `fivem:${value}`;
        break;
      case 'xbl':
        out.xbl ??= `xbl:${value}`;
        break;
      case 'live':
        out.live ??= `live:${value}`;
        break;
    }
  }
  return out;
}

/** Clé de suivi d'un joueur : `license:` sinon `license2:`. */
export function trackingLicense(parsed: ParsedIdentifiers): string | undefined {
  return parsed.license ?? parsed.license2;
}

/**
 * Résout l'ID Discord d'un joueur, par ordre de confiance :
 *  1. `discordId` explicite du payload (validé)
 *  2. identifiant `discord:` (fourni par FiveM après connexion Discord du client : preuve forte)
 *  3. liaison connue en base pour sa licence (FiveMPlayer / BattleRoyaleProfile / Whitelist)
 */
export function resolveDiscordId(input: { discordId?: string | null; identifiers?: readonly string[] | null; knownByLicense?: string | null }): string | null {
  if (input.discordId && DISCORD_ID.test(input.discordId)) return input.discordId;
  const fromIds = parseIdentifiers(input.identifiers).discordId;
  if (fromIds) return fromIds;
  if (input.knownByLicense && DISCORD_ID.test(input.knownByLicense)) return input.knownByLicense;
  return null;
}

// ───────────── Pseudo en jeu → surnom Discord ─────────────

export const NICKNAME_MAX = 32;

/** Motifs refusés dans un pseudo (pubs, mentions de masse). */
const ABUSIVE_PATTERNS: RegExp[] = [/discord(?:\.gg|app\.com\/invite|\.com\/invite)/i, /https?:\/\//i, /@(?:everyone|here)/i, /<[@#][!&]?\d+>/];

/**
 * Nettoie un pseudo FiveM : codes couleur `^0-^9`, balises GTA `~r~`, caractères de contrôle et
 * invisibles, espaces multiples. Retourne null si vide ou abusif.
 */
export function sanitizePlayerName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  let s = name
    .replace(/\^\d/g, '')
    .replace(/~[a-zA-Z_]{1,2}~/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Les backticks / astérisques ne cassent pas un surnom mais polluent les embeds : on les retire.
  s = s.replace(/[`*_|]/g, '').trim();
  if (!s || !/[\p{L}\p{N}]/u.test(s)) return null;
  if (ABUSIVE_PATTERNS.some((re) => re.test(s))) return null;
  return s;
}

/** Tronque à `max` points de code (pas d'emoji coupé en deux). */
export function truncateCodePoints(s: string, max = NICKNAME_MAX): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('').trimEnd();
}

/**
 * Rend le format de surnom (`{name}`, `{id}`, `{level}`) puis tronque à 32 caractères.
 * Si le rendu dépasse, c'est `{name}` qui est raccourci en priorité pour préserver le reste du format.
 * Retourne null si le pseudo est vide/abusif.
 */
export function formatNickname(format: string | null | undefined, vars: { name: string | null | undefined; id?: number | string | null; level?: number | null }): string | null {
  const name = sanitizePlayerName(vars.name);
  if (!name) return null;
  const fmt = (format && format.trim()) || '{name}';
  const render = (n: string) =>
    fmt
      .replace(/\{name\}/g, n)
      .replace(/\{id\}/g, vars.id !== undefined && vars.id !== null ? String(vars.id) : '')
      .replace(/\{level\}/g, vars.level !== undefined && vars.level !== null ? String(vars.level) : '')
      .replace(/\s+/g, ' ')
      .trim();
  let out = render(name);
  if (Array.from(out).length > NICKNAME_MAX && fmt.includes('{name}')) {
    const overflow = Array.from(out).length - NICKNAME_MAX;
    const shortened = truncateCodePoints(name, Math.max(1, Array.from(name).length - overflow));
    out = render(shortened);
  }
  out = truncateCodePoints(out, NICKNAME_MAX);
  return out || null;
}

/** Le bot peut-il renommer ce membre ? (propriétaire jamais, hiérarchie stricte, permission Gérer les pseudos) */
export function canSetNickname(input: { isOwner: boolean; botHasPermission: boolean; botHighestPosition: number; memberHighestPosition: number }): boolean {
  if (input.isOwner || !input.botHasPermission) return false;
  return input.botHighestPosition > input.memberHighestPosition;
}

// ───────────── Anti-écho (évite les boucles jeu → Discord → jeu) ─────────────

export type EchoKind = 'ban' | 'unban' | 'kick';

export function echoKey(origin: 'fromGame' | 'fromDiscord', kind: EchoKind, guildId: string, userId: string): string {
  return `${origin}:${kind}:${guildId}:${userId}`;
}

/**
 * Marqueur d'opération de masse côté Discord (/unban-all) : `skip` = ne pas relayer l'action vers le jeu,
 * `quiet` = la relayer sans log Discord par membre (l'opération produit son propre rapport).
 */
export function bulkKey(mode: 'skip' | 'quiet', kind: EchoKind, guildId: string, userId: string): string {
  return `bulk:${mode}:${kind}:${guildId}:${userId}`;
}

/** Ensemble de marqueurs à durée de vie courte (30 s par défaut). `now` injectable pour les tests. */
export class EchoGuard {
  private readonly marks = new Map<string, number>();
  constructor(private readonly ttlMs = 30_000) {}

  mark(key: string, now = Date.now()): void {
    this.marks.set(key, now + this.ttlMs);
    if (this.marks.size > 5000) for (const [k, exp] of this.marks) if (exp <= now) this.marks.delete(k);
  }

  /** Vrai si l'action est un écho (le marqueur reste valable jusqu'à expiration : plusieurs écouteurs peuvent le lire). */
  has(key: string, now = Date.now()): boolean {
    const exp = this.marks.get(key);
    if (exp === undefined) return false;
    if (exp <= now) {
      this.marks.delete(key);
      return false;
    }
    return true;
  }

  clear(key: string): void {
    this.marks.delete(key);
  }
}

// ───────────── Décision de connexion (/check) ─────────────

export type DenyReason = 'banned' | 'discord_required' | 'not_member' | 'missing_role' | 'not_whitelisted';

export interface ConnectionFacts {
  discordId: string | null;
  /** Membre présent sur le serveur Discord (null = inconnu, ex : pas de discordId) */
  isMember: boolean | null;
  ban: { active: boolean; reason?: string | null; expiresAt?: Date | null } | null;
  requireDiscord: boolean;
  requireRoleId: string | null;
  hasRequiredRole: boolean;
  requireWhitelist: boolean;
  whitelisted: boolean;
}

export interface ConnectionDecision {
  allowed: boolean;
  reason?: DenyReason;
  banned: boolean;
  banReason?: string | null;
  banExpiresAt?: string | null;
  whitelisted: boolean;
  linked: boolean;
  discordId: string | null;
}

/**
 * Combine ban Discord actif, Discord requis, rôle requis et whitelist. Ordre des refus :
 * ban → Discord requis (non lié / pas membre) → rôle requis → whitelist.
 * Un rôle requis implique un Discord lié et membre.
 */
export function decideConnection(f: ConnectionFacts): ConnectionDecision {
  const linked = !!f.discordId;
  const base = { banned: !!f.ban?.active, whitelisted: f.whitelisted, linked, discordId: f.discordId };
  if (f.ban?.active) return { ...base, allowed: false, reason: 'banned', banReason: f.ban.reason ?? null, banExpiresAt: f.ban.expiresAt ? f.ban.expiresAt.toISOString() : null };
  const needsDiscord = f.requireDiscord || !!f.requireRoleId;
  if (needsDiscord && !linked) return { ...base, allowed: false, reason: 'discord_required' };
  if (needsDiscord && f.isMember !== true) return { ...base, allowed: false, reason: 'not_member' };
  if (f.requireRoleId && !f.hasRequiredRole) return { ...base, allowed: false, reason: 'missing_role' };
  if (f.requireWhitelist && !f.whitelisted) return { ...base, allowed: false, reason: 'not_whitelisted' };
  return { ...base, allowed: true };
}

// ───────────── Salon compteur de joueurs ─────────────

/** Discord limite le renommage d'un salon à 2 fois / 10 min : on espace d'au moins 6 min. */
export const CHANNEL_RENAME_INTERVAL_MS = 6 * 60_000;

export function playerCountChannelName(state: { online: boolean; maintenance?: boolean; players: number; maxPlayers: number }, labels: { online: string; offline: string; maintenance: string }): string {
  const raw = state.maintenance ? labels.maintenance : state.online ? labels.online.replace('{players}', String(state.players)).replace('{max}', String(state.maxPlayers || '?')) : labels.offline;
  return truncateCodePoints(raw, 100);
}

/**
 * Throttle des renommages par salon : mémorise le dernier nom appliqué et l'heure,
 * conserve le nom désiré en attente tant que la fenêtre n'est pas écoulée.
 */
export class RenameThrottle {
  private readonly state = new Map<string, { lastName: string | null; lastAt: number; pending: string | null }>();
  constructor(private readonly intervalMs = CHANNEL_RENAME_INTERVAL_MS) {}

  /** Enregistre le nom souhaité et indique s'il faut renommer maintenant. */
  request(channelId: string, desired: string, now = Date.now()): boolean {
    const s = this.state.get(channelId) ?? { lastName: null, lastAt: 0, pending: null };
    this.state.set(channelId, s);
    if (s.lastName === desired) {
      s.pending = null;
      return false;
    }
    if (now - s.lastAt >= this.intervalMs) return true;
    s.pending = desired;
    return false;
  }

  /** À appeler après un renommage réussi. */
  applied(channelId: string, name: string, now = Date.now()): void {
    this.state.set(channelId, { lastName: name, lastAt: now, pending: null });
  }

  /** Noms en attente dont la fenêtre est écoulée (à appliquer par la tâche planifiée). */
  due(now = Date.now()): { channelId: string; name: string }[] {
    const out: { channelId: string; name: string }[] = [];
    for (const [channelId, s] of this.state) if (s.pending && s.pending !== s.lastName && now - s.lastAt >= this.intervalMs) out.push({ channelId, name: s.pending });
    return out;
  }

  /** Connaît le nom actuel sans renommer (ex : nom déjà correct au démarrage). */
  seed(channelId: string, currentName: string): void {
    if (!this.state.has(channelId)) this.state.set(channelId, { lastName: currentName, lastAt: 0, pending: null });
  }

  forget(channelId: string): void {
    this.state.delete(channelId);
  }
}

// ───────────── Temps de jeu ─────────────

/** Durée de session en minutes (arrondi inférieur), bornée à 24 h pour ignorer les sessions fantômes. */
export function sessionMinutes(start: Date | null | undefined, end: Date, maxMinutes = 24 * 60): number {
  if (!start) return 0;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(maxMinutes, Math.floor(ms / 60_000));
}

// ───────────── Réglages de synchronisation ─────────────

const snowflake = z.string().regex(DISCORD_ID, 'ID Discord attendu');

export const syncSettingsSchema = z
  .object({
    syncBansToDiscord: z.boolean(),
    syncBansToGame: z.boolean(),
    syncKicks: z.boolean(),
    syncNicknames: z.boolean(),
    nicknameFormat: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((f) => /\{name\}|\{id\}|\{level\}/.test(f), { message: 'Le format doit contenir {name}, {id} ou {level}' }),
    linkedRoleId: snowflake.nullable(),
    onlineRoleId: snowflake.nullable(),
    playerCountChannelId: snowflake.nullable(),
    requireDiscord: z.boolean(),
    requireRoleId: snowflake.nullable(),
    requireWhitelist: z.boolean(),
  })
  .partial()
  .strict();
export type SyncSettingsPatch = z.infer<typeof syncSettingsSchema>;
export const SYNC_SETTING_KEYS = Object.keys(syncSettingsSchema.shape) as (keyof SyncSettingsPatch)[];

/** Type d'action poussée vers le serveur de jeu. */
export type GameActionType = 'BAN' | 'UNBAN' | 'KICK' | 'MESSAGE';
export interface GameActionPayload {
  discordId?: string | null;
  license?: string | null;
  identifiers?: string[];
  reason?: string | null;
  /** ISO, null = permanent */
  expiresAt?: string | null;
  staff?: string | null;
  message?: string | null;
}
