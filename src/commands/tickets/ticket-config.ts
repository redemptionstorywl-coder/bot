import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { renderMain } from './_configPanel';

/**
 * /ticket-config — ouvre le panneau interactif éphémère de configuration des tickets :
 * raisons (types), catégorie, archive, accès (rôles), questions, message d'accueil, publication du panneau.
 * Toutes les actions passent ensuite par le namespace `tcfg` (boutons / menus / modals, admin uniquement).
 */
export default defineCommand({
  data: new SlashCommandBuilder().setName('ticket-config').setDescription('Configurer les tickets (panneau interactif : raisons, catégories, accès, questions, panneau)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  module: 'tickets',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.Administrator] },
  cooldown: 2,
  async execute(interaction, { t, config }) {
    if (!interaction.inCachedGuild() || !config) return;
    const payload = await renderMain({ guild: interaction.guild, t });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
