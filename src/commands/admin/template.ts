import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { openTemplateLogs } from './_templateLogs';

/**
 * `/template logs` — transforme ce serveur en serveur de logs central (hub) : choix des serveurs Discord à relier
 * (seuls ceux où l'on est administrateur ou propriétaire) et des serveurs de jeu, aperçu, création idempotente de la
 * structure (catégories / salons privés), sommaire épinglé. Relancer la commande affiche l'état, répare / complète,
 * ou retire une source. Interface : `_templateLogs.ts` (namespace `tpl`).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Modèles de serveur')
    .addSubcommand((s) => s.setName('logs').setDescription('Faire de ce serveur le serveur de logs central (tous vos serveurs + logs en jeu)')),
  permissions: { internal: 'admin', bot: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] },
  cooldown: 5,
  async execute(interaction, ctx) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub !== 'logs') return interaction.reply({ embeds: [embedService.error(ctx.t('core.not_found'))], flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await openTemplateLogs(interaction, ctx, guild);
  },
});
