import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { WL_KINDS, renderWhitelist } from './_whitelist';

/** 📝 Whitelist : ouverture, questions, salon de review, rôles accepté / en attente, DM des décisions. */
export default defineConfigPanel({
  key: 'whitelist',
  label: 'Whitelist',
  emoji: '📝',
  order: 9,
  module: 'whitelist',
  guildKinds: WL_KINDS,
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return;
    const payload = await renderWhitelist({ guild: interaction.guild, config: ctx.config, t: ctx.t, lang: ctx.lang });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
