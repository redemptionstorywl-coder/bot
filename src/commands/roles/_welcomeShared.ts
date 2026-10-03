import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction } from 'discord.js';
import { buildCustomId } from '../../utils/customId';
import { LANGUAGES, getLanguage } from '../../config/constants';
import { isLocalizedMap } from '../../services/WelcomeService';
import type { Translator } from '../../services/TranslationService';

export const languageChoices = LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }));

export type WelcomeTarget = 'welcome' | 'dm' | 'leave';

/** Ouvre un modal « texte » ou « JSON » pré-rempli pour message / embed (namespace `welcome`). */
export async function openValueModal(
  interaction: ChatInputCommandInteraction,
  t: Translator,
  opts: { action: 'message' | 'embed' | 'buttons'; target: WelcomeTarget; lang: string | null; current: unknown; fallbackLang: string },
): Promise<void> {
  const { action, target, lang, current } = opts;
  const value = resolveForEdit(current, lang, opts.fallbackLang);
  const text = action === 'message' ? (typeof value === 'string' ? value : '') : value !== undefined && value !== null ? JSON.stringify(value, null, 2) : '';
  const customId = action === 'buttons' ? buildCustomId('welcome', 'buttons') : lang ? buildCustomId('welcome', action, target, lang) : buildCustomId('welcome', action, target);
  const langLabel = lang ? `${getLanguage(lang)?.flag ?? ''} ${getLanguage(lang)?.nativeLabel ?? lang}` : t('welcome.config.all_languages');
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(t(`welcome.config.modal_title_${action}`, { target: t(`welcome.config.target_${target}`) }).slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t(`welcome.config.modal_label_${action}`, { language: langLabel }).slice(0, 45))
        .setDescription(t(`welcome.config.modal_help_${action}`).slice(0, 100))
        .setTextInputComponent(new TextInputBuilder().setCustomId('value').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setValue(text.slice(0, 4000))),
    );
  await interaction.showModal(modal);
}

/** Valeur à pré-remplir : la langue demandée, sinon la valeur unique / de secours. */
function resolveForEdit(current: unknown, lang: string | null, fallbackLang: string): unknown {
  if (current === null || current === undefined) return undefined;
  if (isLocalizedMap(current)) {
    const map = current as Record<string, unknown>;
    if (lang) return map[lang];
    return map[fallbackLang] ?? Object.values(map)[0];
  }
  return lang ? undefined : current;
}

/** Résumé d'une valeur multilingue pour l'affichage (`show`). */
export function summarizeLocalized(value: unknown, t: Translator): string {
  if (value === null || value === undefined) return '—';
  if (isLocalizedMap(value)) return Object.keys(value as Record<string, unknown>).map((k) => `${getLanguage(k)?.flag ?? ''} ${k}`).join(' · ');
  return t('welcome.config.all_languages');
}

export function onOff(v: boolean, t: Translator): string {
  return v ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`;
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
