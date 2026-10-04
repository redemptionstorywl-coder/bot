import type { Response } from 'express';
import type { APIEmbed, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { discordPreview, type PreviewButton, type PreviewButtonRow, type PreviewContext, type PreviewMessage, type PreviewSelect } from './discordPreview';

/**
 * Convertit les messages construits par les services du bot (EmbedBuilder / ActionRowBuilder de discord.js)
 * au format du moteur d'aperçu (public/js/discord-preview.js). Les aperçus des événements, sondages et giveaways
 * utilisent ainsi les mêmes constructeurs que le bot : ce que montre le panel est ce que Discord affichera.
 */

const BUTTON_STYLES: Record<number, string> = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' };

interface RawEmoji {
  id?: string | null;
  name?: string | null;
  animated?: boolean;
}

function emojiOf(e: RawEmoji | undefined): string | undefined {
  if (!e) return undefined;
  if (e.id) return `<${e.animated ? 'a' : ''}:${e.name ?? 'emoji'}:${e.id}>`;
  return e.name ?? undefined;
}

/** APIEmbed → EmbedSpec d'aperçu (l'horodatage garde sa date). */
export function embedToPreview(embed: APIEmbed): Record<string, unknown> {
  return {
    title: embed.title,
    url: embed.url,
    description: embed.description,
    color: embed.color !== undefined ? `#${embed.color.toString(16).padStart(6, '0').toUpperCase()}` : undefined,
    image: embed.image?.url,
    thumbnail: embed.thumbnail?.url,
    footer: embed.footer ? { text: embed.footer.text, iconUrl: embed.footer.icon_url } : undefined,
    author: embed.author ? { name: embed.author.name, iconUrl: embed.author.icon_url, url: embed.author.url } : undefined,
    timestamp: embed.timestamp ?? undefined,
    fields: embed.fields?.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
  };
}

interface RawComponent {
  type: number;
  style?: number;
  label?: string;
  emoji?: RawEmoji;
  url?: string;
  disabled?: boolean;
  placeholder?: string;
  options?: { label: string; description?: string; emoji?: RawEmoji }[];
}

/** Lignes d'action discord.js → composants d'aperçu (boutons ou menu déroulant). */
export function componentsToPreview(rows: { toJSON(): unknown }[], opts: { openSelect?: boolean } = {}): (PreviewButtonRow | PreviewSelect)[] {
  const out: (PreviewButtonRow | PreviewSelect)[] = [];
  for (const row of rows) {
    const json = row.toJSON() as { components?: RawComponent[] };
    const comps = json.components ?? [];
    const buttons: PreviewButton[] = [];
    for (const c of comps) {
      if (c.type === 2) {
        buttons.push({ label: c.label, style: BUTTON_STYLES[c.style ?? 2] ?? 'secondary', emoji: emojiOf(c.emoji), url: c.url, disabled: Boolean(c.disabled) });
      } else if (c.type === 3) {
        out.push({ type: 'select', placeholder: c.placeholder, disabled: Boolean(c.disabled), open: Boolean(opts.openSelect), options: (c.options ?? []).map((o) => ({ label: o.label, description: o.description ?? null, emoji: emojiOf(o.emoji) ?? null })) });
      }
    }
    if (buttons.length) out.push({ type: 'buttons', buttons });
  }
  return out;
}

/** Message complet (contenu + embeds + composants) construit par un service → message d'aperçu. */
export function serviceMessagePreview(parts: { content?: string | null; embeds?: EmbedBuilder[]; components?: ActionRowBuilder[] | { toJSON(): unknown }[] }, opts: { openSelect?: boolean } = {}): PreviewMessage {
  return {
    content: parts.content ?? '',
    embeds: (parts.embeds ?? []).map((e) => embedToPreview(e.toJSON())),
    components: componentsToPreview((parts.components ?? []) as { toJSON(): unknown }[], opts),
  };
}

/** Rend un aperçu en HTML avec le contexte du serveur courant (+ noms d'utilisateurs connus pour les mentions <@id>). */
export function renderPreviewHtml(res: Response, message: PreviewMessage, users: Record<string, string> = {}): string {
  const base = (res.locals.previewContext as () => PreviewContext)();
  return discordPreview.render(message, { ...base, users: { ...base.users, ...users } });
}
