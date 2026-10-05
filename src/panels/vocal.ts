import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { embedService } from '../services/EmbedService';
import { renderVocal } from './_vocal';

/** 🔊 Salons vocaux temporaires : lobbies « Créer un salon », catégorie, limite, règles de langue (rôle → drapeau + nom). */
export default defineConfigPanel({
  key: 'vocal',
  label: 'Salons vocaux',
  emoji: '🔊',
  order: 13,
  module: 'vocal',
  async open(interaction, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    const payload = await renderVocal({ guild: interaction.guild, config: ctx.config, t: ctx.t, member: interaction.member });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
