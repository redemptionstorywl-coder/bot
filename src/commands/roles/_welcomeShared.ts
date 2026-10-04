import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  GuildMember,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { LeaveConfig, WelcomeConfig } from '@prisma/client';
import { buildCustomId } from '../../utils/customId';
import { TEMPLATE_VARIABLES } from '../../config/constants';
import { env } from '../../config/env';
import { hasInternalPermission } from '../../utils/permissions';
import type { InteractionContext } from '../../structures/types';
import { resolveLocalized, welcomeService, type Localized } from '../../services/WelcomeService';
import { embedService, embedSpecSchema, type ButtonSpec, type EmbedSpec } from '../../services/EmbedService';
import type { Translator } from '../../services/TranslationService';
import { guildConfigService } from '../../services/GuildConfigService';

/**
 * Panneau interactif `/config bienvenue` (éphémère, sans session) :
 *  - boutons   : `welcome:cfg:<action>:<tab>`           (src/buttons/welcome.ts)
 *  - select    : `welcome:cfg:channel:<tab>`            (src/selectMenus/welcome.ts)
 *  - modals    : `welcome:cfg:<kind>:<tab>`             (src/modals/welcome.ts)
 * Le panneau est entièrement re-rendu depuis la base après chaque action (pas d'état en mémoire).
 * Les handlers ne sont pas liés au module : le panneau reste utilisable module désactivé, et le bouton
 * d'activation active aussi le module (`welcome` / `leave`) — un seul interrupteur pour l'utilisateur.
 */

/**
 * Vérifie que l'interaction vient d'un serveur et d'un admin interne (comme `/config`, qui ouvre ce panneau ;
 * les handlers `welcome` déclarent aussi `permissions: { internal: 'admin' }`).
 * Le module n'est pas exigé : le panneau sert aussi à le réactiver.
 * Renvoie `null` si OK, sinon la clé/variables du message d'erreur à afficher (éphémère).
 */
export function checkPanelAccess(interaction: { inGuild(): boolean; member: unknown }, ctx: InteractionContext): { key: string; vars?: Record<string, string> } | null {
  const { config } = ctx;
  if (!interaction.inGuild() || !config) return { key: 'core.guild_only' };
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  if (!hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: 'admin' })) {
    return { key: 'core.insufficient_level', vars: { level: 'admin' } };
  }
  return null;
}

/** État du module lié à l'onglet (`welcome` / `leave`) ; vrai si la config du serveur est introuvable. */
export async function isTabModuleEnabled(guildId: string, tab: WelcomeTab): Promise<boolean> {
  const cfg = await guildConfigService.get(guildId);
  return cfg ? cfg.modules[tab] : true;
}

/** Active le module de l'onglet s'il est désactivé (appelé quand l'admin active le message / choisit un salon). */
export async function ensureTabModule(guildId: string, tab: WelcomeTab): Promise<void> {
  if (!(await isTabModuleEnabled(guildId, tab))) await guildConfigService.setModule(guildId, tab, true);
}

export type WelcomeTab = 'welcome' | 'leave';
export const WELCOME_TABS: readonly WelcomeTab[] = ['welcome', 'leave'];
export function isWelcomeTab(v: string | undefined): v is WelcomeTab {
  return v === 'welcome' || v === 'leave';
}

export type PanelModalKind = 'message' | 'embed' | 'image' | 'dm' | 'buttons';

export interface PanelNotice {
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export interface PanelRenderOptions {
  guild: Guild;
  tab: WelcomeTab;
  t: Translator;
  /** Langue du serveur */
  lang: string;
  notice?: PanelNotice;
}

export interface PanelPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

const NOTICE_ICON: Record<PanelNotice['type'], string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
/** Nombre max de boutons liens configurables via le modal (une rangée). */
export const MAX_PANEL_BUTTONS = 5;

export function onOff(v: boolean, t: Translator): string {
  return v ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`;
}

function shortOnOff(v: boolean, t: Translator): string {
  return v ? t('welcome.panel.on') : t('welcome.panel.off');
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Valeur à pré-remplir dans un modal. Les anciennes configurations multilingues `{ [lang]: … }`
 * sont lues dans la langue du serveur (sinon la première valeur).
 */
export function resolveForEdit<T>(current: Localized<T> | null | undefined, lang: string): T | undefined {
  return resolveLocalized<T>(current, lang);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function btn(customId: string, label: string, style: ButtonStyle, emoji?: string): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function row(...components: MessageActionRowComponentBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/** Construit l'embed de statut + les composants du panneau pour l'onglet demandé (lit la config en base). */
export async function renderPanel(opts: PanelRenderOptions): Promise<PanelPayload> {
  const { guild, tab, t, lang, notice } = opts;
  const id = (action: string) => buildCustomId('welcome', 'cfg', action, tab);
  const config = tab === 'welcome' ? await welcomeService.getConfig(guild.id) : await welcomeService.getLeaveConfig(guild.id);

  const embed = embedService.brand(t(`welcome.panel.title_${tab}`, { server: guild.name }));
  const lines: string[] = [];
  if (notice) lines.push(`${NOTICE_ICON[notice.type]} ${notice.text}`, '');
  lines.push(t('welcome.panel.hint'));
  embed.setDescription(lines.join('\n'));

  // Activé = message activé ET module du serveur actif (un seul interrupteur côté panneau).
  const enabled = (config?.enabled ?? false) && (await isTabModuleEnabled(guild.id, tab));
  const channel = config?.channelId ? `<#${config.channelId}>` : t('welcome.panel.no_channel');
  const imageEnabled = config?.imageEnabled ?? false;
  const imageValue = `${onOff(imageEnabled, t)}${config?.imageBackgroundUrl ? `\n[${t('welcome.config.background')}](${config.imageBackgroundUrl})` : ''}`;
  const message = resolveLocalized<string>((config?.message ?? null) as Localized<string> | null, lang);
  const embedSpec = safeSpec(resolveLocalized<unknown>((config?.embed ?? null) as Localized<unknown> | null, lang));

  embed.addFields({ name: t('welcome.config.field_enabled'), value: onOff(enabled, t), inline: true }, { name: t('core.channel'), value: channel, inline: true }, { name: t('welcome.config.field_image'), value: imageValue, inline: true });

  if (tab === 'welcome') {
    const c = config as WelcomeConfig | null;
    const buttons = Array.isArray(c?.buttons) ? c!.buttons.length : 0;
    embed.addFields(
      { name: t('welcome.config.field_dm'), value: onOff(c?.dmEnabled ?? false, t), inline: true },
      { name: t('welcome.config.field_buttons'), value: String(buttons), inline: true },
    );
  } else {
    const c = config as LeaveConfig | null;
    embed.addFields({ name: t('welcome.leave.config.field_logs'), value: onOff(c?.logEnabled ?? true, t), inline: true });
  }

  const messageValue = message ? `>>> ${truncate(message, 300)}` : t('welcome.panel.message_default');
  embed.addFields({ name: t('welcome.config.kind_message'), value: messageValue, inline: false });
  const embedValue = embedSpec ? `**${truncate(embedSpec.title ?? embedSpec.description ?? '—', 100)}**` : t('welcome.panel.embed_none');
  embed.addFields({ name: t('welcome.config.kind_embed'), value: embedValue, inline: false });

  // Rangée 1 : onglets + activation + test
  const tabs = WELCOME_TABS.map((k) => btn(buildCustomId('welcome', 'cfg', 'tab', k), t(`welcome.panel.tab_${k}`), k === tab ? ButtonStyle.Primary : ButtonStyle.Secondary, k === 'welcome' ? '👋' : '🚪'));
  const row1 = row(...tabs, btn(id('toggle'), enabled ? t('core.enabled') : t('core.disabled'), enabled ? ButtonStyle.Success : ButtonStyle.Danger, enabled ? '🟢' : '🔴'), btn(id('test'), t('welcome.panel.btn_test'), ButtonStyle.Secondary, '👁️'));

  // Rangée 2 : salon
  const select = new ChannelSelectMenuBuilder().setCustomId(id('channel')).setPlaceholder(t('welcome.panel.channel_placeholder').slice(0, 150)).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (config?.channelId) select.setDefaultChannels(config.channelId);
  const row2 = row(select);

  // Rangée 3 : contenu
  const row3 = row(
    btn(id('message'), t('welcome.panel.btn_message'), ButtonStyle.Secondary, '✏️'),
    btn(id('embed'), t('welcome.panel.btn_embed'), ButtonStyle.Secondary, '🎨'),
    btn(id('image'), t('welcome.panel.btn_image'), ButtonStyle.Secondary, '🖼️'),
    btn(id('imgtoggle'), t('welcome.panel.btn_image_toggle', { state: shortOnOff(imageEnabled, t) }), imageEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const components = [row1, row2, row3];
  if (tab === 'welcome') {
    const c = config as WelcomeConfig | null;
    components.push(
      row(
        btn(id('dm'), t('welcome.panel.btn_dm_toggle', { state: shortOnOff(c?.dmEnabled ?? false, t) }), c?.dmEnabled ? ButtonStyle.Success : ButtonStyle.Secondary, '💬'),
        btn(id('dmmsg'), t('welcome.panel.btn_dm_message'), ButtonStyle.Secondary, '✉️'),
        btn(id('buttons'), t('welcome.panel.btn_buttons'), ButtonStyle.Secondary, '🔘'),
        btn(id('vars'), t('welcome.panel.btn_variables'), ButtonStyle.Secondary, '📖'),
      ),
    );
  } else {
    const c = config as LeaveConfig | null;
    const logEnabled = c?.logEnabled ?? true;
    row3.addComponents(btn(id('logs'), t('welcome.panel.btn_logs', { state: shortOnOff(logEnabled, t) }), logEnabled ? ButtonStyle.Success : ButtonStyle.Secondary, '📋'));
    components.push(row(btn(id('vars'), t('welcome.panel.btn_variables'), ButtonStyle.Secondary, '📖')));
  }

  return { embeds: [embed], components };
}

function safeSpec(value: unknown): EmbedSpec | undefined {
  const r = embedSpecSchema.safeParse(value);
  return r.success ? r.data : undefined;
}

/** Liste des variables de template (réponse éphémère « 📖 Variables »). */
export function variablesEmbed(t: Translator): EmbedBuilder {
  return embedService.info(Object.entries(TEMPLATE_VARIABLES).map(([k, v]) => `\`${k}\` — ${v}`).join('\n')).setTitle(t('welcome.config.variables'));
}

// ───── Modals ─────

function input(id: string, style: TextInputStyle, opts: { value?: string | null; placeholder?: string; required?: boolean; max?: number } = {}): TextInputBuilder {
  const i = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(opts.required ?? false);
  if (opts.max) i.setMaxLength(opts.max);
  if (opts.placeholder) i.setPlaceholder(opts.placeholder.slice(0, 100));
  if (opts.value) i.setValue(opts.value.slice(0, opts.max ?? 4000));
  return i;
}

function labelled(label: string, i: TextInputBuilder, description?: string): LabelBuilder {
  const l = new LabelBuilder().setLabel(label.slice(0, 45)).setTextInputComponent(i);
  if (description) l.setDescription(description.slice(0, 100));
  return l;
}

function modal(kind: PanelModalKind, tab: WelcomeTab, title: string): ModalBuilder {
  return new ModalBuilder().setCustomId(buildCustomId('welcome', 'cfg', kind, tab)).setTitle(title.slice(0, 45));
}

/** Modal « ✏️ Message » : texte (pré-rempli). */
export function buildMessageModal(tab: WelcomeTab, current: Localized<string> | null | undefined, t: Translator, lang: string): ModalBuilder {
  const value = resolveForEdit<string>(current, lang);
  return modal('message', tab, t('welcome.config.modal_title_message', { target: t(`welcome.config.target_${tab}`) })).addLabelComponents(
    labelled(t('welcome.config.modal_label_message'), input('value', TextInputStyle.Paragraph, { value: typeof value === 'string' ? value : undefined, max: 2000 }), t('welcome.config.modal_help_message')),
  );
}

/** Modal « 🎨 Embed » : titre, description, couleur, image, vignette (5 champs max). */
export function buildEmbedModal(tab: WelcomeTab, current: Localized<unknown> | null | undefined, t: Translator, lang: string): ModalBuilder {
  const spec = safeSpec(resolveForEdit<unknown>(current, lang)) ?? {};
  return modal('embed', tab, t('welcome.config.modal_title_embed', { target: t(`welcome.config.target_${tab}`) })).addLabelComponents(
    labelled(t('welcome.config.modal_label_embed_title'), input('title', TextInputStyle.Short, { value: spec.title, max: 256 }), t('welcome.config.modal_help_embed')),
    labelled(t('welcome.config.modal_label_embed_description'), input('description', TextInputStyle.Paragraph, { value: spec.description, max: 4000 })),
    labelled(t('welcome.config.modal_label_embed_color'), input('color', TextInputStyle.Short, { value: spec.color, placeholder: '#7C3AED', max: 7 })),
    labelled(t('welcome.config.modal_label_embed_image'), input('image', TextInputStyle.Short, { value: spec.image, placeholder: 'https://…', max: 2048 })),
    labelled(t('welcome.config.modal_label_embed_thumbnail'), input('thumbnail', TextInputStyle.Short, { value: spec.thumbnail, placeholder: 'https://…', max: 2048 })),
  );
}

/** Modal « 🖼️ Image » : fond (URL) + titre / sous-titre (bienvenue uniquement). */
export function buildImageModal(tab: WelcomeTab, current: WelcomeConfig | LeaveConfig | null, t: Translator): ModalBuilder {
  const m = modal('image', tab, t('welcome.config.modal_title_image', { target: t(`welcome.config.target_${tab}`) })).addLabelComponents(
    labelled(t('welcome.config.modal_label_image_background'), input('background', TextInputStyle.Short, { value: current?.imageBackgroundUrl, placeholder: 'https://…', max: 2048 }), t('welcome.config.modal_help_image_background')),
  );
  if (tab === 'welcome') {
    const c = current as WelcomeConfig | null;
    m.addLabelComponents(
      labelled(t('welcome.config.modal_label_image_title'), input('title', TextInputStyle.Short, { value: c?.imageTitle, placeholder: 'BIENVENUE', max: 60 })),
      labelled(t('welcome.config.modal_label_image_subtitle'), input('subtitle', TextInputStyle.Short, { value: c?.imageSubtitle, placeholder: '{username} · #{memberCount}', max: 120 })),
    );
  }
  return m;
}

/** Modal « ✉️ Message DM » : texte + embed simple (titre, description, couleur). */
export function buildDmModal(current: WelcomeConfig | null, t: Translator, lang: string): ModalBuilder {
  const message = resolveForEdit<string>(current?.dmMessage as Localized<string> | null, lang);
  const spec = safeSpec(resolveForEdit<unknown>(current?.dmEmbed as Localized<unknown> | null, lang)) ?? {};
  return modal('dm', 'welcome', t('welcome.config.modal_title_dm')).addLabelComponents(
    labelled(t('welcome.config.modal_label_message'), input('value', TextInputStyle.Paragraph, { value: typeof message === 'string' ? message : undefined, max: 2000 }), t('welcome.config.modal_help_message')),
    labelled(t('welcome.config.modal_label_embed_title'), input('title', TextInputStyle.Short, { value: spec.title, max: 256 }), t('welcome.config.modal_help_embed')),
    labelled(t('welcome.config.modal_label_embed_description'), input('description', TextInputStyle.Paragraph, { value: spec.description, max: 4000 })),
    labelled(t('welcome.config.modal_label_embed_color'), input('color', TextInputStyle.Short, { value: spec.color, placeholder: '#7C3AED', max: 7 })),
  );
}

/** Modal « 🔘 Boutons » : un bouton lien par ligne `Libellé | https://url | emoji`. */
export function buildButtonsModal(current: unknown, t: Translator): ModalBuilder {
  const lines = Array.isArray(current) ? (current as ButtonSpec[]).filter((b) => b && b.style === 'link' && b.url).map((b) => [b.label, b.url, b.emoji].filter(Boolean).join(' | ')) : [];
  return modal('buttons', 'welcome', t('welcome.config.modal_title_buttons')).addLabelComponents(
    labelled(t('welcome.config.modal_label_buttons', { max: MAX_PANEL_BUTTONS }), input('value', TextInputStyle.Paragraph, { value: lines.join('\n'), placeholder: 'Site | https://example.com | 🌐', max: 1000 }), t('welcome.config.modal_help_buttons')),
  );
}

/** Parse les lignes `Libellé | url | emoji` en ButtonSpec[] (liens). Renvoie une erreur lisible sinon. */
export function parseButtonLines(raw: string): { ok: true; buttons: ButtonSpec[] } | { ok: false; error: string } {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > MAX_PANEL_BUTTONS) return { ok: false, error: `max ${MAX_PANEL_BUTTONS}` };
  const buttons: ButtonSpec[] = [];
  for (const line of lines) {
    const [label = '', url = '', emoji] = line.split('|').map((p) => p.trim());
    if (!label || !isHttpUrl(url)) return { ok: false, error: line.slice(0, 80) };
    buttons.push({ label: label.slice(0, 80), style: 'link', url, ...(emoji ? { emoji: emoji.slice(0, 64) } : {}) });
  }
  return { ok: true, buttons };
}
