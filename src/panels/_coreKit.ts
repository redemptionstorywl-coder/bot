import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type StringSelectMenuBuilder,
} from 'discord.js';
import type { ModuleKey } from '../config/constants';
import { embedService } from '../services/EmbedService';
import { guildConfigService } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';

/**
 * Briques communes des panneaux `/config` « cœur » (general, logs, moderation).
 * Chaque panneau est re-rendu depuis la base après chaque action, avec une notice ✅/❌ en tête de description.
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

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Description d'embed : notice éventuelle, puis lignes d'aide (les lignes vides / null sont ignorées). */
export function withNotice(notice: PanelNotice | undefined, ...lines: (string | null | undefined)[]): string {
  const body = lines.filter((l): l is string => Boolean(l)).join('\n\n');
  return truncate(notice ? `${NOTICE_ICON[notice.type]} ${notice.text}${body ? `\n\n${body}` : ''}` : body || '​', 4096);
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

export const stateLabel = (enabled: boolean, t: Translator): string => (enabled ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`);
export const roleList = (ids: string[], none: string): string => (ids.length ? ids.map((r) => `<@&${r}>`).join(' ') : none);
export const channelList = (ids: string[], none: string): string => (ids.length ? ids.map((c) => `<#${c}>`).join(' ') : none);
export const userList = (ids: string[], none: string): string => (ids.length ? ids.map((u) => `<@${u}>`).join(' ') : none);

/** Libellé traduit d'un module (« 👋 Bienvenue »). */
export const moduleLabel = (module: ModuleKey, t: Translator): string => t(`panels_core.modules.${module}`);

/** Avertissement affiché quand le module lié est désactivé (null sinon). */
export function moduleWarning(module: ModuleKey, enabled: boolean, t: Translator): string | null {
  return enabled ? null : t('panels_core.common.module_off_warning', { module: moduleLabel(module, t) });
}

// ───── Composants ─────

export function btn(customId: string, label: string, style: ButtonStyle, emoji?: string, disabled = false): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(truncate(label, 80)).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/** Bouton bascule : vert si actif, gris sinon. */
export function toggleBtn(customId: string, label: string, enabled: boolean, emoji?: string): ButtonBuilder {
  return btn(customId, label, enabled ? ButtonStyle.Success : ButtonStyle.Secondary, emoji ?? (enabled ? '🟢' : '🔴'));
}

/** Bouton d'activation du module lié au panneau. */
export function moduleBtn(customId: string, enabled: boolean, t: Translator): ButtonBuilder {
  return btn(customId, enabled ? t('panels_core.common.module_on') : t('panels_core.common.module_off'), enabled ? ButtonStyle.Success : ButtonStyle.Danger, enabled ? '🟢' : '🔴');
}

export function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/** Option de menu (emoji invalide ignoré). */
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

/** IDs de rôles encore présents sur le serveur (une valeur par défaut inconnue ferait échouer le message). */
export function existingRoles(guild: Guild, ids: string[], max = 25): string[] {
  const cache = (guild as Partial<Guild>).roles?.cache;
  return (cache ? ids.filter((id) => cache.has(id)) : ids).slice(0, max);
}

/** IDs de salons encore présents (et du bon type si `types` est fourni : un défaut d'un autre type serait refusé). */
export function existingChannels(guild: Guild, ids: string[], max = 25, types?: readonly ChannelType[]): string[] {
  const cache = (guild as Partial<Guild>).channels?.cache;
  if (!cache) return ids.slice(0, max);
  return ids
    .filter((id) => {
      const channel = cache.get(id) as { type?: ChannelType } | undefined;
      return Boolean(channel) && (!types || channel!.type === undefined || types.includes(channel!.type));
    })
    .slice(0, max);
}

// ───── Modals ─────

export function textInput(id: string, style: TextInputStyle, opts: { value?: string | null; placeholder?: string; required?: boolean; max?: number } = {}): TextInputBuilder {
  const i = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(opts.required ?? false);
  if (opts.max) i.setMaxLength(opts.max);
  if (opts.placeholder) i.setPlaceholder(truncate(opts.placeholder, 100));
  if (opts.value) i.setValue(opts.value.slice(0, opts.max ?? 4000));
  return i;
}

/** Champ de modal : label ≤ 45 caractères, aide ≤ 100. */
export function labelled(label: string, component: TextInputBuilder | StringSelectMenuBuilder, help?: string): LabelBuilder {
  const l = new LabelBuilder().setLabel(truncate(label, 45));
  if (help) l.setDescription(truncate(help, 100));
  if (component instanceof TextInputBuilder) l.setTextInputComponent(component);
  else l.setStringSelectMenuComponent(component);
  return l;
}

export function modal(customId: string, title: string, ...labels: LabelBuilder[]): ModalBuilder {
  return new ModalBuilder().setCustomId(customId).setTitle(truncate(title, 45)).addLabelComponents(...labels);
}

/** Texte d'un champ de modal (trim, `undefined` si vide ou absent). */
export function modalText(interaction: ModalSubmitInteraction, id: string): string | undefined {
  const f = interaction.fields.fields.get(id) as { value?: unknown } | undefined;
  const v = typeof f?.value === 'string' ? f.value.trim() : '';
  return v || undefined;
}

/** Valeurs d'un menu placé dans un modal. */
export function modalValues(interaction: ModalSubmitInteraction, id: string): string[] {
  const f = interaction.fields.fields.get(id) as { values?: readonly string[] } | undefined;
  return f?.values ? [...f.values] : [];
}

// ───── Réponses ─────

type Updatable = ButtonInteraction | AnySelectMenuInteraction;

/** Ouverture depuis `/config` : réponse éphémère. */
export async function openPanel(interaction: ChatInputCommandInteraction, payload: PanelPayload): Promise<void> {
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Re-rend le panneau depuis un bouton / menu (update, ou editReply si déjà différé). */
export async function show(interaction: Updatable, payload: PanelPayload): Promise<void> {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

/** Re-rend le panneau depuis un modal : update si le modal vient du panneau, sinon réponse éphémère. */
export async function respond(interaction: ModalSubmitInteraction, payload: PanelPayload): Promise<void> {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else if (interaction.isFromMessage()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Réponse éphémère pour une action inconnue. */
export async function unknownAction(interaction: Updatable | ModalSubmitInteraction, t: Translator, action: string): Promise<void> {
  const payload = { embeds: [embedService.error(t('core.invalid_input', { details: action || '—' }))], flags: MessageFlags.Ephemeral } as const;
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

/** Bascule un module et renvoie la notice correspondante. */
export async function toggleModule(guildId: string, module: ModuleKey, current: boolean, t: Translator): Promise<PanelNotice> {
  const enabled = !current;
  await guildConfigService.setModule(guildId, module, enabled);
  return ok(t('panels_core.common.module_set', { module: moduleLabel(module, t), state: stateLabel(enabled, t) }));
}

/** Texte lisible d'une erreur de validation (Zod ou Error). */
export function errorDetails(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    return (err as { issues: { path: (string | number)[]; message: string }[] }).issues.map((i) => `${i.path.join('.') || '—'}: ${i.message}`).join('; ').slice(0, 300);
  }
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}
