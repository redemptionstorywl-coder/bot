import { GuildMember, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { Prisma } from '@prisma/client';
import { defineModal } from '../structures';
import { welcomeService, setLocalized, type Localized } from '../services/WelcomeService';
import { embedService, buttonSpecSchema } from '../services/EmbedService';
import { getLanguage } from '../config/constants';
import { env } from '../config/env';
import { hasInternalPermission } from '../utils/permissions';
import { z } from 'zod';

/**
 * Modals de configuration bienvenue / départ (admin) :
 *  - `welcome:message:<target>[:lang]` → texte (multiligne) — target ∈ welcome | dm | leave
 *  - `welcome:embed:<target>[:lang]`   → EmbedSpec JSON
 *  - `welcome:buttons`                 → ButtonSpec[] JSON (message de bienvenue)
 */
export default defineModal({
  id: 'welcome',
  async execute(interaction, args, ctx) {
    const [action, target, langArg] = args;
    const { t, config } = ctx;
    if (!interaction.inGuild() || !config) {
      await interaction.reply({ embeds: [embedService.error(t('core.guild_only'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    if (!hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: 'admin' }) && !member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ embeds: [embedService.error(t('core.insufficient_level', { level: 'admin' }))], flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId;
    const lang = langArg && getLanguage(langArg) ? langArg : null;
    const raw = interaction.fields.getTextInputValue('value')?.trim() ?? '';
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;

    if (action === 'buttons') {
      if (!raw) {
        await welcomeService.updateConfig(guildId, { buttons: [] });
        await interaction.reply({ embeds: [embedService.success(t('welcome.config.buttons_cleared'))], ...ephemeral });
        return;
      }
      const parsed = parseJson(raw);
      const result = z.array(buttonSpecSchema).max(24).safeParse(parsed);
      if (!result.success) {
        await interaction.reply({ embeds: [embedService.error(t('welcome.config.invalid_json', { details: result.error.issues.map((i) => `${i.path.join('.') || 'button'}: ${i.message}`).join('\n').slice(0, 1000) }))], ...ephemeral });
        return;
      }
      await welcomeService.updateConfig(guildId, { buttons: result.data as Prisma.InputJsonValue });
      await interaction.reply({ embeds: [embedService.success(t('welcome.config.buttons_set', { count: result.data.length }))], ...ephemeral });
      return;
    }

    if ((action !== 'message' && action !== 'embed') || !target || !['welcome', 'dm', 'leave'].includes(target)) {
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], ...ephemeral });
      return;
    }

    let value: string | Record<string, unknown> | null = raw || null;
    if (action === 'embed' && raw) {
      const parsed = parseJson(raw);
      const result = embedService.safeValidate(parsed);
      if (!result.success) {
        await interaction.reply({ embeds: [embedService.error(t('welcome.config.invalid_json', { details: result.error.slice(0, 1000) }))], ...ephemeral });
        return;
      }
      value = result.data as Record<string, unknown>;
    }

    if (target === 'leave') {
      const current = await welcomeService.getLeaveConfig(guildId);
      const next = setLocalized(current?.[action] as Localized<unknown> | null, value, lang, config.defaultLanguage);
      await welcomeService.updateLeaveConfig(guildId, { [action]: next === null ? Prisma.JsonNull : (next as Prisma.InputJsonValue) });
    } else {
      const current = await welcomeService.getConfig(guildId);
      const key = target === 'dm' ? (action === 'message' ? 'dmMessage' : 'dmEmbed') : action;
      const next = setLocalized(current?.[key] as Localized<unknown> | null, value, lang, config.defaultLanguage);
      await welcomeService.updateConfig(guildId, { [key]: next === null ? Prisma.JsonNull : (next as Prisma.InputJsonValue) });
    }
    const what = t(`welcome.config.target_${target}`);
    const kind = t(action === 'message' ? 'welcome.config.kind_message' : 'welcome.config.kind_embed');
    await interaction.reply({ embeds: [embedService.success(value === null ? t('welcome.config.value_cleared', { what, kind }) : t('welcome.config.value_set', { what, kind, language: lang ? `${getLanguage(lang)!.flag} ${getLanguage(lang)!.nativeLabel}` : t('welcome.config.all_languages') }))], ...ephemeral });
  },
});

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
