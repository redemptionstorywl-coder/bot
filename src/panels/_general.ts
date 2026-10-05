import { ButtonStyle, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputStyle, type Guild } from 'discord.js';
import { GuildKind, LogCategory } from '@prisma/client';
import { EMBED_COLOR_PALETTE, LANGUAGES, MODULE_KEYS, type ModuleKey } from '../config/constants';
import { buildCustomId } from '../utils/customId';
import { embedService } from '../services/EmbedService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import { DEFAULT_AUTO_TRANSLATE } from '../services/autotranslate/bilingual';
import { describeProvider, type ProviderDescription } from '../services/autotranslate/providers';
import { btn, existingRoles, labelled, modal, moduleLabel, option, roleList, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload } from './_coreKit';

/**
 * Panneau `/config general` (namespace `cfg-general`, admin) :
 *  - menus   : `cfg-general:kind` · `cfg-general:lang` · `cfg-general:admins` · `cfg-general:staff` · `cfg-general:modules` · `cfg-general:palette`
 *  - boutons : `cfg-general:view:<main|modules|color>` · `cfg-general:hex` (modal) · `cfg-general:footer` (modal)
 *              `cfg-general:autotr` (traduction automatique en anglais on/off) · `cfg-general:trlayout` (mise en page embed / texte)
 *  - modals  : `cfg-general:hex` · `cfg-general:footer`
 */

export const CFG_GENERAL = 'cfg-general';
export const gid = (...parts: string[]): string => buildCustomId(CFG_GENERAL, ...parts);

export type GeneralView = 'main' | 'modules' | 'color';
export const GENERAL_VIEWS: readonly GeneralView[] = ['main', 'modules', 'color'];
export const isGeneralView = (v: string | undefined): v is GeneralView => GENERAL_VIEWS.includes(v as GeneralView);

export const GUILD_KINDS = Object.values(GuildKind) as GuildKind[];
export const LOG_CATEGORY_COUNT = Object.values(LogCategory).length;
/** Rôles admin / staff sélectionnables (limite d'un RoleSelect). */
export const MAX_PANEL_ROLES = 25;

export function hexOf(color: number): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

/** `#RGB`, `RGB`, `#RRGGBB` ou `RRGGBB` → `#RRGGBB` ; null si invalide. */
export function parseHexColor(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${[...v].map((c) => c + c).join('').toUpperCase()}`;
  return null;
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Valide le footer saisi (texte vide = footer par défaut, icône : URL http(s)). */
export function parseFooter(text: string | undefined, icon: string | undefined): { ok: true; footerText: string | null; footerIconUrl: string | null } | { ok: false; error: string } {
  const footerText = text?.trim() ? text.trim().slice(0, 2048) : null;
  const footerIconUrl = icon?.trim() ? icon.trim() : null;
  if (footerIconUrl && !isHttpUrl(footerIconUrl)) return { ok: false, error: footerIconUrl.slice(0, 100) };
  return { ok: true, footerText, footerIconUrl };
}

/** Modules cochés → map complète { module: activé }. */
export function modulesFromSelection(values: readonly string[]): Record<ModuleKey, boolean> {
  const selected = new Set(values);
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, selected.has(k)])) as Record<ModuleKey, boolean>;
}

function languageLabel(code: string): string {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? `${l.flag} ${l.nativeLabel}` : code;
}

export interface GeneralRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  view?: GeneralView;
  notice?: PanelNotice;
  /** Fournisseur de traduction (défaut : déduit des variables d'environnement) */
  provider?: ProviderDescription;
}

/** Fournisseur de traduction actif, sans jamais lever (variables d'environnement absentes en test). */
function currentProvider(): ProviderDescription {
  return describeProvider({ DEEPL_API_KEY: process.env.DEEPL_API_KEY, GOOGLE_TRANSLATE_API_KEY: process.env.GOOGLE_TRANSLATE_API_KEY, MYMEMORY_EMAIL: process.env.MYMEMORY_EMAIL });
}

/** Valeur du champ « Traduction automatique » : état · mise en page · fournisseur. */
export function autoTranslateSummary(config: ResolvedGuildConfig, t: Translator, provider: ProviderDescription = currentProvider()): string {
  const at = config.autoTranslate ?? DEFAULT_AUTO_TRANSLATE;
  const state = at.enabled ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`;
  return `${state} · ${t(`panels_core.general.translate_layout_${at.layout}`)}\n-# ${t('panels_core.general.translate_provider', { provider: provider.label })}`;
}

export function renderGeneral(opts: GeneralRenderOptions): PanelPayload {
  switch (opts.view ?? 'main') {
    case 'modules':
      return renderModules(opts);
    case 'color':
      return renderColor(opts);
    default:
      return renderMain(opts);
  }
}

function renderMain({ guild, config, t, notice, provider }: GeneralRenderOptions): PanelPayload {
  const translate = config.autoTranslate ?? DEFAULT_AUTO_TRANSLATE;
  const none = t('panels_core.common.none_set');
  const active = MODULE_KEYS.filter((k) => config.modules[k]);
  const logCount = Object.keys(config.logChannels).length;

  const embed = embedService
    .brand(t('panels_core.general.title', { server: guild.name }))
    .setColor(config.brandColor)
    .setDescription(withNotice(notice, t('panels_core.general.hint')))
    .addFields(
      { name: t('panels_core.general.field_kind'), value: t(`panels_core.kinds.${config.kind}`), inline: true },
      { name: t('panels_core.general.field_language'), value: languageLabel(config.defaultLanguage), inline: true },
      { name: t('panels_core.general.field_color'), value: `\`${hexOf(config.brandColor)}\``, inline: true },
      { name: t('panels_core.general.field_admins'), value: truncate(roleList(config.adminRoleIds, none), 1024), inline: true },
      { name: t('panels_core.general.field_staff'), value: truncate(roleList(config.staffRoleIds, none), 1024), inline: true },
      { name: t('panels_core.general.field_logs'), value: t('panels_core.general.logs_value', { count: logCount, total: LOG_CATEGORY_COUNT }), inline: true },
      { name: t('panels_core.general.field_modules', { count: active.length, total: MODULE_KEYS.length }), value: truncate(active.map((k) => moduleLabel(k, t)).join(' · ') || none, 1024) },
      { name: t('panels_core.general.field_footer'), value: config.footerText ? truncate(config.footerText, 200) : t('panels_core.general.footer_default') },
      { name: `🇬🇧 ${t('panels_core.general.field_translate')}`, value: autoTranslateSummary(config, t, provider) },
    );

  const kind = new StringSelectMenuBuilder()
    .setCustomId(gid('kind'))
    .setPlaceholder(t('panels_core.general.kind_placeholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(GUILD_KINDS.map((k) => option(t(`panels_core.kinds.${k}`), k, { default: k === config.kind })));
  const lang = new StringSelectMenuBuilder()
    .setCustomId(gid('lang'))
    .setPlaceholder(t('panels_core.general.language_placeholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(LANGUAGES.map((l) => option(l.nativeLabel, l.code, { emoji: l.flag, default: l.code === config.defaultLanguage })));
  const admins = new RoleSelectMenuBuilder().setCustomId(gid('admins')).setPlaceholder(t('panels_core.general.admins_placeholder')).setMinValues(0).setMaxValues(MAX_PANEL_ROLES);
  const adminDefaults = existingRoles(guild, config.adminRoleIds, MAX_PANEL_ROLES);
  if (adminDefaults.length) admins.setDefaultRoles(adminDefaults);
  const staff = new RoleSelectMenuBuilder().setCustomId(gid('staff')).setPlaceholder(t('panels_core.general.staff_placeholder')).setMinValues(0).setMaxValues(MAX_PANEL_ROLES);
  const staffDefaults = existingRoles(guild, config.staffRoleIds, MAX_PANEL_ROLES);
  if (staffDefaults.length) staff.setDefaultRoles(staffDefaults);

  return {
    embeds: [embed],
    components: [
      row(kind),
      row(lang),
      row(admins),
      row(staff),
      row(
        btn(gid('view', 'modules'), t('panels_core.general.btn_modules'), ButtonStyle.Primary, '🧩'),
        btn(gid('view', 'color'), t('panels_core.general.btn_color'), ButtonStyle.Secondary, '🎨'),
        btn(gid('footer'), t('panels_core.general.btn_footer'), ButtonStyle.Secondary, '📝'),
        btn(gid('autotr'), t('panels_core.general.btn_translate'), translate.enabled ? ButtonStyle.Success : ButtonStyle.Secondary, '🇬🇧'),
        btn(gid('trlayout'), t('panels_core.general.btn_translate_layout', { layout: t(`panels_core.general.translate_layout_${translate.layout}`) }), ButtonStyle.Secondary, translate.layout === 'embed' ? '🧾' : '💬'),
      ),
    ],
  };
}

function renderModules({ guild, config, t, notice }: GeneralRenderOptions): PanelPayload {
  const lines = MODULE_KEYS.map((k) => `${config.modules[k] ? '🟢' : '🔴'} ${moduleLabel(k, t)}`);
  const half = Math.ceil(lines.length / 2);
  const embed = embedService
    .brand(t('panels_core.general.modules_title', { server: guild.name }))
    .setColor(config.brandColor)
    .setDescription(withNotice(notice, t('panels_core.general.modules_hint')))
    .addFields({ name: '​', value: lines.slice(0, half).join('\n'), inline: true }, { name: '​', value: lines.slice(half).join('\n') || '​', inline: true });

  const select = new StringSelectMenuBuilder()
    .setCustomId(gid('modules'))
    .setPlaceholder(t('panels_core.general.modules_placeholder'))
    .setMinValues(0)
    .setMaxValues(Math.min(25, MODULE_KEYS.length))
    .addOptions(MODULE_KEYS.slice(0, 25).map((k) => option(moduleLabel(k, t), k, { default: config.modules[k] })));

  return { embeds: [embed], components: [row(select), row(btn(gid('view', 'main'), t('core.back'), ButtonStyle.Secondary, '↩️'))] };
}

function renderColor({ guild, config, t, notice }: GeneralRenderOptions): PanelPayload {
  const current = hexOf(config.brandColor);
  const embed = embedService
    .brand(t('panels_core.general.color_title', { server: guild.name }))
    .setColor(config.brandColor)
    .setDescription(withNotice(notice, t('panels_core.general.color_hint')))
    .addFields({ name: t('panels_core.general.field_color'), value: `\`${current}\`` });

  const palette = new StringSelectMenuBuilder()
    .setCustomId(gid('palette'))
    .setPlaceholder(t('panels_core.general.color_placeholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(EMBED_COLOR_PALETTE.slice(0, 25).map((c) => option(t(`embeds.palette.${c.key}`), c.key, { description: c.hex, emoji: c.emoji, default: c.hex.toUpperCase() === current })));

  return {
    embeds: [embed],
    components: [row(palette), row(btn(gid('hex'), t('panels_core.general.btn_hex'), ButtonStyle.Primary, '✏️'), btn(gid('view', 'main'), t('core.back'), ButtonStyle.Secondary, '↩️'))],
  };
}

// ───── Modals ─────

export function buildHexModal(config: ResolvedGuildConfig, t: Translator) {
  return modal(gid('hex'), t('panels_core.general.modal_color_title'), labelled(t('panels_core.general.modal_color_label'), textInput('hex', TextInputStyle.Short, { value: hexOf(config.brandColor), placeholder: '#7C3AED', required: true, max: 7 }), t('panels_core.general.modal_color_help')));
}

export function buildFooterModal(config: ResolvedGuildConfig, t: Translator) {
  return modal(
    gid('footer'),
    t('panels_core.general.modal_footer_title'),
    labelled(t('panels_core.general.modal_footer_text'), textInput('text', TextInputStyle.Short, { value: config.footerText, max: 2048 }), t('panels_core.general.modal_footer_text_help')),
    labelled(t('panels_core.general.modal_footer_icon'), textInput('icon', TextInputStyle.Short, { value: config.footerIconUrl, placeholder: 'https://…', max: 2048 })),
  );
}
