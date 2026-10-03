import { MessageFlags } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { languageService } from '../services/LanguageService';
import { embedService } from '../services/EmbedService';

/** Select `lang:select[:guildId]` → applique la langue choisie. */
export default defineSelectMenu({
  id: 'lang',
  module: 'language',
  cooldown: 2,
  async execute(interaction, args, ctx) {
    const [action, guildIdHint] = args;
    if (action !== 'select' || !interaction.isStringSelectMenu()) {
      await interaction.reply({ embeds: [embedService.error(ctx.t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
      return;
    }
    const code = interaction.values[0];
    if (!code) return;
    await languageService.respondToChoice(interaction, code, guildIdHint);
  },
});
