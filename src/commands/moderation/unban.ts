import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { fivemSyncService } from '../../services/FiveMSyncService';
import { embedService } from '../../services/EmbedService';
import { EPHEMERAL, MOD_PERMS, errorKey, readReason, replyError, sanctionEmbed } from './_shared';
import { IN_GAME_DESCRIPTION, IN_GAME_OPTION, inGameLines, readInGame } from './_inGame';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Révoquer le bannissement d’un utilisateur')
    .addStringOption((o) => o.setName('user_id').setDescription('ID de l’utilisateur').setRequired(true).setMinLength(15).setMaxLength(22))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512))
    .addBooleanOption((o) => o.setName(IN_GAME_OPTION).setDescription(IN_GAME_DESCRIPTION)),
  module: 'moderation',
  permissions: MOD_PERMS.ban,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const userId = interaction.options.getString('user_id', true).trim();
    if (!/^\d{15,22}$/.test(userId)) return replyError(interaction, ctx, 'core.invalid_input', { details: userId });
    await interaction.deferReply(EPHEMERAL);
    const inGame = readInGame(interaction);
    fivemSyncService.prepareDiscordBan('unban', interaction.guild.id, userId, inGame);
    try {
      const result = await moderationService.unban({ guild: interaction.guild, userId, moderator: interaction.user, reason: readReason(interaction) });
      const target = await interaction.client.users.fetch(userId).catch(() => null);
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, target, await inGameLines(ctx, interaction.guild.id, inGame))] });
    } catch (err) {
      fivemSyncService.abortDiscordBan('unban', interaction.guild.id, userId);
      const e = errorKey(err);
      // Pas banni de Discord mais peut-être banni en jeu : l'unban est relayé aux serveurs FiveM seulement.
      if (e.key === 'moderation.errors.not_banned' && inGame !== false) {
        const count = await fivemSyncService.pushBanToGame(interaction.guild, userId, 'unban', inGame);
        if (count) {
          await interaction.editReply({ embeds: [embedService.success(ctx.t('moderation.reply.unban_game_only', { user: `<@${userId}>`, count }))] });
          return;
        }
      }
      await replyError(interaction, ctx, e.key, e.vars);
    }
  },
});
