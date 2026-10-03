import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, errorKey, hierarchyError, readReason, replyError, resolveMember, sanctionEmbed } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Retirer le rôle mute d’un membre')
    .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.roles,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    await interaction.deferReply(EPHEMERAL);
    const { user, member } = await resolveMember(interaction);
    if (!member) return replyError(interaction, ctx, 'core.member_not_found');
    const err = hierarchyError(interaction, member, 'manageable');
    if (err) return replyError(interaction, ctx, err);
    try {
      const result = await moderationService.unmute({ guild: interaction.guild, target: member, moderator: interaction.user, reason: readReason(interaction) });
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, user)] });
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
