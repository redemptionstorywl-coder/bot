import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, errorKey, hierarchyError, readDuration, readReason, replyError, resolveMember, sanctionEmbed } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Rendre muet un membre via le rôle mute configuré (durée optionnelle)')
    .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Durée (ex: 1h, 2d) — vide = indéfini'))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.roles,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const duration = readDuration(interaction, 'duration');
    if (duration === 'invalid') return replyError(interaction, ctx, 'moderation.errors.invalid_duration');
    await interaction.deferReply(EPHEMERAL);
    const { user, member } = await resolveMember(interaction);
    if (!member) return replyError(interaction, ctx, 'core.member_not_found');
    const err = hierarchyError(interaction, member, 'manageable');
    if (err) return replyError(interaction, ctx, err);
    try {
      const result = await moderationService.mute({ guild: interaction.guild, target: member, moderator: interaction.user, reason: readReason(interaction), duration });
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, user)] });
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
