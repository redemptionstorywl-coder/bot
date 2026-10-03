import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type APIEmbed, type ColorResolvable } from 'discord.js';
import { z } from 'zod';
import { BRAND } from '../config/constants';
import { renderObject, type TemplateContext } from '../utils/variables';
import { buildCustomId } from '../utils/customId';

const hexColor = z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#7C3AED)');
const url = z.string().url().max(2048);

export const embedFieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(1024),
  inline: z.boolean().optional().default(false),
});

/**
 * EmbedSpec : représentation JSON d'un embed, stockée en base (templates, annonces, bienvenue…).
 * Toutes les chaînes peuvent contenir des variables `{user}`, `{server}`, etc.
 */
export const embedSpecSchema = z.object({
  title: z.string().max(256).optional(),
  url: url.optional(),
  description: z.string().max(4096).optional(),
  color: hexColor.optional(),
  image: url.optional(),
  thumbnail: url.optional(),
  footer: z.object({ text: z.string().max(2048), iconUrl: url.optional() }).optional(),
  author: z.object({ name: z.string().max(256), iconUrl: url.optional(), url: url.optional() }).optional(),
  timestamp: z.boolean().optional(),
  fields: z.array(embedFieldSchema).max(25).optional(),
});
export type EmbedSpec = z.infer<typeof embedSpecSchema>;

export const buttonSpecSchema = z
  .object({
    label: z.string().min(1).max(80),
    style: z.enum(['primary', 'secondary', 'success', 'danger', 'link']).default('secondary'),
    url: url.optional(),
    /** Action interne : `namespace:args` — exécuté par le router de boutons */
    customId: z.string().max(100).optional(),
    emoji: z.string().max(64).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((b) => (b.style === 'link' ? !!b.url : !!b.customId), { message: 'Un bouton lien requiert `url`, les autres requièrent `customId`' });
export type ButtonSpec = z.infer<typeof buttonSpecSchema>;

export const messageSpecSchema = z.object({
  content: z.string().max(2000).optional(),
  embeds: z.array(embedSpecSchema).max(10).optional(),
  buttons: z.array(buttonSpecSchema).max(25).optional(),
});
export type MessageSpec = z.infer<typeof messageSpecSchema>;

const STYLE_MAP: Record<ButtonSpec['style'], ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
};

export function parseColor(color: string | number | undefined, fallback: number = BRAND.colors.primary): number {
  if (color === undefined || color === null || color === '') return fallback;
  if (typeof color === 'number') return color;
  const n = parseInt(color.replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

export function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

export class EmbedService {
  /** Valide un EmbedSpec (lance une ZodError lisible en cas d'erreur). */
  validate(spec: unknown): EmbedSpec {
    return embedSpecSchema.parse(spec);
  }

  safeValidate(spec: unknown): { success: true; data: EmbedSpec } | { success: false; error: string } {
    const r = embedSpecSchema.safeParse(spec);
    if (r.success) return { success: true, data: r.data };
    return { success: false, error: r.error.issues.map((i) => `${i.path.join('.') || 'embed'}: ${i.message}`).join('\n') };
  }

  /** Transforme un EmbedSpec en EmbedBuilder, après remplacement des variables. */
  build(spec: EmbedSpec, ctx: TemplateContext = {}, defaultColor: number = BRAND.colors.primary): EmbedBuilder {
    const s = renderObject(spec, ctx);
    const embed = new EmbedBuilder().setColor(parseColor(s.color, defaultColor) as ColorResolvable);
    if (s.title) embed.setTitle(s.title);
    if (s.url) embed.setURL(s.url);
    if (s.description) embed.setDescription(s.description);
    if (s.image) embed.setImage(s.image);
    if (s.thumbnail) embed.setThumbnail(s.thumbnail);
    if (s.footer?.text) embed.setFooter({ text: s.footer.text, iconURL: s.footer.iconUrl });
    if (s.author?.name) embed.setAuthor({ name: s.author.name, iconURL: s.author.iconUrl, url: s.author.url });
    if (s.timestamp) embed.setTimestamp();
    if (s.fields?.length) embed.addFields(s.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })));
    return embed;
  }

  /** Construit les ActionRows de boutons (max 5 par ligne, 5 lignes). */
  buildButtons(buttons: ButtonSpec[] | undefined, ctx: TemplateContext = {}): ActionRowBuilder<ButtonBuilder>[] {
    if (!buttons?.length) return [];
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const rendered = renderObject(buttons, ctx);
    for (let i = 0; i < rendered.length && rows.length < 5; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const b of rendered.slice(i, i + 5)) {
        const btn = new ButtonBuilder().setLabel(b.label).setStyle(STYLE_MAP[b.style]);
        if (b.emoji) btn.setEmoji(b.emoji);
        if (b.disabled) btn.setDisabled(true);
        if (b.style === 'link' && b.url) btn.setURL(b.url);
        else btn.setCustomId(b.customId ?? buildCustomId('noop', i));
        row.addComponents(btn);
      }
      rows.push(row);
    }
    return rows;
  }

  /** Construit un message complet (content + embeds + boutons) depuis un MessageSpec. */
  buildMessage(spec: MessageSpec, ctx: TemplateContext = {}, defaultColor: number = BRAND.colors.primary) {
    return {
      content: spec.content ? renderObject(spec.content, ctx) : undefined,
      embeds: (spec.embeds ?? []).map((e) => this.build(e, ctx, defaultColor)),
      components: this.buildButtons(spec.buttons, ctx),
    };
  }

  /** Convertit un embed Discord (APIEmbed) en EmbedSpec (pour édition / duplication). */
  fromApiEmbed(embed: APIEmbed): EmbedSpec {
    return {
      title: embed.title ?? undefined,
      url: embed.url ?? undefined,
      description: embed.description ?? undefined,
      color: embed.color !== undefined ? colorToHex(embed.color) : undefined,
      image: embed.image?.url,
      thumbnail: embed.thumbnail?.url,
      footer: embed.footer ? { text: embed.footer.text, iconUrl: embed.footer.icon_url } : undefined,
      author: embed.author ? { name: embed.author.name, iconUrl: embed.author.icon_url, url: embed.author.url } : undefined,
      timestamp: !!embed.timestamp,
      fields: embed.fields?.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
    };
  }

  // ───── Embeds "système" à l'identité Redemption Story ─────

  brand(title?: string, description?: string): EmbedBuilder {
    const e = new EmbedBuilder().setColor(BRAND.colors.primary).setFooter({ text: BRAND.footer });
    if (title) e.setTitle(title);
    if (description) e.setDescription(description);
    return e;
  }

  success(description: string, title?: string): EmbedBuilder {
    return this.brand(title ?? '✅ Succès', description);
  }

  info(description: string, title?: string): EmbedBuilder {
    return new EmbedBuilder().setColor(BRAND.colors.anthracite).setDescription(description).setTitle(title ?? null);
  }

  error(description: string, title?: string): EmbedBuilder {
    return new EmbedBuilder().setColor(BRAND.colors.danger).setTitle(title ?? '⛔ Erreur').setDescription(description);
  }

  warning(description: string, title?: string): EmbedBuilder {
    return new EmbedBuilder().setColor(BRAND.colors.warning).setTitle(title ?? '⚠️ Attention').setDescription(description);
  }
}

export const embedService = new EmbedService();
