import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, errorKey, hierarchyError, readReason, replyError, resolveMember, sanctionEmbed } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Lever l’exclusion temporaire d’un membre')
    .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.timeout,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    await interaction.deferReply(EPHEMERAL);
    const { user, member } = await resolveMember(interaction);
    if (!member) return replyError(interaction, ctx, 'core.member_not_found');
    if (!member.isCommunicationDisabled()) return replyError(interaction, ctx, 'moderation.errors.not_timed_out');
    const err = hierarchyError(interaction, member, 'moderatable');
    if (err) return replyError(interaction, ctx, err);
    try {
      const result = await moderationService.untimeout({ guild: interaction.guild, target: member, moderator: interaction.user, reason: readReason(interaction) });
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, user)] });
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
