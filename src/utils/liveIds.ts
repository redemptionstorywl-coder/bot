import type { Guild } from 'discord.js';

/**
 * Filtre les IDs de rôles / salons qui n'existent plus sur le serveur avant de pré-remplir un menu
 * (RoleSelect / ChannelSelect `default_values`). Un rôle ou salon supprimé entre-temps ferait refuser
 * le message entier par Discord et le panneau ne s'ouvrirait plus.
 * Sans serveur (contexte hors guild), les IDs sont rendus tels quels.
 */
export function liveRoles(guild: Guild | null | undefined, ids: readonly (string | null | undefined)[]): string[] {
  const clean = ids.filter((id): id is string => !!id);
  return guild ? clean.filter((id) => guild.roles.cache.has(id)) : clean;
}

export function liveRole(guild: Guild | null | undefined, id: string | null | undefined): string | null {
  return liveRoles(guild, [id])[0] ?? null;
}

export function liveChannels(guild: Guild | null | undefined, ids: readonly (string | null | undefined)[]): string[] {
  const clean = ids.filter((id): id is string => !!id);
  return guild ? clean.filter((id) => guild.channels.cache.has(id)) : clean;
}

export function liveChannel(guild: Guild | null | undefined, id: string | null | undefined): string | null {
  return liveChannels(guild, [id])[0] ?? null;
}
