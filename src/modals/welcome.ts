import { MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import { Prisma } from '@prisma/client';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { welcomeService, setLocalized, type Localized } from '../services/WelcomeService';
import { embedService, type EmbedSpec } from '../services/EmbedService';
import { getLanguage } from '../config/constants';
import { optionalText } from '../services/EmbedBuilderSession';
import { checkPanelAccess, isHttpUrl, isWelcomeTab, parseButtonLines, renderPanel, resolveForEdit, type PanelNotice, type WelcomeTab } from '../commands/roles/_welcomeShared';

/**
 * Modals du panneau `/welcome-config` (admin) : `welcome:cfg:<kind>:<tab>`
 *  - message : texte multilingue (champ `language` optionnel → version par langue, vide → toutes)
 *  - embed   : titre / description / couleur / image / vignette → EmbedSpec validé (tout vide = pas d'embed)
 *  - image   : fond (URL) + titre / sous-titre (bienvenue)
 *  - dm      : texte DM (+ langue) + embed DM simple
 *  - buttons : boutons liens « Libellé | url | emoji », un par ligne
 */
export default defineModal({
  id: 'welcome',
  module: 'welcome',
  async execute(interaction, args, ctx) {
    const { t, config } = ctx;
    const [kind, action, tabArg] = args;
    const tab: WelcomeTab = isWelcomeTab(tabArg) ? tabArg : 'welcome';
    const denied = checkPanelAccess(interaction, ctx, tab);
    if (denied) {
      await interaction.reply({ embeds: [embedService.error(t(denied.key, denied.vars))], flags: MessageFlags.Ephemeral });
      return;
    }
    if (kind !== 'cfg' || !action) {
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const fallbackLang = config!.defaultLanguage;
    const field = (id: string): string | undefined => optionalText(getField(interaction, id));
    const target = t(`welcome.config.target_${tab}`);
    let notice: PanelNotice;

    switch (action) {
      case 'message': {
        const lang = parseLanguage(field('language'));
        if (lang === false) {
          notice = { type: 'error', text: t('welcome.config.invalid_language', { details: field('language') ?? '' }) };
          break;
        }
        const value = field('value') ?? null;
        const current = tab === 'welcome' ? await welcomeService.getConfig(guildId) : await welcomeService.getLeaveConfig(guildId);
        const next = setLocalized(current?.message as Localized<string> | null, value, lang, fallbackLang);
        const data = { message: next === null ? Prisma.JsonNull : (next as Prisma.InputJsonValue) };
        if (tab === 'welcome') await welcomeService.updateConfig(guildId, data);
        else await welcomeService.updateLeaveConfig(guildId, data);
        notice = valueNotice(t, value === null, t('welcome.config.kind_message'), target, lang);
        break;
      }
      case 'embed': {
        const current = tab === 'welcome' ? await welcomeService.getConfig(guildId) : await welcomeService.getLeaveConfig(guildId);
        const base = (resolveForEdit<unknown>(current?.embed as Localized<unknown> | null, null, fallbackLang) ?? {}) as Record<string, unknown>;
        const built = buildSpec(base, { title: field('title'), description: field('description'), color: field('color'), image: field('image'), thumbnail: field('thumbnail') });
        if (!built.ok) {
          notice = { type: 'error', text: t('welcome.config.invalid_embed', { details: built.error }) };
          break;
        }
        const data = { embed: built.spec === null ? Prisma.JsonNull : (built.spec as Prisma.InputJsonValue) };
        if (tab === 'welcome') await welcomeService.updateConfig(guildId, data);
        else await welcomeService.updateLeaveConfig(guildId, data);
        notice = valueNotice(t, built.spec === null, t('welcome.config.kind_embed'), target, null);
        break;
      }
      case 'image': {
        const background = field('background') ?? null;
        if (background && !isHttpUrl(background)) {
          notice = { type: 'error', text: t('welcome.config.invalid_url', { details: background }) };
          break;
        }
        if (tab === 'welcome') {
          const title = field('title');
          const subtitle = field('subtitle');
          await welcomeService.updateConfig(guildId, { imageBackgroundUrl: background, ...(title ? { imageTitle: title } : {}), ...(subtitle ? { imageSubtitle: subtitle } : {}) });
        } else {
          await welcomeService.updateLeaveConfig(guildId, { imageBackgroundUrl: background });
        }
        notice = { type: 'success', text: t('welcome.config.image_saved') };
        break;
      }
      case 'dm': {
        const lang = parseLanguage(field('language'));
        if (lang === false) {
          notice = { type: 'error', text: t('welcome.config.invalid_language', { details: field('language') ?? '' }) };
          break;
        }
        const current = await welcomeService.getConfig(guildId);
        const message = field('value') ?? null;
        const base = (resolveForEdit<unknown>(current?.dmEmbed as Localized<unknown> | null, lang, fallbackLang) ?? {}) as Record<string, unknown>;
        const built = buildSpec(base, { title: field('title'), description: field('description'), color: field('color') });
        if (!built.ok) {
          notice = { type: 'error', text: t('welcome.config.invalid_embed', { details: built.error }) };
          break;
        }
        const nextMessage = setLocalized(current?.dmMessage as Localized<string> | null, message, lang, fallbackLang);
        const nextEmbed = setLocalized(current?.dmEmbed as Localized<unknown> | null, built.spec, lang, fallbackLang);
        await welcomeService.updateConfig(guildId, {
          dmMessage: nextMessage === null ? Prisma.JsonNull : (nextMessage as Prisma.InputJsonValue),
          dmEmbed: nextEmbed === null ? Prisma.JsonNull : (nextEmbed as Prisma.InputJsonValue),
        });
        notice = valueNotice(t, message === null && built.spec === null, t('welcome.config.kind_message'), t('welcome.config.target_dm'), lang);
        break;
      }
      case 'buttons': {
        const raw = field('value');
        if (!raw) {
          await welcomeService.updateConfig(guildId, { buttons: [] });
          notice = { type: 'success', text: t('welcome.config.buttons_cleared') };
          break;
        }
        const parsed = parseButtonLines(raw);
        if (!parsed.ok) {
          notice = { type: 'error', text: t('welcome.config.invalid_buttons', { details: parsed.error }) };
          break;
        }
        await welcomeService.updateConfig(guildId, { buttons: parsed.buttons as Prisma.InputJsonValue });
        notice = { type: 'success', text: t('welcome.config.buttons_set', { count: parsed.buttons.length }) };
        break;
      }
      default:
        await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action }))], flags: MessageFlags.Ephemeral });
        return;
    }

    await respond(interaction, tab, ctx, notice);
  },
});

function getField(interaction: ModalSubmitInteraction, id: string): string | undefined {
  try {
    return interaction.fields.getTextInputValue(id);
  } catch {
    return undefined;
  }
}

/** Code langue saisi : `null` si vide (toutes les langues), `false` si inconnu. */
function parseLanguage(raw: string | undefined): string | null | false {
  if (!raw) return null;
  const code = raw.toLowerCase();
  return getLanguage(code) ? code : false;
}

/**
 * Fusionne les champs saisis dans l'EmbedSpec existant (les clés non éditables — footer, fields… — sont conservées).
 * Tous les champs vides → `null` (pas d'embed).
 */
function buildSpec(base: Record<string, unknown>, fields: Record<string, string | undefined>): { ok: true; spec: EmbedSpec | null } | { ok: false; error: string } {
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(fields)) {
    if (v) merged[k] = k === 'color' ? normalizeHex(v) : v;
    else delete merged[k];
  }
  if (Object.values(fields).every((v) => !v)) return { ok: true, spec: null };
  const result = embedService.safeValidate(merged);
  if (!result.success) return { ok: false, error: result.error.slice(0, 500) };
  return { ok: true, spec: result.data };
}

function normalizeHex(v: string): string {
  const hex = v.trim().replace(/^#?/, '#').toUpperCase();
  return hex;
}

function valueNotice(t: InteractionContext['t'], cleared: boolean, kind: string, what: string, lang: string | null): PanelNotice {
  if (cleared) return { type: 'success', text: t('welcome.config.value_cleared', { what, kind }) };
  const language = lang ? `${getLanguage(lang)!.flag} ${getLanguage(lang)!.nativeLabel}` : t('welcome.config.all_languages');
  return { type: 'success', text: t('welcome.config.value_set', { what, kind, language }) };
}

async function respond(interaction: ModalSubmitInteraction, tab: WelcomeTab, ctx: InteractionContext, notice: PanelNotice): Promise<void> {
  const payload = await renderPanel({ guild: interaction.guild!, tab, t: ctx.t, lang: ctx.lang, fallbackLang: ctx.config!.defaultLanguage, notice });
  if (interaction.isFromMessage()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
