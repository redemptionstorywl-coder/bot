import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, errorKey, readReason, replyError, sanctionEmbed } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Révoquer le bannissement d’un utilisateur')
    .addStringOption((o) => o.setName('user_id').setDescription('ID de l’utilisateur').setRequired(true).setMinLength(15).setMaxLength(22))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.ban,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const userId = interaction.options.getString('user_id', true).trim();
    if (!/^\d{15,22}$/.test(userId)) return replyError(interaction, ctx, 'core.invalid_input', { details: userId });
    await interaction.deferReply(EPHEMERAL);
    try {
      const result = await moderationService.unban({ guild: interaction.guild, userId, moderator: interaction.user, reason: readReason(interaction) });
      const target = await interaction.client.users.fetch(userId).catch(() => null);
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, target)] });
    } catch (err) {
      const e = errorKey(err);
      await replyError(interaction, ctx, e.key, e.vars);
    }
  },
});
