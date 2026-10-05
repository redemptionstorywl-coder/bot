import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { massUnbanService } from '../../services/MassUnbanService';
import { EPHEMERAL, errorKey, replyError } from './_shared';
import { pendingUnbanAll, pendingUnbanAllKey, renderUnbanAllConfirm, renderUnbanAllStatus, runningUnbanAll, watchUnbanAll } from './_unbanAll';

/**
 * /unban-all [raison] [inclure_jeu] — débannit TOUS les membres bannis du serveur.
 * Niveau par défaut : admin (rôles admin, 🛡️ RS Team, Administrateur), modifiable dans `/config module:permissions`.
 * Affiche le nombre de bannis puis demande de taper `UNBAN ALL` (modal `unbanall:run`) ; le job tourne en arrière-plan
 * (massUnbanService) avec progression, bouton Annuler et rapport final. Une seule case UNBAN récapitulative.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('unban-all')
    .setDescription('Débannir tous les membres bannis du serveur (confirmation requise)')
    .addStringOption((o) => o.setName('raison').setDescription('Raison (journal d’audit, logs et case)').setMaxLength(512))
    .addBooleanOption((o) => o.setName('inclure_jeu').setDescription('Relayer aussi les débannissements vers les serveurs FiveM (défaut : oui)')),
  module: 'moderation',
  permissions: { internal: 'admin', bot: [PermissionFlagsBits.BanMembers] },
  cooldown: 10,
  async execute(interaction, ctx) {
    const guild = interaction.guild;
    if (!guild) return;
    // Un job tourne déjà : on affiche sa progression (et ce message sera tenu à jour).
    const running = runningUnbanAll(guild.id);
    if (running) {
      await interaction.reply({ ...renderUnbanAllStatus(ctx, running), ...EPHEMERAL });
      watchUnbanAll(guild.id, interaction.id, (payload) => interaction.editReply(payload));
      return;
    }
    const reason = interaction.options.getString('raison')?.trim().slice(0, 512) || null;
    const syncGame = interaction.options.getBoolean('inclure_jeu') ?? true;
    await interaction.deferReply(EPHEMERAL);
    let count: number;
    try {
      count = await massUnbanService.count(guild);
    } catch (err) {
      const e = errorKey(err);
      return replyError(interaction, ctx, e.key, e.vars);
    }
    if (!count) {
      await interaction.editReply({ embeds: [embedService.info(ctx.t('moderation.unban_all.none'))] });
      return;
    }
    pendingUnbanAll.set(pendingUnbanAllKey(guild.id, interaction.user.id), { reason, syncGame });
    await interaction.editReply(renderUnbanAllConfirm(ctx, { count, reason, syncGame }));
  },
});
