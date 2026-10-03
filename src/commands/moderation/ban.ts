import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, errorKey, hierarchyError, readReason, replyError, resolveMember, sanctionEmbed } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir définitivement un utilisateur')
    .addUserOption((o) => o.setName('user').setDescription('Utilisateur').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Supprimer les messages des N derniers jours (0-7)').setMinValue(0).setMaxValue(7)),
  module: 'moderation',
  permissions: MOD_PERMS.ban,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    await interaction.deferReply(EPHEMERAL);
    const { user, member } = await resolveMember(interaction);
    if (member) {
      const err = hierarchyError(interaction, member, 'bannable');
      if (err) return replyError(interaction, ctx, err);
    } else if (user.id === interaction.user.id) return replyError(interaction, ctx, 'moderation.errors.self');
    const reason = readReason(interaction);
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
    try {
      const result = await moderationService.ban({ guild: interaction.guild, target: user, moderator: interaction.user, reason, deleteMessageSeconds: deleteDays * 86400 });
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, user)] });
    } catch (err) {
      const e = errorKey(err);
      await replyError(interaction, ctx, e.key, e.vars);
    }
  },
});
