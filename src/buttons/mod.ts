import { ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildMember, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { defineButton } from '../structures';
import { ModerationError, moderationService } from '../services/ModerationService';
import { embedService } from '../services/EmbedService';
import { buildCustomId } from '../utils/customId';
import { lockdownReasonKey, pendingLockdownReasons } from '../commands/moderation/_shared';
import { hasInternalPermission } from '../utils/permissions';
import { env } from '../config/env';

/**
 * Boutons du module modération (namespace `mod`) :
 *  - mod:cancel                       → ferme la confirmation
 *  - mod:nuke:<channelId>             → /clear salon : recrée le salon vide (admin)
 *  - mod:lockdown:<on|off>            → applique le lockdown (confirmation de /lockdown ; raison lue dans pendingLockdownReasons)
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
      case 'nuke': {
        const member = interaction.member instanceof GuildMember ? interaction.member : null;
        if (!hasInternalPermission({ member, config: ctx.config, ownerIds: env().OWNER_IDS, required: 'admin' })) {
          await interaction.reply({ embeds: [embedService.error(t('moderation.nuke_guild.admin_only'))], flags: MessageFlags.Ephemeral });
          return;
        }
        const channel = await interaction.guild.channels.fetch(a1 ?? '').catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isDMBased() || channel.isThread()) {
          await interaction.update({ embeds: [embedService.error(t('core.channel_not_found'))], components: [] });
          return;
        }
        await interaction.update({ embeds: [embedService.info(t('moderation.clear_channel.in_progress'))], components: [] });
        try {
          const result = await moderationService.nukeChannel({ channel, moderator: interaction.user });
          const done = embedService.success(t('moderation.clear_channel.done', { channel: `<#${result.channel.id}>`, number: result.sanction.caseNumber }));
          await interaction.editReply({ embeds: [done] }).catch(() => null);
          if ('send' in result.channel) await result.channel.send({ embeds: [embedService.info(t('moderation.clear_channel.notice', { moderator: `<@${interaction.user.id}>` }))] }).catch(() => null);
        } catch (err) {
          const k = err instanceof ModerationError ? err.key : 'core.error';
          await interaction.editReply({ embeds: [embedService.error(t(k))] }).catch(() => null);
        }
        return;
      }
      case 'lockdown': {
        const enable = a1 === 'on';
        const reasonKey = lockdownReasonKey(guildId, interaction.user.id);
        const reason = (a2 && a2.length ? a2 : null) ?? pendingLockdownReasons.get(reasonKey) ?? null;
        pendingLockdownReasons.delete(reasonKey);
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
