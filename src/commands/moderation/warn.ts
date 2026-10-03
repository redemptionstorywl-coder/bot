import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, errorKey, escalationLines, hierarchyError, readReason, replyError, resolveMember, sanctionEmbed } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Avertir un membre')
    .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setRequired(true).setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.timeout,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    await interaction.deferReply(EPHEMERAL);
    const { user, member } = await resolveMember(interaction);
    if (!member) return replyError(interaction, ctx, 'core.member_not_found');
    if (user.bot) return replyError(interaction, ctx, 'moderation.errors.bot_target');
    const err = hierarchyError(interaction, member, 'manageable');
    if (err && err !== 'moderation.errors.bot_hierarchy') return replyError(interaction, ctx, err);
    try {
      const result = await moderationService.warn({ guild: interaction.guild, target: member, moderator: interaction.user, reason: readReason(interaction, true)! });
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, user, escalationLines(ctx, result))] });
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
