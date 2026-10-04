import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
} from 'discord.js';
import { PanelStyle, type TicketPanel, type TicketType } from '@prisma/client';
import { buildCustomId } from '../../utils/customId';
import { TTLCache } from '../../utils/cache';
import { embedService } from '../../services/EmbedService';
import { TicketError, asStringArray, parseEmbedSpec, parseQuestions, ticketQuestionSchema, ticketService, type TicketQuestion } from '../../services/TicketService';
import type { Translator } from '../../services/TranslationService';
import { guildConfigService, type ResolvedGuildConfig } from '../../services/GuildConfigService';
import { REMINDER_PING_MODES, ticketReminderService, type ReminderPingMode } from '../../services/TicketReminderService';
import { liveChannel, liveRoles } from '../../utils/liveIds';

/**
 * Panneau interactif `/config tickets` (éphémère, re-rendu depuis la base après chaque action).
 * Namespace `tcfg` (admin uniquement — distinct de `ticket`, ouvert à tous ; utilisable module désactivé) :
 *  - boutons : `tcfg:<action>:<typeId?>`      (src/buttons/tcfg.ts)
 *  - menus   : `tcfg:<action>:<typeId?>`      (src/selectMenus/tcfg.ts)
 *  - modals  : `tcfg:<kind>:<typeId?>`        (src/modals/tcfg.ts)
 * Seul le brouillon de publication du panneau (salon / style / raisons) vit en mémoire, par utilisateur (TTL 15 min).
 */

export const TCFG = 'tcfg';
export const MAX_ACCESS_ROLES = 10;
export const QUESTION_SLOTS = 5;
const KEY_MAX = 32;

export function cid(action: string, arg?: string | number): string {
  return arg === undefined ? buildCustomId(TCFG, action) : buildCustomId(TCFG, action, arg);
}

export interface PanelNotice {
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export interface PanelPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

const NOTICE_ICON: Record<PanelNotice['type'], string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

export const ok = (text: string): PanelNotice => ({ type: 'success', text });
export const ko = (text: string): PanelNotice => ({ type: 'error', text });

// ───── Brouillon de publication ─────

export interface PanelDraft {
  channelId?: string;
  style: PanelStyle;
  typeIds: number[];
}

const drafts = new TTLCache<PanelDraft>(15 * 60_000, 1000);

export function getDraft(guildId: string, userId: string): PanelDraft {
  return drafts.get(`${guildId}:${userId}`) ?? { style: PanelStyle.BUTTONS, typeIds: [] };
}

export function setDraft(guildId: string, userId: string, patch: Partial<PanelDraft>): PanelDraft {
  const next = { ...getDraft(guildId, userId), ...patch };
  drafts.set(`${guildId}:${userId}`, next);
  return next;
}

export function clearDraft(guildId: string, userId: string): void {
  drafts.delete(`${guildId}:${userId}`);
}

// ───── Helpers ─────

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function btn(customId: string, label: string, style: ButtonStyle, emoji?: string, disabled = false): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function row(...components: MessageActionRowComponentBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

function withEmoji(opt: StringSelectMenuOptionBuilder, emoji: string | null): StringSelectMenuOptionBuilder {
  if (emoji) {
    try {
      opt.setEmoji(emoji);
    } catch {
      /* emoji invalide : ignoré */
    }
  }
  return opt;
}

function stateLabel(enabled: boolean, t: Translator): string {
  return enabled ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`;
}

function channelName(guild: Guild, id: string | null | undefined, fallback: string): string {
  if (!id) return fallback;
  return guild.channels.cache.get(id)?.name ?? `#${id}`;
}

function description(notice: PanelNotice | undefined, hint: string): string {
  return notice ? `${NOTICE_ICON[notice.type]} ${notice.text}\n\n${hint}` : hint;
}

/** Clé auto-générée à partir du libellé (slug `[a-z0-9-]{2,32}`). */
export function slugifyKey(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, KEY_MAX)
    .replace(/-$/, '');
  return slug.length >= 2 ? slug : `type-${slug}`.slice(0, KEY_MAX).replace(/-$/, '');
}

/** Clé unique parmi `existing` : `slug`, puis `slug-2`, `slug-3`… */
export function uniqueKey(label: string, existing: string[]): string {
  const base = slugifyKey(label);
  if (!existing.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, KEY_MAX - String(i).length - 1)}-${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base.slice(0, KEY_MAX - 14)}-${Date.now().toString(36)}`;
}

// ───── Vue principale ─────

export async function renderMain(opts: { guild: Guild; t: Translator; notice?: PanelNotice }): Promise<PanelPayload> {
  const { guild, t, notice } = opts;
  const [types, panels, gcfg] = await Promise.all([ticketService.listTypes(guild.id), ticketService.listPanels(guild.id), guildConfigService.get(guild.id)]);

  const embed = embedService.brand(t('tickets.config.title', { server: guild.name }));
  const hint = types.length ? t('tickets.config.hint') : t('tickets.config.empty');
  embed.setDescription(description(notice, gcfg && !gcfg.modules.tickets ? `${t('panels_core.tickets.module_off')}\n\n${hint}` : hint));
  if (types.length) {
    const lines = types.map((ty) =>
      t('tickets.config.type_line', {
        emoji: ty.emoji ?? '🎫',
        label: ty.label,
        state: ty.enabled ? '🟢' : '🔴',
        category: ty.categoryId ? `<#${ty.categoryId}>` : t('tickets.config.no_category'),
        roles: asStringArray(ty.staffRoleIds).length,
        questions: parseQuestions(ty.questions).length,
        max: ty.maxPerUser,
      }),
    );
    embed.addFields({ name: t('tickets.config.field_types', { count: types.length }), value: truncate(lines.join('\n'), 1024) });
  }
  embed.addFields({ name: t('tickets.config.field_panels'), value: panels.length ? t('tickets.config.panels_count', { count: panels.length }) : t('tickets.config.panel_none') });

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (types.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(cid('pick'))
      .setPlaceholder(t('tickets.config.select_placeholder').slice(0, 150))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        types.slice(0, 25).map((ty) =>
          withEmoji(
            new StringSelectMenuOptionBuilder()
              .setLabel(`${ty.label}${ty.enabled ? '' : ` (${t('core.disabled')})`}`.slice(0, 100))
              .setValue(String(ty.id))
              .setDescription(t('tickets.config.option_desc', { category: channelName(guild, ty.categoryId, t('tickets.config.no_category')), questions: parseQuestions(ty.questions).length }).slice(0, 100)),
            ty.emoji,
          ),
        ),
      );
    components.push(row(select));
  }
  components.push(
    row(
      btn(cid('new'), t('tickets.config.btn_new'), ButtonStyle.Success, '➕'),
      btn(cid('defaults'), t('tickets.config.btn_defaults'), ButtonStyle.Secondary, '📦', types.length > 0),
      btn(cid('panelview'), t('tickets.config.btn_panel'), ButtonStyle.Primary, '📋'),
      btn(cid('options'), t('panels_core.tickets.btn_options'), ButtonStyle.Secondary, '⚙️'),
      btn(cid('main'), t('tickets.config.btn_refresh'), ButtonStyle.Secondary, '🔄'),
    ),
  );
  return { embeds: [embed], components };
}

// ───── Vue « options » (module, salon des transcripts, relances) ─────

/** Réglages des relances automatiques affichés dans les options. */
export interface ReminderOptions {
  remindersEnabled: boolean;
  reminderHours: number;
  reminderPing: string;
}

export const REMINDER_HOURS = { min: 1, max: 168 } as const;

export const isReminderPing = (v: string | undefined): v is ReminderPingMode => REMINDER_PING_MODES.includes(v as ReminderPingMode);

/** Délai de relance saisi dans le modal : entier 1–168 (suffixe « h » accepté) ; null si invalide. */
export function parseReminderHours(raw: string | undefined): number | null {
  const v = (raw ?? '').trim().replace(/\s*h$/i, '');
  if (!/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n >= REMINDER_HOURS.min && n <= REMINDER_HOURS.max ? n : null;
}

/** Options communes : module, salon des transcripts / logs tickets (log TICKET), relances automatiques, rappel des rôles staff. */
export function renderOptions(opts: { guild: Guild; config: ResolvedGuildConfig; reminders: ReminderOptions; t: Translator; notice?: PanelNotice }): PanelPayload {
  const { guild, config, reminders, t, notice } = opts;
  const ping: ReminderPingMode = isReminderPing(reminders.reminderPing) ? reminders.reminderPing : 'claimer';
  const enabled = config.modules.tickets;
  const ticketLog = config.logChannels.TICKET;
  const systemLog = config.logChannels.SYSTEM;
  const transcripts = ticketLog ? `<#${ticketLog}>` : systemLog ? t('panels_core.tickets.transcripts_system', { channel: `<#${systemLog}>` }) : t('panels_core.tickets.transcripts_none');
  const staff = config.staffRoleIds.length ? config.staffRoleIds.map((r) => `<@&${r}>`).join(' ') : t('core.none');

  const embed = embedService.brand(t('panels_core.tickets.options_title', { server: guild.name }));
  embed.setDescription(description(notice, `${t('panels_core.tickets.options_hint')}\n${t('panels_core.tickets.permanent_hint')}`));
  embed.addFields(
    { name: t('panels_core.tickets.field_module'), value: stateLabel(enabled, t), inline: true },
    { name: t('panels_core.tickets.field_transcripts'), value: transcripts, inline: true },
    {
      name: t('panels_core.tickets.field_reminders'),
      value: t('panels_core.tickets.reminders_value', { state: stateLabel(reminders.remindersEnabled, t), hours: reminders.reminderHours, ping: t(`panels_core.tickets.ping.${ping}`) }),
    },
    { name: t('panels_core.tickets.field_staff'), value: truncate(t('panels_core.tickets.staff_hint', { roles: staff }), 1024) },
  );

  const select = new ChannelSelectMenuBuilder().setCustomId(cid('translog')).setPlaceholder(t('panels_core.tickets.transcripts_placeholder').slice(0, 150)).addChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  if (ticketLog && guild.channels.cache.get(ticketLog)?.type === ChannelType.GuildText) select.setDefaultChannels(ticketLog);
  const pingSelect = new StringSelectMenuBuilder()
    .setCustomId(cid('rping'))
    .setPlaceholder(t('panels_core.tickets.ping_placeholder').slice(0, 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      REMINDER_PING_MODES.map((m) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(t(`panels_core.tickets.ping.${m}`).slice(0, 100))
          .setValue(m)
          .setDescription(t(`panels_core.tickets.ping_desc.${m}`).slice(0, 100))
          .setDefault(m === ping),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row(select),
      row(pingSelect),
      row(
        btn(cid('rtoggle'), t('panels_core.tickets.btn_reminders', { state: reminders.remindersEnabled ? t('panels_core.common.on') : t('panels_core.common.off') }), reminders.remindersEnabled ? ButtonStyle.Success : ButtonStyle.Secondary, '🔔'),
        btn(cid('rhours'), t('panels_core.tickets.btn_hours', { hours: reminders.reminderHours }), ButtonStyle.Primary, '⏱️'),
        btn(cid('translog-off'), t('panels_core.tickets.btn_transcripts_off'), ButtonStyle.Secondary, '🚫', !ticketLog),
        btn(cid('module'), enabled ? t('panels_core.common.module_on') : t('panels_core.common.module_off'), enabled ? ButtonStyle.Success : ButtonStyle.Danger, enabled ? '🟢' : '🔴'),
        btn(cid('main'), t('core.back'), ButtonStyle.Secondary, '↩️'),
      ),
    ],
  };
}

/** Relit la config du serveur et les réglages de relance, puis rend la vue options. */
export async function loadOptions(opts: { guild: Guild; t: Translator; fallback: ResolvedGuildConfig; notice?: PanelNotice }): Promise<PanelPayload> {
  const [config, reminders] = await Promise.all([guildConfigService.get(opts.guild.id), ticketReminderService.getSettings(opts.guild.id)]);
  return renderOptions({ guild: opts.guild, config: config ?? opts.fallback, reminders, t: opts.t, notice: opts.notice });
}

/** ⏱️ Délai des relances (heures). */
export function buildReminderHoursModal(current: number, t: Translator): ModalBuilder {
  return modal('rhours', t('panels_core.tickets.modal_hours_title')).addLabelComponents(
    labelled(t('panels_core.tickets.modal_hours_label'), input('hours', TextInputStyle.Short, { required: true, max: 4, value: String(current), placeholder: '24' }), t('panels_core.tickets.modal_hours_help', { min: REMINDER_HOURS.min, max: REMINDER_HOURS.max })),
  );
}

// ───── Vue d'une raison ─────

export function renderType(opts: { guild: Guild; type: TicketType; t: Translator; notice?: PanelNotice }): PanelPayload {
  const { guild, type, t, notice } = opts;
  const roles = asStringArray(type.staffRoleIds);
  const questions = parseQuestions(type.questions);
  const spec = parseEmbedSpec(type.embed);

  const embed = embedService.brand(t('tickets.config.type_title', { emoji: type.emoji ?? '🎫', label: type.label }));
  embed.setDescription(description(notice, type.description ?? t('tickets.config.no_description')));
  embed.addFields(
    { name: t('tickets.config.field_key'), value: `\`${type.key}\``, inline: true },
    { name: t('tickets.config.field_state'), value: stateLabel(type.enabled, t), inline: true },
    { name: t('tickets.config.field_max'), value: String(type.maxPerUser), inline: true },
    { name: t('tickets.config.field_category'), value: type.categoryId ? `<#${type.categoryId}>` : t('tickets.config.no_category'), inline: true },
    { name: t('tickets.config.field_archive'), value: type.archiveCategoryId ? `<#${type.archiveCategoryId}>` : t('core.none'), inline: true },
    { name: t('tickets.config.field_name_format'), value: `\`${type.nameFormat}\``, inline: true },
    { name: t('tickets.config.field_roles'), value: roles.length ? roles.map((r) => `<@&${r}>`).join(' ') : t('tickets.config.roles_default') },
    {
      name: t('tickets.config.field_questions', { count: questions.length }),
      value: questions.length
        ? questions.map((q, i) => t('tickets.config.question_line', { index: i + 1, label: q.label, style: q.style, required: q.required ? t('tickets.config.required') : t('tickets.config.optional') })).join('\n')
        : t('tickets.config.no_questions'),
    },
    { name: t('tickets.config.field_welcome'), value: type.welcomeMessage ? `>>> ${truncate(type.welcomeMessage, 300)}` : t('tickets.config.welcome_default') },
    { name: t('tickets.config.field_embed'), value: spec?.title || spec?.description ? `**${truncate(spec.title ?? spec.description ?? '—', 100)}**` : t('tickets.config.embed_default') },
  );

  const id = type.id;
  const category = new ChannelSelectMenuBuilder().setCustomId(cid('category', id)).setPlaceholder(t('tickets.config.category_placeholder').slice(0, 150)).addChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1);
  if (liveChannel(guild, type.categoryId)) category.setDefaultChannels(type.categoryId!);
  const archive = new ChannelSelectMenuBuilder().setCustomId(cid('archive', id)).setPlaceholder(t('tickets.config.archive_placeholder').slice(0, 150)).addChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1);
  if (liveChannel(guild, type.archiveCategoryId)) archive.setDefaultChannels(type.archiveCategoryId!);
  const access = new RoleSelectMenuBuilder().setCustomId(cid('roles', id)).setPlaceholder(t('tickets.config.roles_placeholder').slice(0, 150)).setMinValues(0).setMaxValues(MAX_ACCESS_ROLES);
  const liveAccess = liveRoles(guild, roles).slice(0, MAX_ACCESS_ROLES);
  if (liveAccess.length) access.setDefaultRoles(liveAccess);

  return {
    embeds: [embed],
    components: [
      row(
        btn(cid('info', id), t('tickets.config.btn_info'), ButtonStyle.Secondary, '✏️'),
        btn(cid('questions', id), t('tickets.config.btn_questions'), ButtonStyle.Secondary, '❓'),
        btn(cid('welcome', id), t('tickets.config.btn_welcome'), ButtonStyle.Secondary, '💬'),
        btn(cid('toggle', id), type.enabled ? t('tickets.config.btn_disable') : t('tickets.config.btn_enable'), type.enabled ? ButtonStyle.Success : ButtonStyle.Danger, type.enabled ? '🟢' : '🔴'),
        btn(cid('main'), t('core.back'), ButtonStyle.Secondary, '↩️'),
      ),
      row(category),
      row(archive),
      row(access),
      row(btn(cid('archivenone', id), t('tickets.config.btn_archive_none'), ButtonStyle.Secondary, '🗄️', !type.archiveCategoryId), btn(cid('delete', id), t('tickets.config.btn_delete'), ButtonStyle.Danger, '🗑️')),
    ],
  };
}

export function renderDeleteConfirm(opts: { type: TicketType; t: Translator }): PanelPayload {
  const { type, t } = opts;
  return {
    embeds: [embedService.warning(t('tickets.config.delete_confirm', { label: type.label }))],
    components: [row(btn(cid('delete-confirm', type.id), t('tickets.config.btn_confirm_delete'), ButtonStyle.Danger, '🗑️'), btn(cid('type', type.id), t('core.cancel'), ButtonStyle.Secondary))],
  };
}

// ───── Vue « panneau d'ouverture » ─────

export async function renderPanelView(opts: { guild: Guild; t: Translator; draft: PanelDraft; notice?: PanelNotice }): Promise<PanelPayload> {
  const { guild, t, draft, notice } = opts;
  const [types, panels] = await Promise.all([ticketService.listTypes(guild.id, { enabledOnly: true }), ticketService.listPanels(guild.id)]);
  const selected = draft.typeIds.filter((id) => types.some((ty) => ty.id === id));
  const styleLabel = (s: PanelStyle) => (s === PanelStyle.SELECT ? t('tickets.config.style_select') : t('tickets.config.style_buttons'));

  const embed = embedService.brand(t('tickets.config.panel_title', { server: guild.name }));
  embed.setDescription(description(notice, types.length ? t('tickets.config.panel_hint') : t('tickets.config.no_enabled_types')));
  embed.addFields(
    { name: t('core.channel'), value: draft.channelId ? `<#${draft.channelId}>` : t('tickets.config.panel_no_channel'), inline: true },
    { name: t('tickets.config.panel_style'), value: styleLabel(draft.style), inline: true },
    { name: t('tickets.config.panel_types'), value: selected.length ? selected.map((id) => types.find((ty) => ty.id === id)!.label).join(', ') : t('tickets.config.panel_all_types', { count: types.length }), inline: true },
    {
      name: t('tickets.config.panel_existing'),
      value: panels.length
        ? truncate(panels.map((p) => t('tickets.config.panel_line', { id: p.id, channel: `<#${p.channelId}>`, style: styleLabel(p.style), count: panelTypeCount(p, types.length) })).join('\n'), 1024)
        : t('tickets.config.panel_none'),
    },
  );

  const channel = new ChannelSelectMenuBuilder().setCustomId(cid('pchannel')).setPlaceholder(t('tickets.config.panel_channel_placeholder').slice(0, 150)).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (liveChannel(guild, draft.channelId)) channel.setDefaultChannels(draft.channelId!);

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [row(channel)];
  if (types.length) {
    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId(cid('ptypes'))
      .setPlaceholder(t('tickets.config.panel_types_placeholder').slice(0, 150))
      .setMinValues(0)
      .setMaxValues(Math.min(25, types.length))
      .addOptions(types.slice(0, 25).map((ty) => withEmoji(new StringSelectMenuOptionBuilder().setLabel(ty.label.slice(0, 100)).setValue(String(ty.id)).setDefault(selected.includes(ty.id)), ty.emoji)));
    components.push(row(typeSelect));
  }
  components.push(
    row(
      btn(cid('pstyle', 'buttons'), t('tickets.config.style_buttons'), draft.style === PanelStyle.BUTTONS ? ButtonStyle.Primary : ButtonStyle.Secondary, '🎫'),
      btn(cid('pstyle', 'select'), t('tickets.config.style_select'), draft.style === PanelStyle.SELECT ? ButtonStyle.Primary : ButtonStyle.Secondary, '📋'),
      btn(cid('publish'), t('tickets.config.btn_publish'), ButtonStyle.Success, '🚀', !draft.channelId || !types.length),
      btn(cid('main'), t('core.back'), ButtonStyle.Secondary, '↩️'),
    ),
  );
  if (panels.length) {
    const del = new StringSelectMenuBuilder()
      .setCustomId(cid('pdelete'))
      .setPlaceholder(t('tickets.config.panel_delete_placeholder').slice(0, 150))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(panels.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder().setLabel(t('tickets.config.panel_delete_option', { id: p.id, channel: channelName(guild, p.channelId, p.channelId) }).slice(0, 100)).setValue(String(p.id)).setEmoji('🗑️')));
    components.push(row(del));
  }
  return { embeds: [embed], components };
}

function panelTypeCount(panel: TicketPanel, total: number): number {
  const ids = Array.isArray(panel.typeIds) ? panel.typeIds.length : 0;
  return ids || total;
}

// ───── Modals ─────

function input(id: string, style: TextInputStyle, opts: { value?: string | null; placeholder?: string; required?: boolean; max?: number } = {}): TextInputBuilder {
  const i = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(opts.required ?? false);
  if (opts.max) i.setMaxLength(opts.max);
  if (opts.placeholder) i.setPlaceholder(opts.placeholder.slice(0, 100));
  if (opts.value) i.setValue(opts.value.slice(0, opts.max ?? 4000));
  return i;
}

function labelled(label: string, i: TextInputBuilder, help?: string): LabelBuilder {
  const l = new LabelBuilder().setLabel(label.slice(0, 45)).setTextInputComponent(i);
  if (help) l.setDescription(help.slice(0, 100));
  return l;
}

function modal(kind: string, title: string, typeId?: number): ModalBuilder {
  return new ModalBuilder().setCustomId(typeId === undefined ? cid(kind) : cid(kind, typeId)).setTitle(title.slice(0, 45));
}

/** ➕ Nouvelle raison : libellé (obligatoire), emoji, description. La clé est dérivée du libellé. */
export function buildNewTypeModal(t: Translator): ModalBuilder {
  return modal('new', t('tickets.config.modal_new_title')).addLabelComponents(
    labelled(t('tickets.config.modal_label'), input('label', TextInputStyle.Short, { required: true, max: 80, placeholder: t('tickets.config.modal_label_placeholder') })),
    labelled(t('tickets.config.modal_emoji'), input('emoji', TextInputStyle.Short, { max: 64, placeholder: '🎫' })),
    labelled(t('tickets.config.modal_description'), input('description', TextInputStyle.Short, { max: 100 }), t('tickets.config.modal_description_help')),
  );
}

/** ✏️ Infos : libellé, emoji, description, format de nom, max par membre. */
export function buildInfoModal(type: TicketType, t: Translator): ModalBuilder {
  return modal('info', t('tickets.config.modal_info_title', { label: type.label }), type.id).addLabelComponents(
    labelled(t('tickets.config.modal_label'), input('label', TextInputStyle.Short, { required: true, max: 80, value: type.label })),
    labelled(t('tickets.config.modal_emoji'), input('emoji', TextInputStyle.Short, { max: 64, value: type.emoji, placeholder: '🎫' })),
    labelled(t('tickets.config.modal_description'), input('description', TextInputStyle.Short, { max: 100, value: type.description }), t('tickets.config.modal_description_help')),
    labelled(t('tickets.config.modal_name_format'), input('nameFormat', TextInputStyle.Short, { max: 60, value: type.nameFormat, placeholder: 'ticket-{number}' }), t('tickets.config.modal_name_format_help')),
    labelled(t('tickets.config.modal_max'), input('maxPerUser', TextInputStyle.Short, { max: 2, value: String(type.maxPerUser), placeholder: '1' })),
  );
}

/** ❓ Questions : 5 champs `Label | placeholder | short/paragraph | required/optional | maxLength`. */
export function buildQuestionsModal(type: TicketType, t: Translator): ModalBuilder {
  const existing = parseQuestions(type.questions);
  const m = modal('questions', t('tickets.config.modal_questions_title', { label: type.label }), type.id);
  for (let i = 0; i < QUESTION_SLOTS; i++) {
    const q = existing[i];
    m.addLabelComponents(
      labelled(t('tickets.config.question_slot', { index: i + 1 }), input(`slot_${i + 1}`, TextInputStyle.Short, { max: 200, value: q ? serializeQuestion(q) : undefined, placeholder: t('tickets.config.question_placeholder') }), i === 0 ? t('tickets.config.questions_help') : undefined),
    );
  }
  return m;
}

/** 💬 Message d'accueil : texte + titre / description de l'embed d'ouverture. */
export function buildWelcomeModal(type: TicketType, t: Translator): ModalBuilder {
  const spec = parseEmbedSpec(type.embed);
  return modal('welcome', t('tickets.config.modal_welcome_title', { label: type.label }), type.id).addLabelComponents(
    labelled(t('tickets.config.modal_welcome_message'), input('welcomeMessage', TextInputStyle.Paragraph, { max: 2000, value: type.welcomeMessage }), t('tickets.config.modal_welcome_help')),
    labelled(t('tickets.config.modal_embed_title'), input('title', TextInputStyle.Short, { max: 256, value: spec?.title }), t('tickets.config.modal_embed_help')),
    labelled(t('tickets.config.modal_embed_description'), input('description', TextInputStyle.Paragraph, { max: 4000, value: spec?.description })),
  );
}

// ───── Questions : sérialisation / parsing ─────

/** `Label | placeholder | short/paragraph | required/optional | maxLength` */
export function serializeQuestion(q: TicketQuestion): string {
  return [q.label, q.placeholder ?? '', q.style, q.required ? 'required' : 'optional', q.maxLength ? String(q.maxLength) : ''].join(' | ').replace(/(\s\|\s)+$/, '');
}

export function parseQuestionLine(line: string, index: number): TicketQuestion | null {
  const raw = line.trim();
  if (!raw) return null;
  const [label = '', placeholder = '', style = '', required = '', maxLength = ''] = raw.split('|').map((p) => p.trim());
  const candidate = {
    id: `q${index}`,
    label: label.slice(0, 45),
    placeholder: placeholder ? placeholder.slice(0, 100) : undefined,
    style: /^(p|para|paragraph|long|multi)/i.test(style) ? 'paragraph' : 'short',
    required: !/^(optional|optionnel|false|no|non|0)$/i.test(required),
    maxLength: maxLength && /^\d+$/.test(maxLength) ? Number(maxLength) : undefined,
  };
  const r = ticketQuestionSchema.safeParse(candidate);
  if (!r.success) throw new TicketError('invalid_question', { index, details: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ') });
  return r.data;
}

/** Parse les 5 champs du modal (lignes vides ignorées, renumérotées q1..qN). */
export function parseQuestionSlots(values: (string | undefined)[]): TicketQuestion[] {
  const out: TicketQuestion[] = [];
  values.slice(0, QUESTION_SLOTS).forEach((value, i) => {
    const q = parseQuestionLine(value ?? '', i + 1);
    if (q) out.push(q);
  });
  return out;
}

export function readQuestionsModal(interaction: ModalSubmitInteraction): TicketQuestion[] {
  return parseQuestionSlots(Array.from({ length: QUESTION_SLOTS }, (_, i) => getField(interaction, `slot_${i + 1}`)));
}

export function getField(interaction: ModalSubmitInteraction, id: string): string | undefined {
  try {
    const v = interaction.fields.getTextInputValue(id).trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}
