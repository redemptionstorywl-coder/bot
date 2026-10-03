import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { discordTimestamp } from '../../utils/time';
import { EPHEMERAL, MOD_PERMS, errorKey, readDuration, readReason, replyError } from './_shared';

/**
 * /mute-salon [duration] [channel] [reason] : verrouille le salon et programme le déverrouillage
 * automatique à l'expiration (tâche `moderation:channel-unmute`). Sans durée : équivalent à /lock.
 * /unlock lève aussi la sourdine programmée.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('mute-salon')
    .setDescription('Mettre un salon en sourdine pendant une durée (déverrouillage automatique)')
    .addStringOption((o) => o.setName('duration').setDescription('Durée (ex: 30m, 1h30m, 2d) — vide : jusqu’à /unlock').setMaxLength(32))
    .addChannelOption((o) => o.setName('channel').setDescription('Salon (défaut : salon courant)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.channels,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const { t } = ctx;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !('guild' in channel) || !channel.isTextBased() || channel.isThread()) return replyError(interaction, ctx, 'moderation.errors.channel_unsupported');
    const duration = readDuration(interaction, 'duration');
    if (duration === 'invalid') return replyError(interaction, ctx, 'moderation.errors.invalid_duration');
    await interaction.deferReply(EPHEMERAL);
    try {
      const reason = readReason(interaction);
      const { sanction, expiresAt } = await moderationService.muteChannel({ channel, moderator: interaction.user, reason, duration });
      const until = expiresAt ? discordTimestamp(expiresAt, 'R') : '';
      await interaction.editReply({ embeds: [embedService.success(expiresAt ? t('moderation.mute_channel.muted', { channel: `<#${channel.id}>`, until, number: sanction.caseNumber }) : t('moderation.mute_channel.muted_indefinite', { channel: `<#${channel.id}>`, number: sanction.caseNumber }))] });
      if ('send' in channel) {
        const text = expiresAt ? t('moderation.mute_channel.notice', { until, reason: reason ?? t('core.no_reason') }) : t('moderation.mute_channel.notice_indefinite', { reason: reason ?? t('core.no_reason') });
        await channel.send({ embeds: [embedService.error(text, t('moderation.mute_channel.notice_title'))] }).catch(() => null);
      }
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
