import type { Guild } from 'discord.js';
import type { RedemptionClient } from '../../src/core/Client';
import { HttpError } from './errors';

const MAX_FETCH = 30;

/**
 * Résout des identifiants Discord en noms affichables (membre du serveur → utilisateur en cache → fetch limité).
 * Les identifiants inconnus sont absents du résultat : la vue affiche alors l'ID brut.
 */
export async function resolveUserNames(client: RedemptionClient, guildId: string, ids: Iterable<string | null | undefined>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!client.isReady()) return out;
  const guild = client.guilds.cache.get(guildId);
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (!id || !/^\d{15,22}$/.test(id)) continue;
    const member = guild?.members.cache.get(id);
    const user = member?.user ?? client.users.cache.get(id);
    if (user) out[id] = member?.displayName ?? user.globalName ?? user.username;
    else missing.push(id);
  }
  for (const id of missing.slice(0, MAX_FETCH)) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) out[id] = user.globalName ?? user.username;
  }
  return out;
}

/** Serveur Discord depuis le cache du bot ; 503 lisible si le bot n'est pas prêt ou absent du serveur. */
export function requireBotGuild(client: RedemptionClient, guildId: string): Guild {
  if (!client.isReady()) throw new HttpError(503, "Le bot n'est pas encore connecté à Discord : réessayez dans quelques instants.");
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(503, "Le bot n'est pas présent sur ce serveur.");
  return guild;
}

export interface UserProfileView {
  name: string;
  avatarUrl: string;
}

/**
 * Résout des identifiants Discord en { nom, avatar } (membre → utilisateur en cache → fetch limité).
 * Les identifiants inconnus sont absents du résultat : la vue affiche alors l'ID brut et un avatar de secours.
 */
export async function resolveUserProfiles(client: RedemptionClient, guildId: string, ids: Iterable<string | null | undefined>): Promise<Record<string, UserProfileView>> {
  const out: Record<string, UserProfileView> = {};
  if (!client.isReady()) return out;
  const guild = client.guilds.cache.get(guildId);
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (!id || !/^\d{15,22}$/.test(id)) continue;
    const member = guild?.members.cache.get(id);
    const user = member?.user ?? client.users.cache.get(id);
    if (user) out[id] = { name: member?.displayName ?? user.globalName ?? user.username, avatarUrl: (member ?? user).displayAvatarURL({ size: 64 }) };
    else missing.push(id);
  }
  for (const id of missing.slice(0, MAX_FETCH)) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) out[id] = { name: user.globalName ?? user.username, avatarUrl: user.displayAvatarURL({ size: 64 }) };
  }
  return out;
}
