import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { embedService } from '../services/EmbedService';
import { openPanel } from './_coreKit';
import { renderGeneral } from './_general';

/** ⚙️ Général : type de serveur, langue, couleur, rôles admin / staff, modules, footer. */
export default defineConfigPanel({
  key: 'general',
  label: 'Général',
  emoji: '⚙️',
  order: 1,
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    await openPanel(interaction, renderGeneral({ guild: interaction.guild, config: ctx.config, t: ctx.t }));
  },
});
