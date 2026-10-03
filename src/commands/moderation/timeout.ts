import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, errorKey, hierarchyError, readDuration, readReason, replyError, resolveMember, sanctionEmbed } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Exclure temporairement un membre (timeout Discord, max 28 jours)')
    .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Durée (ex: 10m, 1h, 2d — max 28d)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.timeout,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const duration = readDuration(interaction, 'duration', true);
    if (duration === 'invalid' || duration === null || duration > 28 * 86400) return replyError(interaction, ctx, 'moderation.errors.invalid_timeout_duration');
    await interaction.deferReply(EPHEMERAL);
    const { user, member } = await resolveMember(interaction);
    if (!member) return replyError(interaction, ctx, 'core.member_not_found');
    const err = hierarchyError(interaction, member, 'moderatable');
    if (err) return replyError(interaction, ctx, err);
    try {
      const result = await moderationService.timeout({ guild: interaction.guild, target: member, moderator: interaction.user, reason: readReason(interaction), duration });
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, user)] });
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
