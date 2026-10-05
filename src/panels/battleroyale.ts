import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { BR_KINDS, renderMain } from './_battleroyale';

/** ⚔️ Battle Royale : saisons, Battle Pass (paliers), outils admin (stats, XP, liaison de licence). */
export default defineConfigPanel({
  key: 'battleroyale',
  label: 'Battle Royale',
  emoji: '⚔️',
  order: 9,
  module: 'battleRoyale',
  guildKinds: BR_KINDS,
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return;
    const payload = await renderMain({ guild: interaction.guild, config: ctx.config, t: ctx.t });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
