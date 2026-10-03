import { MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { languageService } from '../services/LanguageService';
import { guildConfigService } from '../services/GuildConfigService';
import { embedService } from '../services/EmbedService';

/**
 * Boutons du message de bienvenue :
 *  - `welcome:lang:<guildId>` → « 🌍 Choisir ma langue » : ouvre le select de langue en éphémère (fonctionne aussi en DM).
 * Les autres boutons configurés par le staff utilisent leur propre namespace (ex. `rolemenu:toggle:<roleId>`) ou sont des liens.
 */
export default defineButton({
  id: 'welcome',
  module: 'welcome',
  cooldown: 2,
  async execute(interaction, args, ctx) {
    const [action, guildIdHint] = args;
    if (action === 'lang') {
      const guild = interaction.guild ?? languageService.resolveGuild(guildIdHint);
      const config = guild ? await guildConfigService.get(guild.id) : null;
      if (!guild || !config) {
        await interaction.reply({ embeds: [embedService.error(ctx.t('language.guild_unavailable'))], flags: MessageFlags.Ephemeral });
        return;
      }
      if (!config.modules.language) {
        await interaction.reply({ embeds: [embedService.error(ctx.t('language.module_disabled'))], flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({
        content: ctx.t('language.select.prompt'),
        components: [languageService.buildSelectRow(config, ctx.t, interaction.guild ? undefined : guild.id)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({ embeds: [embedService.error(ctx.t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
  },
});
