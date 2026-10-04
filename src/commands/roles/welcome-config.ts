import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { renderPanel } from './_welcomeShared';

/**
 * /welcome-config — ouvre le panneau interactif éphémère de configuration bienvenue / départ.
 * Tout se configure ensuite par boutons, menu salon et modals (namespace `welcome:cfg:*`).
 */
export default defineCommand({
  data: new SlashCommandBuilder().setName('welcome-config').setDescription('Configurer les messages de bienvenue et de départ (panneau interactif)').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  module: 'welcome',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageGuild] },
  cooldown: 2,
  async execute(interaction, { t, lang, config }) {
    if (!interaction.guild || !config) return;
    const payload = await renderPanel({ guild: interaction.guild, tab: 'welcome', t, lang });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
