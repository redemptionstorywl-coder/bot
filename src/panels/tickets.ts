import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { embedService } from '../services/EmbedService';
import { renderMain } from '../commands/tickets/_configPanel';

/** 🎫 Tickets : raisons, catégories, accès, questions, publication, options (namespace `tcfg`, src/buttons|selectMenus|modals/tcfg.ts). */
export default defineConfigPanel({
  key: 'tickets',
  label: 'Tickets',
  emoji: '🎫',
  order: 4,
  module: 'tickets',
  async open(interaction, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    const payload = await renderMain({ guild: interaction.guild, t: ctx.t });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
