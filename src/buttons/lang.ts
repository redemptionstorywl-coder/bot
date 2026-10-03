import { MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { languageService } from '../services/LanguageService';
import { guildConfigService } from '../services/GuildConfigService';
import { embedService } from '../services/EmbedService';

/**
 * Boutons du module langue :
 *  - `lang:set:<code>[:guildId]`  → applique la langue (panneau drapeaux)
 *  - `lang:open[:guildId]`        → ouvre le select de langue en éphémère
 */
export default defineButton({
  id: 'lang',
  module: 'language',
  cooldown: 2,
  async execute(interaction, args, ctx) {
    const [action, a, b] = args;
    if (action === 'set' && a) {
      await languageService.respondToChoice(interaction, a, b);
      return;
    }
    if (action === 'open') {
      const guild = interaction.guild ?? languageService.resolveGuild(a);
      const config = guild ? await guildConfigService.get(guild.id) : null;
      if (!guild || !config) {
        await interaction.reply({ embeds: [embedService.error(ctx.t('language.guild_unavailable'))], flags: MessageFlags.Ephemeral });
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
