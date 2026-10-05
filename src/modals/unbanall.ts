import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { defineModal } from '../structures';
import { embedService } from '../services/EmbedService';
import { isUnbanAllConfirmed, massUnbanService, type MassUnbanJob } from '../services/MassUnbanService';
import { ModerationError } from '../services/ModerationService';
import { pendingUnbanAll, pendingUnbanAllKey, renderUnbanAllStatus, runningUnbanAll, unbanAllProgress, watchUnbanAll } from '../commands/moderation/_unbanAll';

/**
 * Modal de `/unban-all` (namespace `unbanall`, rattaché à la commande `unban-all`) :
 *  - `unbanall:run:<1|0>` → champ `confirm` = `UNBAN ALL` exactement ; lance le job (1 = relayer en jeu) et suit le message.
 */
export default defineModal({
  id: 'unbanall',
  module: 'moderation',
  command: 'unban-all',
  permissions: { internal: 'admin', bot: [PermissionFlagsBits.BanMembers] },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    const guild = interaction.guild;
    if (!guild) return;
    const [action = '', flag] = args;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    if (action !== 'run') return interaction.reply({ embeds: [embedService.error(t('core.not_found'))], ...ephemeral });
    if (!isUnbanAllConfirmed(interaction.fields.getTextInputValue('confirm'))) {
      return interaction.reply({ embeds: [embedService.error(t('moderation.unban_all.mismatch'))], ...ephemeral });
    }
    if (runningUnbanAll(guild.id)) return interaction.reply({ embeds: [embedService.error(t('moderation.unban_all.already_running'))], ...ephemeral });
    const key = pendingUnbanAllKey(guild.id, interaction.user.id);
    const pending = pendingUnbanAll.get(key);
    pendingUnbanAll.delete(key);
    let job: MassUnbanJob;
    try {
      job = massUnbanService.start(guild, interaction.user, { reason: pending?.reason ?? null, syncGame: pending?.syncGame ?? flag !== '0', onProgress: unbanAllProgress(interaction.client, ctx, guild.name) });
    } catch (err) {
      return interaction.reply({ embeds: [embedService.error(t(err instanceof ModerationError ? err.key : 'core.error'))], ...ephemeral });
    }
    const payload = renderUnbanAllStatus(ctx, job);
    if (interaction.isFromMessage()) await interaction.update(payload);
    else await interaction.reply({ ...payload, ...ephemeral });
    watchUnbanAll(guild.id, interaction.id, (p) => interaction.editReply(p));
    // Job déjà terminé avant que le message soit suivi (très petite liste) : on affiche le rapport.
    const latest = massUnbanService.status(guild.id);
    if (latest?.finishedAt) await interaction.editReply(renderUnbanAllStatus(ctx, latest)).catch(() => null);
  },
});
