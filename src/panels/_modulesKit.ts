import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuBuilder,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type RoleSelectMenuBuilder,
  type StringSelectMenuBuilder,
  type UserSelectMenuBuilder,
} from 'discord.js';
import type { GuildKind } from '@prisma/client';
import { ZodError } from 'zod';
import { MODULE_LABELS, type ModuleKey } from '../config/constants';
import { embedService } from '../services/EmbedService';
import { guildConfigService, type ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator, TranslationVars } from '../services/TranslationService';

/**
 * Briques communes des panneaux `/config` « modules » (roles, fivem, battleroyale, whitelist, school, shop).
 * Chaque panneau est entièrement re-rendu depuis la base après chaque action, avec une notice ✅/❌.
 */

export type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

export interface PanelNotice {
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export interface PanelPayload {
  embeds: EmbedBuilder[];
  components: Row[];
}

const NOTICE_ICON: Record<PanelNotice['type'], string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

export const ok = (text: string): PanelNotice => ({ type: 'success', text });
export const ko = (text: string): PanelNotice => ({ type: 'error', text });
export const warn = (text: string): PanelNotice => ({ type: 'warning', text });

/** Erreur « métier » d'un panneau : clé de traduction + variables, affichée en notice ❌. */
export class PanelError extends Error {
  constructor(
    readonly key: string,
    readonly vars?: TranslationVars,
  ) {
    super(key);
    this.name = 'PanelError';
  }
}

/** Préfixe de traduction des erreurs des services (identifiées par `err.name`, chacune porte un `code`). */
const SERVICE_ERROR_PREFIX: Record<string, string> = {
  FiveMError: 'fivem.errors',
  ShopError: 'shop.errors',
  SchoolError: 'school.errors',
  BattleRoyaleError: 'battleroyale.errors',
  WhitelistError: 'whitelist.errors',
};

/** Texte d'une erreur connue (PanelError, erreurs des services, Zod, API Discord) ; `null` si inconnue (à relancer). */
export function describeError(err: unknown, t: Translator): string | null {
  if (err instanceof PanelError) return t(err.key, err.vars);
  if (err instanceof ZodError) return t('core.invalid_input', { details: err.issues.map((i) => `${i.path.join('.') || '—'}: ${i.message}`).join('; ').slice(0, 300) });
  if (err instanceof DiscordAPIError) return t('panels_modules.common.discord_error', { details: err.message.slice(0, 200) });
  if (err instanceof Error && err.name in SERVICE_ERROR_PREFIX && typeof (err as { code?: unknown }).code === 'string') return t(`${SERVICE_ERROR_PREFIX[err.name]}.${(err as unknown as { code: string }).code}`);
  return null;
}

/** Exécute une action et la convertit en notice (✅ texte renvoyé / ❌ erreur connue). Les erreurs inconnues sont relancées. */
export async function attempt(t: Translator, action: () => Promise<PanelNotice | string>): Promise<PanelNotice> {
  try {
    const r = await action();
    return typeof r === 'string' ? ok(r) : r;
  } catch (err) {
    const text = describeError(err, t);
    if (text === null) throw err;
    return ko(text);
  }
}

// ───── Texte ─────

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Description d'embed : notice éventuelle puis texte d'aide. */
export function withNotice(notice: PanelNotice | undefined, text: string): string {
  return truncate(notice ? `${NOTICE_ICON[notice.type]} ${notice.text}\n\n${text}` : text, 4096);
}

/** Lignes jointes et tronquées pour un champ d'embed (1024 caractères), avec repli si vide. */
export function fieldLines(lines: string[], empty: string, max = 1024): string {
  if (!lines.length) return empty;
  let out = '';
  for (const [i, line] of lines.entries()) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > max - 12) return `${out}\n… (+${lines.length - i})`;
    out = next;
  }
  return out;
}

export const roleMention = (id: string | null | undefined, none: string): string => (id ? `<@&${id}>` : none);
export const channelMention = (id: string | null | undefined, none: string): string => (id ? `<#${id}>` : none);
export const stateLabel = (enabled: boolean, t: Translator): string => (enabled ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`);

// ───── Composants ─────

export function btn(customId: string, label: string, style: ButtonStyle, emoji?: string, disabled = false): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(truncate(label, 80)).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/** Option de menu avec emoji optionnel (emoji invalide ignoré). */
export function option(label: string, value: string, opts: { description?: string | null; emoji?: string | null; default?: boolean } = {}): StringSelectMenuOptionBuilder {
  const o = new StringSelectMenuOptionBuilder().setLabel(truncate(label || value, 100)).setValue(value.slice(0, 100));
  if (opts.description) o.setDescription(truncate(opts.description, 100));
  if (opts.default) o.setDefault(true);
  if (opts.emoji) {
    try {
      o.setEmoji(opts.emoji);
    } catch {
      /* emoji invalide : ignoré */
    }
  }
  return o;
}

/** Bouton d'activation / désactivation d'un module. */
export function moduleButton(customId: string, module: ModuleKey, enabled: boolean, t: Translator): ButtonBuilder {
  return btn(customId, enabled ? t('panels_modules.common.module_disable', { module: moduleName(module) }) : t('panels_modules.common.module_enable', { module: moduleName(module) }), enabled ? ButtonStyle.Secondary : ButtonStyle.Success, enabled ? '⏸️' : '▶️');
}

/** Libellé du module sans son emoji (« 🎭 Auto Role » → « Auto Role »). */
export function moduleName(module: ModuleKey): string {
  return MODULE_LABELS[module].replace(/^\S+\s/, '');
}

/** Ligne d'état du module + avertissement de type de serveur. */
export function moduleLine(config: ResolvedGuildConfig, module: ModuleKey, t: Translator, kinds?: GuildKind[]): string {
  const lines = [`${t('panels_modules.common.module_state', { module: MODULE_LABELS[module] })} ${stateLabel(config.modules[module], t)}`];
  if (!config.modules[module]) lines.push(t('panels_modules.common.module_off_hint'));
  if (kinds?.length && !kinds.includes(config.kind)) lines.push(t('panels_modules.common.wrong_kind', { kinds: kinds.join(', ') }));
  return lines.join('\n');
}

/** Active / désactive un module et renvoie la configuration à jour. */
export async function toggleModule(config: ResolvedGuildConfig, module: ModuleKey, t: Translator): Promise<{ config: ResolvedGuildConfig; notice: PanelNotice }> {
  const enabled = !config.modules[module];
  await guildConfigService.setModule(config.guildId, module, enabled);
  const fresh = (await guildConfigService.get(config.guildId)) ?? { ...config, modules: { ...config.modules, [module]: enabled } };
  return { config: fresh, notice: ok(t(enabled ? 'panels_modules.common.module_enabled' : 'panels_modules.common.module_disabled', { module: MODULE_LABELS[module] })) };
}

// ───── Modals ─────

export function textInput(id: string, style: TextInputStyle, opts: { value?: string | null; placeholder?: string; required?: boolean; max?: number; min?: number } = {}): TextInputBuilder {
  const i = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(opts.required ?? false);
  if (opts.max) i.setMaxLength(opts.max);
  if (opts.min) i.setMinLength(opts.min);
  if (opts.placeholder) i.setPlaceholder(truncate(opts.placeholder, 100));
  if (opts.value) i.setValue(opts.value.slice(0, opts.max ?? 4000));
  return i;
}

type LabelComponent = TextInputBuilder | StringSelectMenuBuilder | RoleSelectMenuBuilder | ChannelSelectMenuBuilder | UserSelectMenuBuilder;

/** Champ de modal (label ≤ 45 caractères, aide ≤ 100). */
export function labelled(label: string, component: LabelComponent, help?: string): LabelBuilder {
  const l = new LabelBuilder().setLabel(truncate(label, 45));
  if (help) l.setDescription(truncate(help, 100));
  if (component instanceof TextInputBuilder) l.setTextInputComponent(component);
  else if ('setDefaultRoles' in component) l.setRoleSelectMenuComponent(component as RoleSelectMenuBuilder);
  else if ('setDefaultChannels' in component) l.setChannelSelectMenuComponent(component as ChannelSelectMenuBuilder);
  else if ('setDefaultUsers' in component) l.setUserSelectMenuComponent(component as UserSelectMenuBuilder);
  else l.setStringSelectMenuComponent(component as StringSelectMenuBuilder);
  return l;
}

export function modal(customId: string, title: string, ...labels: LabelBuilder[]): ModalBuilder {
  return new ModalBuilder().setCustomId(customId).setTitle(truncate(title, 45)).addLabelComponents(...labels);
}

/** Valeur texte d'un champ de modal (trim, `undefined` si vide ou absent). */
export function modalText(interaction: ModalSubmitInteraction, id: string): string | undefined {
  const f = interaction.fields.fields.get(id) as { value?: unknown } | undefined;
  const v = typeof f?.value === 'string' ? f.value.trim() : '';
  return v || undefined;
}

/** Valeurs d'un menu (string / rôle / salon / membre) placé dans un modal. */
export function modalValues(interaction: ModalSubmitInteraction, id: string): string[] {
  const f = interaction.fields.fields.get(id) as { values?: readonly string[] } | undefined;
  return f?.values ? [...f.values] : [];
}

// ───── Réponses ─────

type Updatable = ButtonInteraction | AnySelectMenuInteraction;

/** Re-rend le panneau depuis un bouton / menu (update, ou editReply si déjà différé). */
export async function show(interaction: Updatable, payload: PanelPayload): Promise<void> {
  // `content: ''` efface un éventuel texte laissé par une vue précédente (ex. éditeur de role menu).
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content: '', ...payload });
  else await interaction.update({ content: '', ...payload });
}

/** Re-rend le panneau depuis un modal : update si le modal vient du panneau, sinon réponse éphémère. */
export async function respond(interaction: ModalSubmitInteraction, payload: PanelPayload): Promise<void> {
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content: '', ...payload });
  else if (interaction.isFromMessage()) await interaction.update({ content: '', ...payload });
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Diffère un modal (actions lentes : réseau, publication) en conservant le message du panneau. */
export async function deferModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

/** Réponse éphémère d'erreur pour une action inconnue. */
export async function unknownAction(interaction: Updatable | ModalSubmitInteraction, t: Translator, action: string): Promise<void> {
  const payload = { embeds: [embedService.error(t('core.invalid_input', { details: action || '—' }))], flags: MessageFlags.Ephemeral } as const;
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

/** Entier strict (ou `null` si vide) ; lance PanelError si invalide / hors bornes. */
export function parseIntField(raw: string | undefined, label: string, opts: { min?: number; max?: number; allowEmpty?: boolean } = {}): number | null {
  if (raw === undefined || raw === '') {
    if (opts.allowEmpty) return null;
    throw new PanelError('panels_modules.common.required_field', { field: label });
  }
  const s = raw.replace(/\s+/g, '');
  if (!/^[-+]?\d+$/.test(s)) throw new PanelError('panels_modules.common.invalid_number', { field: label, value: raw });
  const n = Number(s);
  if (!Number.isSafeInteger(n) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    throw new PanelError('panels_modules.common.out_of_range', { field: label, min: opts.min ?? '−∞', max: opts.max ?? '∞' });
  }
  return n;
}
