import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { languageService } from '../../services/LanguageService';
import { LANGUAGES } from '../../config/constants';

/** /language — changer sa langue (select éphémère, ou directement avec l'option `code`). */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Choisir votre langue sur ce serveur / Choose your language')
    .addStringOption((o) =>
      o
        .setName('code')
        .setDescription('Langue (sinon un menu s’affiche)')
        .addChoices(...LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }))),
    ),
  module: 'language',
  permissions: { internal: 'everyone' },
  cooldown: 3,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const code = interaction.options.getString('code');
    if (code) {
      await languageService.respondToChoice(interaction, code);
      return;
    }
    await interaction.reply({ content: t('language.select.prompt'), components: [languageService.buildSelectRow(config, t)], flags: MessageFlags.Ephemeral });
  },
});
