import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { SCHOOL_KINDS, renderSchool } from './_school';

/** 🎓 School RP : salons, rôles élève / prof / staff, classes, maisons, clubs. */
export default defineConfigPanel({
  key: 'school',
  label: 'School RP',
  emoji: '🎓',
  order: 11,
  module: 'school',
  guildKinds: SCHOOL_KINDS,
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return;
    const payload = await renderSchool('config', { guild: interaction.guild, config: ctx.config, t: ctx.t });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
