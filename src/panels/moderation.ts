import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { embedService } from '../services/EmbedService';
import { openPanel } from './_coreKit';
import { loadModerationPanel } from './_moderation';

/** 🛡️ Modération : sanctions (seuils de warns, rôle mute, DM), anti-raid, anti-nuke, lockdown — un panneau à onglets. */
export default defineConfigPanel({
  key: 'moderation',
  label: 'Modération',
  emoji: '🛡️',
  order: 5,
  module: 'moderation',
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    await openPanel(interaction, await loadModerationPanel({ guild: interaction.guild, t: ctx.t, lang: ctx.lang, tab: 'sanctions' }));
  },
});
