import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  type User,
} from 'discord.js';
import type { AnnouncementStatus } from '@prisma/client';
import { embedService, type ButtonSpec, type EmbedSpec } from './EmbedService';
import type { AnnouncementTranslations } from './AnnouncementService';
import { resolveTargetLanguages, translationKind, withDefaultColor } from './AnnouncementService';
import { EMBED_COLOR_PALETTE } from '../config/constants';
import { colorToHex } from './EmbedService';
import type { Translator } from './TranslationService';
import type { ResolvedGuildConfig } from './GuildConfigService';
import { TTLCache } from '../utils/cache';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { BRAND, LANGUAGES, getLanguage } from '../config/constants';

export const BUILDER_SESSION_TTL_MS = 30 * 60_000;
export const MAX_EMBED_FIELDS = 25;
export const MAX_BUTTONS = 25;

export type BuilderMode = 'embed' | 'announce';
/**
 * Vues du builder :
 *  - main        : vue principale (embed → édition complète ; announce → récapitulatif + étapes)
 *  - embed       : (announce uniquement) édition de l'embed
 *  - buttons     : gestion des boutons
 *  - languages / translations / mentions / channel : étapes propres aux annonces
 */
export type BuilderView = 'main' | 'embed' | 'buttons' | 'color' | 'languages' | 'translations' | 'mentions' | 'channel';

export interface AnnouncementDraft {
  id?: number;
  status: AnnouncementStatus;
  title?: string;
  sourceLanguage: string;
  /** '*' = toutes les langues activées sur le serveur */
  targetLanguages: string[] | '*';
  translations: AnnouncementTranslations;
  channelId?: string;
  mentionRoleIds: string[];
  mentionEveryone: boolean;
  scheduledAt?: Date;
}

export interface BuilderNotice {
  type: 'success' | 'error' | 'info' | 'warning';
  text: string;
}

export interface BuilderSession {
  /** Identifiant court (8 caractères) utilisé dans les customId */
  id: string;
  guildId: string;
  userId: string;
  mode: BuilderMode;
  view: BuilderView;
  spec: EmbedSpec;
  /** Texte au-dessus de l'embed */
  content?: string;
  buttons: ButtonSpec[];
  /** /embed edit : message d'origine à mettre à jour */
  target?: { channelId: string; messageId: string };
  /** Données propres au mode annonce */
  announcement?: AnnouncementDraft;
  /** Message d'information affiché une seule fois lors du prochain rendu */
  notice?: BuilderNotice;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionInput {
  guildId: string;
  userId: string;
  mode: BuilderMode;
  spec?: EmbedSpec;
  content?: string;
  buttons?: ButtonSpec[];
  target?: BuilderSession['target'];
  announcement?: AnnouncementDraft;
}

/** Génère un identifiant court (8 caractères, alphabet base64url → sûr dans un customId). */
export function generateSessionId(): string {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

/** Un embed Discord doit contenir au moins un élément visible. */
export function isEmbedEmpty(spec: EmbedSpec): boolean {
  return !spec.title && !spec.description && !spec.image && !spec.thumbnail && !spec.footer?.text && !spec.author?.name && !(spec.fields && spec.fields.length);
}

/**
 * État en mémoire des sessions d'édition interactives (builder d'embeds et d'annonces).
 * Clé : `${guildId}:${userId}:${sessionId}` — seul l'auteur peut agir sur sa session.
 */
export class EmbedBuilderSessionStore {
  private readonly cache = new TTLCache<BuilderSession>(BUILDER_SESSION_TTL_MS, 2000);

  private key(guildId: string, userId: string, sessionId: string): string {
    return `${guildId}:${userId}:${sessionId}`;
  }

  create(input: CreateSessionInput): BuilderSession {
    const now = Date.now();
    const session: BuilderSession = {
      id: generateSessionId(),
      guildId: input.guildId,
      userId: input.userId,
      mode: input.mode,
      view: 'main',
      spec: input.spec ?? {},
      content: input.content,
      buttons: input.buttons ?? [],
      target: input.target,
      announcement: input.announcement,
      createdAt: now,
      updatedAt: now,
    };
    this.cache.set(this.key(session.guildId, session.userId, session.id), session);
    return session;
  }

  get(guildId: string, userId: string, sessionId: string): BuilderSession | undefined {
    return this.cache.get(this.key(guildId, userId, sessionId));
  }

  /** Ré-enregistre la session (prolonge le TTL). */
  save(session: BuilderSession): void {
    session.updatedAt = Date.now();
    this.cache.set(this.key(session.guildId, session.userId, session.id), session);
  }

  delete(session: Pick<BuilderSession, 'guildId' | 'userId' | 'id'>): void {
    this.cache.delete(this.key(session.guildId, session.userId, session.id));
  }

  expiresAt(session: BuilderSession): Date {
    return new Date(session.updatedAt + BUILDER_SESSION_TTL_MS);
  }

  get size(): number {
    return this.cache.size;
  }
}

export const embedBuilderSessions = new EmbedBuilderSessionStore();

// ───────────────────────── Rendu de l'interface ─────────────────────────

export interface BuilderRenderContext {
  t: Translator;
  lang: string;
  config: ResolvedGuildConfig;
  guild: Guild | null;
  member: GuildMember | null;
  user: User;
}

export interface BuilderPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  allowedMentions: { parse: [] };
}

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

function button(ns: string, action: string, sid: string, label: string, style: ButtonStyle = ButtonStyle.Secondary, emoji?: string): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(buildCustomId(ns, action, sid)).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const SEND_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread] as const;

function describeButton(b: ButtonSpec): string {
  if (b.style === 'link') return `[${b.label}](${b.url})`;
  const role = b.customId?.match(/^rolemenu:toggle:(\d+)$/);
  if (role) return `${b.label} → <@&${role[1]}>`;
  return `${b.label} (\`${b.customId}\`)`;
}

function previewEmbed(session: BuilderSession, rc: BuilderRenderContext): EmbedBuilder {
  if (isEmbedEmpty(session.spec)) return embedService.info(rc.t('embeds.builder.empty_preview'));
  try {
    return embedService.build(withDefaultColor(session.spec, rc.config.brandColor), { guild: rc.guild, member: rc.member, user: rc.user, language: rc.lang });
  } catch {
    return embedService.error(rc.t('embeds.builder.invalid_preview'));
  }
}

function noticeLine(session: BuilderSession): string {
  const n = session.notice;
  if (!n) return '';
  session.notice = undefined;
  const icon = n.type === 'success' ? '✅' : n.type === 'error' ? '⛔' : n.type === 'warning' ? '⚠️' : 'ℹ️';
  return `${icon} ${n.text}\n\n`;
}

function embedStatusEmbed(session: BuilderSession, rc: BuilderRenderContext): EmbedBuilder {
  const { t } = rc;
  const lines: string[] = [];
  lines.push(`💬 **${t('embeds.builder.content')}** : ${session.content ? truncate(session.content.replace(/\n/g, ' '), 200) : '—'}`);
  lines.push(`🔘 **${t('embeds.builder.buttons')}** (${session.buttons.length}/${MAX_BUTTONS}) : ${session.buttons.length ? session.buttons.map(describeButton).join(' • ') : '—'}`);
  lines.push(`📋 **${t('embeds.builder.fields')}** : ${session.spec.fields?.length ?? 0}/${MAX_EMBED_FIELDS} • 🕒 ${t('embeds.builder.timestamp')} : ${session.spec.timestamp ? t('core.enabled') : t('core.disabled')}`);
  if (session.target) lines.push(`🔗 **${t('embeds.builder.target')}** : https://discord.com/channels/${session.guildId}/${session.target.channelId}/${session.target.messageId}`);
  lines.push('');
  lines.push(`_${t('embeds.builder.hint')}_`);
  const title = session.target ? t('embeds.builder.title_edit') : t('embeds.builder.title');
  return new EmbedBuilder()
    .setColor(BRAND.colors.anthracite)
    .setTitle(title)
    .setDescription(noticeLine(session) + lines.join('\n'))
    .setFooter({ text: t('embeds.builder.footer', { id: session.id }) })
    .setTimestamp(embedBuilderSessions.expiresAt(session));
}

function languageLabel(code: string): string {
  const def = getLanguage(code);
  return def ? `${def.flag} ${def.nativeLabel}` : code;
}

/** Icône d'état d'une traduction : ✅ manuelle · 🤖 automatique · ⬜ manquante. */
export function translationIcon(kind: ReturnType<typeof translationKind>): string {
  return kind === 'manual' ? '✅' : kind === 'auto' ? '🤖' : '⬜';
}

function announceStatusEmbed(session: BuilderSession, rc: BuilderRenderContext): EmbedBuilder {
  const { t, config } = rc;
  const ann = session.announcement!;
  const targets = resolveTargetLanguages({ targetLanguages: ann.targetLanguages, sourceLanguage: ann.sourceLanguage }, config.enabledLanguages);
  const langLines = targets
    .map((code) => {
      if (code === ann.sourceLanguage) return `🏠 ${languageLabel(code)} — ${t('announcements.builder.source_language')}`;
      return `${translationIcon(translationKind({ translations: ann.translations }, code))} ${languageLabel(code)}`;
    })
    .join('\n');
  const mentions = [ann.mentionEveryone ? '@everyone' : null, ...ann.mentionRoleIds.map((r) => `<@&${r}>`)].filter(Boolean).join(' ') || '—';
  const title = ann.id ? t('announcements.builder.title_edit', { id: ann.id }) : t('announcements.builder.title');
  const embed = new EmbedBuilder()
    .setColor(BRAND.colors.anthracite)
    .setTitle(title)
    .setDescription(
      noticeLine(session) +
        `${t('announcements.builder.mode', { mode: t(`announcements.modes.${config.translationMode}`) })}\n` +
        `💬 **${t('embeds.builder.content')}** : ${session.content ? truncate(session.content.replace(/\n/g, ' '), 150) : '—'}\n` +
        `🔘 **${t('embeds.builder.buttons')}** : ${session.buttons.length ? session.buttons.map(describeButton).join(' • ') : '—'}\n\n_${t('announcements.builder.hint')}_`,
    )
    .addFields(
      { name: t('announcements.builder.status'), value: t(`announcements.status.${ann.status}`), inline: true },
      { name: t('announcements.builder.channel'), value: ann.channelId ? `<#${ann.channelId}>` : `⚠️ ${t('core.none')}`, inline: true },
      { name: t('announcements.builder.mentions'), value: mentions, inline: true },
      { name: t('announcements.builder.languages'), value: langLines || '—', inline: false },
      { name: t('announcements.builder.date'), value: ann.scheduledAt ? `${discordTimestamp(ann.scheduledAt, 'F')} (${discordTimestamp(ann.scheduledAt, 'R')})` : '—', inline: false },
    )
    .setFooter({ text: t('embeds.builder.footer', { id: session.id }) })
    .setTimestamp(embedBuilderSessions.expiresAt(session));
  return embed;
}

function fieldsSelect(session: BuilderSession, t: Translator): StringSelectMenuBuilder {
  const options: StringSelectMenuOptionBuilder[] = [
    new StringSelectMenuOptionBuilder().setLabel(t('embeds.builder.field_add')).setValue('add').setEmoji('➕').setDescription(truncate(t('embeds.builder.field_add_desc'), 100)),
  ];
  const fields = session.spec.fields ?? [];
  if (fields.length) options.push(new StringSelectMenuOptionBuilder().setLabel(t('embeds.builder.field_clear')).setValue('clear').setEmoji('🧹'));
  fields.slice(0, 23).forEach((f, i) => options.push(new StringSelectMenuOptionBuilder().setLabel(truncate(`${t('core.delete')} : ${f.name}`, 100)).setValue(`rm:${i}`).setEmoji('🗑️')));
  return new StringSelectMenuBuilder().setCustomId(buildCustomId('embed', 'fields', session.id)).setPlaceholder(t('embeds.builder.fields_placeholder', { count: fields.length, max: MAX_EMBED_FIELDS })).addOptions(options);
}


/** Vue « Couleur » : palette de couleurs nommées + hex personnalisé + couleur du serveur. */
function colorViewRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t } = rc;
  const sid = session.id;
  const current = (session.spec.color ?? '').toUpperCase();
  const options = EMBED_COLOR_PALETTE.slice(0, 25).map((c) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncate(t(`embeds.palette.${c.key}`), 100))
      .setValue(c.hex)
      .setEmoji(c.emoji)
      .setDescription(c.hex)
      .setDefault(current === c.hex),
  );
  const select = new StringSelectMenuBuilder().setCustomId(buildCustomId('embed', 'palette', sid)).setPlaceholder(t('embeds.builder.palette_placeholder')).addOptions(options);
  const brandHex = colorToHex(rc.config.brandColor);
  return [
    row(select),
    row(
      button('embed', 'color', sid, t('embeds.builder.btn_color_hex'), ButtonStyle.Secondary, '🔢'),
      button('embed', 'colorbrand', sid, t('embeds.builder.btn_color_brand', { hex: brandHex }), current === '' || current === brandHex ? ButtonStyle.Success : ButtonStyle.Secondary, '🏷️'),
      button('embed', 'back', sid, t('core.back'), ButtonStyle.Secondary, '↩️'),
    ),
  ];
}

function embedEditRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t } = rc;
  const sid = session.id;
  const rows: Row[] = [];
  rows.push(
    row(
      button('embed', 'title', sid, t('embeds.builder.btn_title'), ButtonStyle.Primary, '✏️'),
      button('embed', 'colorview', sid, t('embeds.builder.btn_color'), ButtonStyle.Secondary, '🎨'),
      button('embed', 'images', sid, t('embeds.builder.btn_images'), ButtonStyle.Secondary, '🖼️'),
      button('embed', 'footer', sid, t('embeds.builder.btn_footer'), ButtonStyle.Secondary, '📎'),
      button('embed', 'timestamp', sid, t('embeds.builder.btn_timestamp'), session.spec.timestamp ? ButtonStyle.Success : ButtonStyle.Secondary, '🕒'),
    ),
  );
  const second = [
    button('embed', 'buttons', sid, t('embeds.builder.btn_buttons'), ButtonStyle.Secondary, '🔘'),
    button('embed', 'content', sid, t('embeds.builder.btn_content'), ButtonStyle.Secondary, '💬'),
  ];
  if (session.mode === 'embed') second.push(button('embed', 'template', sid, t('embeds.builder.btn_template'), ButtonStyle.Secondary, '💾'));
  second.push(button('embed', 'import', sid, t('embeds.builder.btn_import'), ButtonStyle.Secondary, '📥'), button('embed', 'export', sid, t('embeds.builder.btn_export'), ButtonStyle.Secondary, '📤'));
  if (session.mode === 'announce') second.push(button('embed', 'back', sid, t('core.back'), ButtonStyle.Secondary, '↩️'));
  rows.push(row(...second));
  if (session.mode === 'embed') {
    const third = [];
    if (session.target) third.push(button('embed', 'update', sid, t('embeds.builder.btn_update'), ButtonStyle.Success, '✅'));
    third.push(button('embed', 'cancel', sid, t('core.cancel'), ButtonStyle.Danger, '✖️'));
    rows.push(row(...third));
  }
  rows.push(row(fieldsSelect(session, t)));
  if (session.mode === 'embed' && !session.target) {
    rows.push(
      row(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildCustomId('embed', 'send', sid))
          .setPlaceholder(t('embeds.builder.send_placeholder'))
          .addChannelTypes(...SEND_CHANNEL_TYPES)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  }
  return rows;
}

function buttonsViewRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t } = rc;
  const sid = session.id;
  const options: StringSelectMenuOptionBuilder[] = [new StringSelectMenuOptionBuilder().setLabel(t('embeds.builder.button_add_link')).setValue('link').setEmoji('🔗')];
  if (session.buttons.length) options.push(new StringSelectMenuOptionBuilder().setLabel(t('embeds.builder.button_clear')).setValue('clear').setEmoji('🧹'));
  session.buttons.slice(0, 23).forEach((b, i) => options.push(new StringSelectMenuOptionBuilder().setLabel(truncate(`${t('core.delete')} : ${b.label}`, 100)).setValue(`rm:${i}`).setEmoji('🗑️')));
  return [
    row(new StringSelectMenuBuilder().setCustomId(buildCustomId('embed', 'btnmenu', sid)).setPlaceholder(t('embeds.builder.buttons_placeholder', { count: session.buttons.length, max: MAX_BUTTONS })).addOptions(options)),
    row(new RoleSelectMenuBuilder().setCustomId(buildCustomId('embed', 'btnrole', sid)).setPlaceholder(t('embeds.builder.button_add_role')).setMinValues(1).setMaxValues(5)),
    row(button('embed', 'back', sid, t('core.back'), ButtonStyle.Secondary, '↩️')),
  ];
}

function announceMainRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t } = rc;
  const sid = session.id;
  const ann = session.announcement!;
  const published = ann.status === 'PUBLISHED';
  return [
    row(
      button('announce', 'embed', sid, t('announcements.builder.btn_embed'), ButtonStyle.Primary, '🎨'),
      button('announce', 'languages', sid, t('announcements.builder.btn_languages'), ButtonStyle.Secondary, '🌍'),
      button('announce', 'translations', sid, t('announcements.builder.btn_translations'), ButtonStyle.Secondary, '🗣️'),
      button('announce', 'mentions', sid, t('announcements.builder.btn_mentions'), ButtonStyle.Secondary, '📣'),
      button('announce', 'channel', sid, t('announcements.builder.btn_channel'), ann.channelId ? ButtonStyle.Secondary : ButtonStyle.Danger, '📍'),
    ),
    row(
      button('announce', 'date', sid, t('announcements.builder.btn_date'), ButtonStyle.Secondary, '📅'),
      button('announce', 'publish', sid, published ? t('announcements.builder.btn_update') : t('announcements.builder.btn_publish'), ButtonStyle.Success, published ? '🔄' : '🚀'),
      button('announce', 'schedule', sid, t('announcements.builder.btn_schedule'), ButtonStyle.Secondary, '⏰').setDisabled(published),
      button('announce', 'draft', sid, t('announcements.builder.btn_draft'), ButtonStyle.Secondary, '💾'),
      button('announce', 'cancel', sid, t('core.cancel'), ButtonStyle.Danger, '✖️'),
    ),
  ];
}

function announceLanguagesRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t, config } = rc;
  const ann = session.announcement!;
  const enabled = LANGUAGES.filter((l) => config.enabledLanguages.includes(l.code));
  const selected = new Set(resolveTargetLanguages({ targetLanguages: ann.targetLanguages, sourceLanguage: ann.sourceLanguage }, config.enabledLanguages));
  const options = enabled.map((l) => new StringSelectMenuOptionBuilder().setLabel(l.nativeLabel).setValue(l.code).setEmoji(l.flag).setDefault(selected.has(l.code)));
  return [
    row(new StringSelectMenuBuilder().setCustomId(buildCustomId('announce', 'langs', session.id)).setPlaceholder(t('announcements.builder.languages_placeholder')).setMinValues(1).setMaxValues(options.length).addOptions(options)),
    row(button('announce', 'back', session.id, t('core.back'), ButtonStyle.Secondary, '↩️')),
  ];
}

function announceTranslationsRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t, config } = rc;
  const ann = session.announcement!;
  const targets = resolveTargetLanguages({ targetLanguages: ann.targetLanguages, sourceLanguage: ann.sourceLanguage }, config.enabledLanguages).filter((c) => c !== ann.sourceLanguage);
  const rows: Row[] = [];
  if (targets.length) {
    const options = targets.map((code) => {
      const kind = translationKind({ translations: ann.translations }, code);
      const desc = kind === 'manual' ? t('announcements.builder.translation_done') : kind === 'auto' ? t('announcements.builder.translation_auto') : config.autoTranslate ? t('announcements.builder.translation_missing_auto') : t('announcements.builder.translation_missing');
      return new StringSelectMenuOptionBuilder().setLabel(truncate(`${translationIcon(kind)} ${languageLabel(code)}`, 100)).setValue(code).setDescription(truncate(desc, 100));
    });
    rows.push(row(new StringSelectMenuBuilder().setCustomId(buildCustomId('announce', 'trsel', session.id)).setPlaceholder(t('announcements.builder.translations_placeholder')).addOptions(options)));
  }
  const pending = targets.some((code) => translationKind({ translations: ann.translations }, code) !== 'manual');
  rows.push(
    row(
      button('announce', 'autotr', session.id, t('announcements.builder.btn_auto_translate'), ButtonStyle.Primary, '🤖').setDisabled(!targets.length || !pending),
      button('announce', 'back', session.id, t('core.back'), ButtonStyle.Secondary, '↩️'),
    ),
  );
  return rows;
}

function announceMentionsRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t } = rc;
  const ann = session.announcement!;
  const select = new RoleSelectMenuBuilder().setCustomId(buildCustomId('announce', 'roles', session.id)).setPlaceholder(t('announcements.builder.roles_placeholder')).setMinValues(0).setMaxValues(10);
  if (ann.mentionRoleIds.length) select.setDefaultRoles(ann.mentionRoleIds.slice(0, 10));
  return [
    row(select),
    row(
      button('announce', 'everyone', session.id, t('announcements.builder.btn_everyone'), ann.mentionEveryone ? ButtonStyle.Success : ButtonStyle.Secondary, '📢'),
      button('announce', 'back', session.id, t('core.back'), ButtonStyle.Secondary, '↩️'),
    ),
  ];
}

function announceChannelRows(session: BuilderSession, rc: BuilderRenderContext): Row[] {
  const { t } = rc;
  const ann = session.announcement!;
  const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId('announce', 'chan', session.id)).setPlaceholder(t('announcements.builder.channel_placeholder')).addChannelTypes(...SEND_CHANNEL_TYPES).setMinValues(1).setMaxValues(1);
  if (ann.channelId) select.setDefaultChannels([ann.channelId]);
  return [row(select), row(button('announce', 'back', session.id, t('core.back'), ButtonStyle.Secondary, '↩️'))];
}

/**
 * Construit le message éphémère complet (récapitulatif + aperçu + composants) pour la vue courante.
 * Utilisable tel quel avec `interaction.update()` ou `interaction.reply({ ...payload, flags: Ephemeral })`.
 */
export function renderBuilder(session: BuilderSession, rc: BuilderRenderContext): BuilderPayload {
  const embeds: EmbedBuilder[] = [];
  let components: Row[];
  if (session.mode === 'announce') {
    embeds.push(announceStatusEmbed(session, rc));
    switch (session.view) {
      case 'embed':
        components = embedEditRows(session, rc);
        break;
      case 'buttons':
        components = buttonsViewRows(session, rc);
        break;
      case 'color':
        components = colorViewRows(session, rc);
        break;
      case 'languages':
        components = announceLanguagesRows(session, rc);
        break;
      case 'translations':
        components = announceTranslationsRows(session, rc);
        break;
      case 'mentions':
        components = announceMentionsRows(session, rc);
        break;
      case 'channel':
        components = announceChannelRows(session, rc);
        break;
      default:
        components = announceMainRows(session, rc);
    }
  } else {
    embeds.push(embedStatusEmbed(session, rc));
    components = session.view === 'buttons' ? buttonsViewRows(session, rc) : session.view === 'color' ? colorViewRows(session, rc) : embedEditRows(session, rc);
  }
  embeds.push(previewEmbed(session, rc));
  return { embeds, components, allowedMentions: { parse: [] } };
}

/** Vue à afficher quand on quitte une sous-vue. */
export function parentView(session: BuilderSession): BuilderView {
  if (session.mode === 'announce') return session.view === 'buttons' || session.view === 'color' ? 'embed' : 'main';
  return 'main';
}

// ───────────────────────── Helpers pour les handlers ─────────────────────────

import type { APIInteractionGuildMember } from 'discord.js';
import type { InteractionContext } from '../structures/types';

interface InteractionLike {
  guild: Guild | null;
  member: GuildMember | APIInteractionGuildMember | null;
  user: User;
}

/** Construit le contexte de rendu depuis n'importe quelle interaction en serveur. */
export function renderContextFromInteraction(interaction: InteractionLike, ctx: InteractionContext): BuilderRenderContext {
  return {
    t: ctx.t,
    lang: ctx.lang,
    config: ctx.config!,
    guild: interaction.guild,
    member: interaction.member && 'roles' in interaction.member && typeof (interaction.member as GuildMember).displayName === 'string' ? (interaction.member as GuildMember) : null,
    user: interaction.user,
  };
}

/** Lit la valeur d'un champ texte (chaîne vide → undefined). */
export function optionalText(value: string | undefined | null): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}
