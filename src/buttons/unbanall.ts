import { MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { embedService } from '../services/EmbedService';
import { massUnbanService } from '../services/MassUnbanService';
import { buildUnbanAllModal, pendingUnbanAll, pendingUnbanAllKey, renderUnbanAllStatus, watchUnbanAll } from '../commands/moderation/_unbanAll';

/**
 * Boutons de `/unban-all` (namespace `unbanall`, rattachés à la commande `unban-all` : ses permissions par rôle s'appliquent) :
 *  - `unbanall:confirm:<1|0>` → modal de confirmation (taper `UNBAN ALL`)
 *  - `unbanall:abort`         → abandon avant lancement
 *  - `unbanall:cancel`        → arrête le job en cours
 *  - `unbanall:status`        → actualise la progression et suit ce message
 */
export default defineButton({
  id: 'unbanall',
  module: 'moderation',
  command: 'unban-all',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    const guild = interaction.guild;
    if (!guild) return;
    const [action = '', flag] = args;
    switch (action) {
      case 'confirm':
        return interaction.showModal(buildUnbanAllModal(t, flag !== '0'));
      case 'abort':
        pendingUnbanAll.delete(pendingUnbanAllKey(guild.id, interaction.user.id));
        return interaction.update({ embeds: [embedService.info(t('moderation.unban_all.aborted'))], components: [] });
      case 'cancel':
      case 'status': {
        const cancelling = action === 'cancel' && massUnbanService.cancel(guild.id);
        const job = massUnbanService.status(guild.id);
        if (!job) return interaction.update({ embeds: [embedService.info(t('moderation.unban_all.none'))], components: [] });
        await interaction.update(renderUnbanAllStatus(ctx, job, { cancelling }));
        if (!job.finishedAt) watchUnbanAll(guild.id, interaction.id, (payload) => interaction.editReply(payload));
        return;
      }
      default:
        return interaction.reply({ embeds: [embedService.error(t('core.not_found'))], flags: MessageFlags.Ephemeral });
    }
  },
});
