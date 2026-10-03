import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { EPHEMERAL, MOD_PERMS, errorKey, readReason, replyError } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouiller un salon (interdit d’écrire à @everyone)')
    .addChannelOption((o) => o.setName('channel').setDescription('Salon (défaut : salon courant)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.channels,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !('guild' in channel) || !channel.isTextBased() || channel.isThread()) return replyError(interaction, ctx, 'moderation.errors.channel_unsupported');
    await interaction.deferReply(EPHEMERAL);
    try {
      const sanction = await moderationService.lockChannel({ channel, moderator: interaction.user, reason: readReason(interaction) });
      await interaction.editReply({ embeds: [embedService.success(ctx.t('moderation.lock.locked', { channel: `<#${channel.id}>`, number: sanction.caseNumber }))] });
      if ('send' in channel) await channel.send({ embeds: [embedService.error(ctx.t('moderation.lock.notice', { reason: sanction.reason ?? ctx.t('core.no_reason') }), ctx.t('moderation.lock.notice_title'))] }).catch(() => null);
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
