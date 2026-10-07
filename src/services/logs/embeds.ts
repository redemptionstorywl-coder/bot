import type { APIEmbed } from 'discord.js';
import { BRAND } from '../../config/constants';

/** Embed d'un log (même rendu pour les salons locaux et le hub). Fonctions pures. */
export interface LogEmbedInput {
  category: string;
  action: string;
  title: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  color?: number;
  thumbnail?: string;
  timestamp?: Date;
}

const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function buildLogEmbed(entry: LogEmbedInput): APIEmbed {
  const embed: APIEmbed = {
    color: entry.color ?? BRAND.colors.anthracite,
    title: cut(entry.title || '—', 256),
    timestamp: (entry.timestamp ?? new Date()).toISOString(),
    footer: { text: cut(`${entry.category} • ${entry.action}`, 2048) },
  };
  if (entry.description) embed.description = cut(entry.description, 4096);
  if (entry.fields?.length) embed.fields = entry.fields.slice(0, 25).map((f) => ({ name: cut(f.name || '—', 256), value: cut(f.value, 1024) || '—', ...(f.inline !== undefined ? { inline: f.inline } : {}) }));
  if (entry.thumbnail) embed.thumbnail = { url: entry.thumbnail };
  return embed;
}

export interface HubOrigin {
  /** Nom affiché : « 🎯 RS BATTLE ROYALE » ou « 🎮 RS Battle Royale (jeu) » */
  name: string;
  iconUrl?: string | null;
}

/** Copie pour le hub : serveur d'origine (nom + icône) en auteur, couleurs et champs conservés, action dans le pied de page. */
export function toHubEmbed(embed: APIEmbed, origin: HubOrigin): APIEmbed {
  return {
    ...embed,
    author: { name: cut(origin.name || '—', 256), ...(origin.iconUrl ? { icon_url: origin.iconUrl } : {}) },
  };
}
