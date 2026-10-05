/**
 * Fonctions pures d'autorisation (sans dépendance) — testées dans tests/dashboard/access.test.ts.
 */

/** Permission Discord `ADMINISTRATOR` */
export const PERMISSION_ADMINISTRATOR = 0x8n;
/** Permission Discord `MANAGE_GUILD` */
export const PERMISSION_MANAGE_GUILD = 0x20n;

/** Serveur tel que stocké en session après l'appel à /users/@me/guilds. */
export interface SessionGuild {
  id: string;
  name: string;
  icon: string | null;
  /** Bitfield Discord sérialisé en chaîne décimale (peut dépasser 2^53). */
  permissions: string;
  owner: boolean;
}

/**
 * Convertit un bitfield de permissions Discord (chaîne décimale, nombre ou bigint) en bigint.
 * Toute valeur invalide donne 0n (aucune permission).
 */
export function parsePermissions(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === 'bigint') return value < 0n ? 0n : value;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? BigInt(Math.floor(value)) : 0n;
  if (typeof value !== 'string') return 0n;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return 0n;
  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

export function hasPermission(bits: bigint, flag: bigint): boolean {
  return (bits & flag) === flag;
}

/** Vrai si le bitfield contient Administrator ou ManageGuild. */
export function canManageGuild(permissions: string | number | bigint | null | undefined): boolean {
  const bits = parsePermissions(permissions);
  return hasPermission(bits, PERMISSION_ADMINISTRATOR) || hasPermission(bits, PERMISSION_MANAGE_GUILD);
}

/**
 * Règle d'accès à la gestion d'un serveur :
 *  - le bot doit être présent sur le serveur (`botGuildIds`), ET
 *  - l'utilisateur est propriétaire du bot (`ownerIds`), OU propriétaire du serveur,
 *    OU possède Administrator / ManageGuild sur ce serveur.
 */
export function hasGuildAccess(sessionGuilds: readonly SessionGuild[] | undefined, guildId: string, userId: string, ownerIds: readonly string[], botGuildIds: Iterable<string> | { has(id: string): boolean }): boolean {
  if (!guildId || !userId) return false;
  const botPresent = typeof (botGuildIds as { has?: unknown }).has === 'function' ? (botGuildIds as { has(id: string): boolean }).has(guildId) : [...(botGuildIds as Iterable<string>)].includes(guildId);
  if (!botPresent) return false;
  if (ownerIds.includes(userId)) return true;
  const guild = sessionGuilds?.find((g) => g.id === guildId);
  if (!guild) return false;
  if (guild.owner) return true;
  return canManageGuild(guild.permissions);
}

/** Serveurs de la session où l'utilisateur peut administrer (indépendamment de la présence du bot). */
export function manageableGuilds(sessionGuilds: readonly SessionGuild[] | undefined, userId: string, ownerIds: readonly string[]): SessionGuild[] {
  if (!sessionGuilds) return [];
  if (ownerIds.includes(userId)) return [...sessionGuilds];
  return sessionGuilds.filter((g) => g.owner || canManageGuild(g.permissions));
}

export const DISCORD_ID_REGEX = /^\d{15,22}$/;
export function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && DISCORD_ID_REGEX.test(value);
}

/**
 * Actions sensibles (ex. débannir tout le monde) : propriétaire du bot, propriétaire du serveur
 * ou permission Administrator — ManageGuild seul ne suffit pas.
 */
export function isGuildAdmin(sessionGuilds: readonly SessionGuild[] | undefined, guildId: string, userId: string, ownerIds: readonly string[]): boolean {
  if (!guildId || !userId) return false;
  if (ownerIds.includes(userId)) return true;
  const guild = sessionGuilds?.find((g) => g.id === guildId);
  if (!guild) return false;
  return guild.owner || hasPermission(parsePermissions(guild.permissions), PERMISSION_ADMINISTRATOR);
}
