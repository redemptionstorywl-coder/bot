import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { defineButton } from '../structures';
import { moderationService } from '../services/ModerationService';
import { embedService } from '../services/EmbedService';
import { buildCustomId } from '../utils/customId';

/**
 * Boutons du module modération (namespace `mod`) :
 *  - mod:cancel                       → ferme la confirmation
 *  - mod:lockdown:<on|off>:<reason>   → applique le lockdown (confirmation de /lockdown)
 *  - mod:clearwarns:<userId>          → demande confirmation
 *  - mod:clearwarns-confirm:<userId>  → retire tous les avertissements
 *  - mod:unwarn-open:<userId>         → ouvre le modal de retrait d'un avertissement
 */
export default defineButton({
  id: 'mod',
  module: 'moderation',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    const [action, a1, a2] = args;
    if (!interaction.guild) return;
    const guildId = interaction.guild.id;

    switch (action) {
      case 'cancel': {
        await interaction.update({ embeds: [embedService.info(t('moderation.buttons.cancelled'))], components: [] });
        return;
      }
      case 'lockdown': {
        const enable = a1 === 'on';
        const reason = a2 && a2.length ? a2 : null;
        await interaction.update({ embeds: [embedService.info(t('moderation.lockdown.in_progress'))], components: [] });
        try {
          const result = await moderationService.setLockdown(guildId, enable, interaction.user.id, reason);
          const embed = enable
            ? embedService.error(t('moderation.lockdown.enabled', { channels: result.channels, failed: result.failed }), t('moderation.lockdown.alert_title'))
            : embedService.brand(t('moderation.lockdown.alert_end_title'), t('moderation.lockdown.disabled', { channels: result.channels, failed: result.failed }));
          if (!result.changed) embed.setDescription(t(enable ? 'moderation.lockdown.already_on' : 'moderation.lockdown.already_off'));
          await interaction.editReply({ embeds: [embed] });
        } catch {
          await interaction.editReply({ embeds: [embedService.error(t('moderation.errors.missing_permissions'))] });
        }
        return;
      }
      case 'clearwarns': {
        if (!a1) return;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(buildCustomId('mod', 'clearwarns-confirm', a1)).setLabel(t('core.confirm')).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(buildCustomId('mod', 'cancel')).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embedService.warning(t('moderation.warnings.clear_confirm', { user: `<@${a1}>` }))], components: [row] });
        return;
      }
      case 'clearwarns-confirm': {
        if (!a1) return;
        await interaction.deferUpdate();
        const { cleared, sanction } = await moderationService.clearWarnings(guildId, a1, interaction.user.id, null);
        const embed = cleared ? embedService.success(t('moderation.warnings.cleared', { count: cleared, user: `<@${a1}>`, number: sanction?.caseNumber ?? 0 })) : embedService.warning(t('moderation.warnings.empty'));
        await interaction.editReply({ embeds: [embed], components: [] });
        return;
      }
      case 'unwarn-open': {
        if (!a1) return;
        const modal = new ModalBuilder()
          .setCustomId(buildCustomId('mod', 'unwarn', a1))
          .setTitle(t('moderation.warnings.remove_modal_title').slice(0, 45))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('id').setLabel(t('moderation.warnings.modal_id_label').slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('reason').setLabel(t('core.reason').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(512)),
          );
        await interaction.showModal(modal);
        return;
      }
      default:
        await interaction.reply({ embeds: [embedService.error(t('core.not_found'))], flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },
});
