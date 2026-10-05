import { ButtonStyle, ChannelSelectMenuBuilder, ChannelType, PermissionsBitField, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputStyle, type Guild, type GuildMember, type ModalBuilder } from 'discord.js';
import { buildCustomId } from '../utils/customId';
import { liveChannel, liveChannels } from '../utils/liveIds';
import { embedService } from '../services/EmbedService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import {
  MAX_LOBBIES,
  MAX_RULES,
  MAX_USER_LIMIT,
  VOICE_LANGUAGE_PRESETS,
  buildChannelName,
  getVoicePreset,
  memberDisplayName,
  missingBotPermissions,
  resolveRule,
  tempVoiceService,
  type TempVoiceSettings,
  type VoiceNameRule,
} from '../services/TempVoiceService';
import { PanelError, btn, fieldLines, labelled, modal, moduleButton, moduleLine, option, parseIntField, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload, type Row } from './_modulesKit';

/**
 * Panneau `/config module:vocal` — namespace `cfg-vocal` (admin) :
 *  - vue principale : `lobbies` (ChannelSelect vocaux, 0–10), `category` (ChannelSelect catégorie, 0–1),
 *    boutons `view:rules`, `limit` (modal), `test`, `detect`, `owner`, `transfer`, `module`, `view:main`
 *  - vue règles     : `preset` (StringSelect langue) → `role:<langue>` (RoleSelect), `rule` (StringSelect règle),
 *    boutons `up:<i>` / `down:<i>` / `edit:<i>` (modal) / `del:<i>`, `fallback` (modal), `detect`, `view:main`
 */

export const VOCAL_NS = 'cfg-vocal';
export const vcid = (action: string, ...args: (string | number)[]): string => buildCustomId(VOCAL_NS, action, ...args);
export type VocalView = 'main' | 'rules';

export interface VocalRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  /** Membre qui ouvre le panneau : aperçu du nom de son salon */
  member?: GuildMember | null;
  view?: VocalView;
  /** Langue choisie dans la vue règles (affiche le menu de rôle) */
  picked?: string;
  /** Règle sélectionnée (affiche ses actions) */
  selected?: number;
  notice?: PanelNotice;
}

/** Exemple lisible d'une règle (`🇫🇷 Salon de Alex`). */
export function ruleExample(rule: Pick<VoiceNameRule, 'emoji' | 'template'>, t: Translator): string {
  return buildChannelName(rule, t('vocal.panel.sample_name'));
}

/** Libellé d'une langue proposée (`🇫🇷 Français`) ou « personnalisé ». */
export function presetLabel(key: string, t: Translator): string {
  const p = getVoicePreset(key);
  return p ? `${p.emoji} ${p.label}` : t('vocal.panel.custom');
}

function roleName(guild: Guild, id: string): string {
  return (guild as Partial<Guild>).roles?.cache.get(id)?.name ?? id;
}

function lobbyLines(guild: Guild, settings: TempVoiceSettings, t: Translator): string[] {
  const effective = tempVoiceService.lobbiesFor(guild, settings);
  if (!settings.configured) return effective.length ? effective.map((id) => `<#${id}> ${t('vocal.panel.lobby_default')}`) : [];
  return settings.lobbyIds.map((id) => ((guild as Partial<Guild>).channels?.cache.has(id) ? `<#${id}>` : t('vocal.panel.lobby_missing', { id })));
}

function rulesField(settings: TempVoiceSettings, t: Translator): string {
  const lines = settings.rules.map((r, i) => `${i + 1}. <@&${r.roleId}> → \`${ruleExample(r, t)}\``);
  lines.push(t('vocal.panel.fallback_line', { example: ruleExample(settings.fallback, t) }));
  return fieldLines(lines, t('vocal.panel.no_rules'));
}

export async function renderVocal(opts: VocalRenderOptions): Promise<PanelPayload> {
  const settings = await tempVoiceService.getConfig(opts.guild.id);
  return opts.view === 'rules' ? renderRules(opts, settings) : renderMain(opts, settings);
}

async function renderMain({ guild, config, t, member, notice }: VocalRenderOptions, settings: TempVoiceSettings): Promise<PanelPayload> {
  const active = await tempVoiceService.listActive(guild.id, guild);
  const lobbies = lobbyLines(guild, settings, t);
  const limit = settings.userLimit === null ? t('vocal.panel.limit_inherit') : settings.userLimit === 0 ? t('vocal.panel.limit_none') : String(settings.userLimit);
  const missing = missingBotPermissions((guild as Partial<Guild>).members?.me?.permissions);
  const lines = [t('vocal.panel.hint'), moduleLine(config, 'vocal', t)];
  if (missing.length) lines.push(t('vocal.panel.missing_perms', { permissions: new PermissionsBitField(missing.reduce((a, b) => a | b, 0n)).toArray().join(', ') }));
  if (member) {
    const r = resolveRule(member.roles.cache.keys(), settings.rules, settings.fallback);
    lines.push(t('vocal.panel.preview', { name: buildChannelName(r.rule, memberDisplayName(member)) }));
  }

  const embed = embedService
    .brand(t('vocal.panel.title', { server: guild.name }))
    .setDescription(withNotice(notice, lines.join('\n\n')))
    .addFields(
      { name: t('vocal.panel.field_lobbies', { count: lobbies.length, max: MAX_LOBBIES }), value: fieldLines(lobbies, t('vocal.panel.no_lobby')) },
      { name: t('vocal.panel.field_category'), value: settings.categoryId ? `<#${settings.categoryId}>` : t('vocal.panel.category_lobby'), inline: true },
      { name: t('vocal.panel.field_limit'), value: limit, inline: true },
      { name: t('vocal.panel.field_active'), value: String(active.filter((a) => a.exists).length), inline: true },
      { name: t('vocal.panel.field_owner'), value: settings.ownerPermissions ? t('core.yes') : t('core.no'), inline: true },
      { name: t('vocal.panel.field_transfer'), value: settings.transferOwnership ? t('core.yes') : t('core.no'), inline: true },
      { name: t('vocal.panel.field_rules', { count: settings.rules.length }), value: rulesField(settings, t) },
    );

  const lobbySelect = new ChannelSelectMenuBuilder()
    .setCustomId(vcid('lobbies'))
    .setPlaceholder(truncate(t('vocal.panel.lobbies_placeholder'), 150))
    .addChannelTypes(ChannelType.GuildVoice)
    .setMinValues(0)
    .setMaxValues(MAX_LOBBIES);
  const lobbyDefaults = liveChannels(guild, tempVoiceService.lobbiesFor(guild, settings)).slice(0, MAX_LOBBIES);
  if (lobbyDefaults.length) lobbySelect.setDefaultChannels(...lobbyDefaults);
  const categorySelect = new ChannelSelectMenuBuilder()
    .setCustomId(vcid('category'))
    .setPlaceholder(truncate(t('vocal.panel.category_placeholder'), 150))
    .addChannelTypes(ChannelType.GuildCategory)
    .setMinValues(0)
    .setMaxValues(1);
  const category = liveChannel(guild, settings.categoryId);
  if (category) categorySelect.setDefaultChannels(category);

  return {
    embeds: [embed],
    components: [
      row(lobbySelect),
      row(categorySelect),
      row(
        btn(vcid('view', 'rules'), t('vocal.panel.btn_rules'), ButtonStyle.Primary, '🌍'),
        btn(vcid('limit'), t('vocal.panel.btn_limit'), ButtonStyle.Secondary, '🔢'),
        btn(vcid('test'), t('vocal.panel.btn_test'), ButtonStyle.Secondary, '🧪'),
        btn(vcid('detect'), t('vocal.panel.btn_detect'), ButtonStyle.Secondary, '🔎'),
      ),
      row(
        btn(vcid('owner'), t('vocal.panel.btn_owner'), settings.ownerPermissions ? ButtonStyle.Success : ButtonStyle.Secondary, '👑'),
        btn(vcid('transfer'), t('vocal.panel.btn_transfer'), settings.transferOwnership ? ButtonStyle.Success : ButtonStyle.Secondary, '🔁'),
        moduleButton(vcid('module'), 'vocal', config.modules.vocal, t),
        btn(vcid('view', 'main'), t('panels_modules.common.refresh'), ButtonStyle.Secondary, '🔄'),
      ),
    ],
  };
}

function renderRules({ guild, t, picked, selected, notice }: VocalRenderOptions, settings: TempVoiceSettings): PanelPayload {
  const embed = embedService
    .brand(t('vocal.panel.rules_title'))
    .setDescription(withNotice(notice, t('vocal.panel.rules_hint', { max: MAX_RULES })))
    .addFields({ name: t('vocal.panel.field_rules', { count: settings.rules.length }), value: rulesField(settings, t) });

  const components: Row[] = [];
  const presetSelect = new StringSelectMenuBuilder()
    .setCustomId(vcid('preset'))
    .setPlaceholder(truncate(t('vocal.panel.preset_placeholder'), 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(VOICE_LANGUAGE_PRESETS.map((p) => option(p.label, p.key, { emoji: p.emoji, description: ruleExample(p, t), default: p.key === picked })));
  components.push(row(presetSelect));

  const preset = getVoicePreset(picked);
  if (preset) {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(vcid('role', preset.key))
      .setPlaceholder(truncate(t('vocal.panel.role_placeholder', { language: `${preset.emoji} ${preset.label}` }), 150))
      .setMinValues(1)
      .setMaxValues(1);
    components.push(row(roleSelect));
  }

  const current = selected !== undefined && settings.rules[selected] ? selected : undefined;
  if (settings.rules.length) {
    const ruleSelect = new StringSelectMenuBuilder()
      .setCustomId(vcid('rule'))
      .setPlaceholder(truncate(t('vocal.panel.rule_placeholder'), 150))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(settings.rules.slice(0, MAX_RULES).map((r, i) => option(`${i + 1}. ${roleName(guild, r.roleId)}`, String(i), { description: ruleExample(r, t), default: i === current })));
    components.push(row(ruleSelect));
  }
  if (current !== undefined) {
    components.push(
      row(
        btn(vcid('up', current), t('vocal.panel.btn_up'), ButtonStyle.Secondary, '⬆️', current === 0),
        btn(vcid('down', current), t('vocal.panel.btn_down'), ButtonStyle.Secondary, '⬇️', current === settings.rules.length - 1),
        btn(vcid('edit', current), t('vocal.panel.btn_edit'), ButtonStyle.Primary, '✏️'),
        btn(vcid('del', current), t('vocal.panel.btn_delete'), ButtonStyle.Danger, '🗑️'),
      ),
    );
  }
  components.push(
    row(
      btn(vcid('fallback'), t('vocal.panel.btn_fallback'), ButtonStyle.Secondary, '🌐'),
      btn(vcid('detect'), t('vocal.panel.btn_detect'), ButtonStyle.Secondary, '🔎'),
      btn(vcid('view', 'main'), t('core.back'), ButtonStyle.Secondary, '↩️'),
    ),
  );
  return { embeds: [embed], components: components.slice(0, 5) };
}

// ───── Modals ─────

export function buildLimitModal(settings: TempVoiceSettings, t: Translator): ModalBuilder {
  return modal(
    vcid('limit'),
    t('vocal.panel.limit_modal_title'),
    labelled(t('vocal.panel.limit_label'), textInput('limit', TextInputStyle.Short, { max: 3, value: settings.userLimit === null ? '' : String(settings.userLimit), placeholder: t('vocal.panel.limit_placeholder') }), t('vocal.panel.limit_help', { max: MAX_USER_LIMIT })),
  );
}

/** Modal d'édition d'une règle (`edit:<i>`) ou de la règle de repli (`fallback`). */
export function buildRuleModal(customId: string, title: string, rule: VoiceNameRule, t: Translator): ModalBuilder {
  return modal(
    customId,
    title,
    labelled(t('vocal.panel.emoji_label'), textInput('emoji', TextInputStyle.Short, { max: 16, value: rule.emoji, placeholder: '🇫🇷' }), t('vocal.panel.emoji_help')),
    labelled(t('vocal.panel.template_label'), textInput('template', TextInputStyle.Short, { max: 90, required: true, value: rule.template, placeholder: 'Salon de {name}' }), t('vocal.panel.template_help')),
  );
}

export function editModal(index: number, settings: TempVoiceSettings, t: Translator): ModalBuilder {
  const rule = settings.rules[index];
  if (!rule) throw new PanelError('vocal.panel.rule_not_found');
  return buildRuleModal(vcid('edit', index), t('vocal.panel.edit_modal_title', { n: index + 1 }), rule, t);
}

export function fallbackModal(settings: TempVoiceSettings, t: Translator): ModalBuilder {
  return buildRuleModal(vcid('fallback'), t('vocal.panel.fallback_modal_title'), settings.fallback, t);
}

/** Limite saisie : vide = celle du lobby, 0 = illimitée, 1–99. */
export function parseLimitField(raw: string | undefined, t: Translator): number | null {
  return parseIntField(raw, t('vocal.panel.limit_label'), { min: 0, max: MAX_USER_LIMIT, allowEmpty: true });
}

/** Déplace la règle `index` d'un cran (`-1` haut, `+1` bas). */
export function moveRule<T>(rules: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= rules.length || target < 0 || target >= rules.length) return [...rules];
  const out = [...rules];
  [out[index], out[target]] = [out[target]!, out[index]!];
  return out;
}
