import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { formatDuration } from '../../utils/time';
import { EPHEMERAL, MOD_PERMS, errorKey, readReason, replyError } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Définir le mode lent d’un salon')
    .addIntegerOption((o) => o.setName('seconds').setDescription('Secondes entre deux messages (0 = désactivé, max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption((o) => o.setName('channel').setDescription('Salon (défaut : salon courant)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildVoice))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.channels,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const seconds = interaction.options.getInteger('seconds', true);
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !('guild' in channel) || !channel.isTextBased()) return replyError(interaction, ctx, 'core.channel_not_found');
    await interaction.deferReply(EPHEMERAL);
    try {
      const sanction = await moderationService.slowmode({ channel, moderator: interaction.user, seconds, reason: readReason(interaction) });
      const key = seconds ? 'moderation.slowmode.set' : 'moderation.slowmode.disabled';
      await interaction.editReply({ embeds: [embedService.success(ctx.t(key, { channel: `<#${channel.id}>`, duration: formatDuration(seconds, ctx.lang), number: sanction.caseNumber }))] });
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
