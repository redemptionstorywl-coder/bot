import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { renderMain } from './_fivem';

/** 🎮 FiveM : serveurs, statut, maintenance, synchronisation jeu ⇄ Discord, rôles, installation de rs_bridge. */
export default defineConfigPanel({
  key: 'fivem',
  label: 'FiveM',
  emoji: '🎮',
  order: 7,
  module: 'fivem',
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return;
    const payload = await renderMain({ guild: interaction.guild, config: ctx.config, t: ctx.t });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
