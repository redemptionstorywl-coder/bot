import { MessageFlags } from 'discord.js';
import { defineModal } from '../structures';
import { moderationService } from '../services/ModerationService';
import { embedService } from '../services/EmbedService';

/**
 * Modals du module modération (namespace `mod`) :
 *  - mod:unwarn:<userId> → champs `id` (ID de l'avertissement) et `reason`
 */
export default defineModal({
  id: 'mod',
  module: 'moderation',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    const [action, userId] = args;
    if (!interaction.guild) return;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;

    if (action === 'unwarn') {
      const rawId = interaction.fields.getTextInputValue('id').trim();
      const reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
      const id = Number(rawId.replace(/^#/, ''));
      if (!Number.isInteger(id) || id <= 0) {
        await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: rawId }))], ...ephemeral });
        return;
      }
      await interaction.deferReply(ephemeral);
      const result = await moderationService.removeWarning(id, interaction.user.id, reason, interaction.guild.id);
      if (!result || (userId && result.warning.userId !== userId)) {
        await interaction.editReply({ embeds: [embedService.error(t('moderation.warnings.not_found', { id }))] });
        return;
      }
      await interaction.editReply({ embeds: [embedService.success(t('moderation.warnings.removed', { id, user: `<@${result.warning.userId}>`, number: result.sanction.caseNumber }))] });
      return;
    }
    await interaction.reply({ embeds: [embedService.error(t('core.not_found'))], ...ephemeral });
  },
});
