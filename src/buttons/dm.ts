import { defineButton } from '../structures';
import { dmService } from '../services/DmService';
import { embedService } from '../services/EmbedService';
import { pendingMassDm, progressEmbed } from '../commands/admin/dm';

/** Boutons de confirmation de /dm all : `dm:confirm` | `dm:abort` */
export default defineButton({
  id: 'dm',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guild) return;
    const [action] = args;
    const key = `${interaction.guild.id}:${interaction.user.id}`;
    const pending = pendingMassDm.get(key);
    if (action === 'abort' || !pending) {
      pendingMassDm.delete(key);
      await interaction.update({ content: undefined, embeds: [embedService.info(t(pending ? 'dm.all.aborted' : 'dm.errors.expired'))], components: [] });
      return;
    }
    if (dmService.getActiveJob(interaction.guild.id)) {
      await interaction.update({ content: undefined, embeds: [embedService.warning(t('dm.errors.mass_dm_running'))], components: [] });
      return;
    }
    pendingMassDm.delete(key);
    await interaction.deferUpdate();
    const targets = await dmService.resolveTargets(interaction.guild, pending.roleId);
    const job = dmService.startMassDm(interaction.guild, interaction.user, pending.content, targets, pending.roleId, async (j) => {
      await interaction.editReply({ content: undefined, embeds: [progressEmbed(j, t)], components: [] }).catch(() => null);
    });
    await interaction.editReply({ content: undefined, embeds: [progressEmbed(job, t)], components: [] });
  },
});
