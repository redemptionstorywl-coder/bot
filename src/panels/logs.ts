import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { embedService } from '../services/EmbedService';
import { openPanel } from './_coreKit';
import { renderLogs } from './_logs';

/** 📜 Logs : un salon par catégorie, tout dans un salon, ou création d'un salon privé. */
export default defineConfigPanel({
  key: 'logs',
  label: 'Logs',
  emoji: '📜',
  order: 2,
  module: 'logs',
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    await openPanel(interaction, renderLogs({ guild: interaction.guild, config: ctx.config, t: ctx.t }));
  },
});
