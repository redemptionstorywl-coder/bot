import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
import type { RedemptionClient } from '../../src/core/Client';
import { guildIconUrl } from './format';

export interface ChannelOption {
  id: string;
  name: string;
  type: 'text' | 'announcement' | 'voice' | 'stage' | 'forum' | 'category';
  parentId: string | null;
  parentName: string | null;
  position: number;
}

export interface RoleOption {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
}

/** Vue "sérialisable" d'un serveur Discord pour alimenter les formulaires (selects salons / rôles). */
export interface GuildView {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
  channelCount: number;
  roleCount: number;
  /** Salons texte + annonces (triés par catégorie puis position) */
  textChannels: ChannelOption[];
  voiceChannels: ChannelOption[];
  categories: ChannelOption[];
  forums: ChannelOption[];
  /** Tous les salons (hors catégories) */
  channels: ChannelOption[];
  /** Rôles triés du plus haut au plus bas, sans @everyone */
  roles: RoleOption[];
  createdAt: Date;
}

function channelKind(type: ChannelType): ChannelOption['type'] | null {
  switch (type) {
    case ChannelType.GuildText:
      return 'text';
    case ChannelType.GuildAnnouncement:
      return 'announcement';
    case ChannelType.GuildVoice:
      return 'voice';
    case ChannelType.GuildStageVoice:
      return 'stage';
    case ChannelType.GuildForum:
    case ChannelType.GuildMedia:
      return 'forum';
    case ChannelType.GuildCategory:
      return 'category';
    default:
      return null;
  }
}

function toOption(channel: GuildBasedChannel): ChannelOption | null {
  const type = channelKind(channel.type);
  if (!type) return null;
  const parent = 'parent' in channel ? channel.parent : null;
  return {
    id: channel.id,
    name: channel.name,
    type,
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? null,
    position: 'rawPosition' in channel && typeof channel.rawPosition === 'number' ? channel.rawPosition : 0,
  };
}

/** Tri : catégorie (position) puis position du salon ; salons sans catégorie en premier. */
export function sortChannels(channels: ChannelOption[], categories: ChannelOption[]): ChannelOption[] {
  const catPos = new Map(categories.map((c) => [c.id, c.position]));
  return [...channels].sort((a, b) => {
    const pa = a.parentId ? (catPos.get(a.parentId) ?? 9999) : -1;
    const pb = b.parentId ? (catPos.get(b.parentId) ?? 9999) : -1;
    if (pa !== pb) return pa - pb;
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name);
  });
}

export function describeGuild(guild: Guild): GuildView {
  const all: ChannelOption[] = [];
  for (const channel of guild.channels.cache.values()) {
    const opt = toOption(channel);
    if (opt) all.push(opt);
  }
  const categories = all.filter((c) => c.type === 'category').sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const nonCategory = sortChannels(
    all.filter((c) => c.type !== 'category'),
    categories,
  );
  const roles: RoleOption[] = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#a1a1aa' : r.hexColor, position: r.position, managed: r.managed }))
    .sort((a, b) => b.position - a.position);
  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL({ size: 128 }) ?? guildIconUrl(guild.id, guild.icon),
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    channelCount: nonCategory.length,
    roleCount: roles.length,
    textChannels: nonCategory.filter((c) => c.type === 'text' || c.type === 'announcement'),
    voiceChannels: nonCategory.filter((c) => c.type === 'voice' || c.type === 'stage'),
    categories,
    forums: nonCategory.filter((c) => c.type === 'forum'),
    channels: nonCategory,
    roles,
    createdAt: guild.createdAt,
  };
}

/** Retourne le serveur Discord depuis le cache du client, avec garde si le bot n'est pas prêt. */
export function getBotGuild(client: RedemptionClient, guildId: string): Guild | null {
  if (!client.isReady()) return null;
  return client.guilds.cache.get(guildId) ?? null;
}

/** Ensemble des IDs de serveurs où le bot est présent (vide tant que le bot n'est pas prêt). */
export function botGuildIds(client: RedemptionClient): Set<string> {
  if (!client.isReady()) return new Set();
  return new Set(client.guilds.cache.keys());
}
