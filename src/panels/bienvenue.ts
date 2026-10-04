import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { embedService } from '../services/EmbedService';
import { renderPanel } from '../commands/roles/_welcomeShared';

/** 👋 Bienvenue & départ : panneau à onglets (namespace `welcome:cfg`, src/buttons|selectMenus|modals/welcome.ts). */
export default defineConfigPanel({
  key: 'bienvenue',
  label: 'Bienvenue & départ',
  emoji: '👋',
  order: 3,
  module: 'welcome',
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    const payload = await renderPanel({ guild: interaction.guild, tab: 'welcome', t: ctx.t, lang: ctx.lang });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
