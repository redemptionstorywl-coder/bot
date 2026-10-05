import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { fivemSyncService } from '../../services/FiveMSyncService';
import { EPHEMERAL, MOD_PERMS, errorKey, hierarchyError, readDuration, readReason, replyError, resolveMember, sanctionEmbed } from './_shared';
import { IN_GAME_DESCRIPTION, IN_GAME_OPTION, inGameLines, readInGame } from './_inGame';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Bannir temporairement un utilisateur')
    .addUserOption((o) => o.setName('user').setDescription('Utilisateur').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Durée (ex: 1h, 2d, 1w)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Supprimer les messages des N derniers jours (0-7)').setMinValue(0).setMaxValue(7))
    .addBooleanOption((o) => o.setName(IN_GAME_OPTION).setDescription(IN_GAME_DESCRIPTION)),
  module: 'moderation',
  permissions: MOD_PERMS.ban,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const duration = readDuration(interaction, 'duration', true);
    if (duration === 'invalid' || duration === null) return replyError(interaction, ctx, 'moderation.errors.invalid_duration');
    await interaction.deferReply(EPHEMERAL);
    const { user, member } = await resolveMember(interaction);
    if (member) {
      const err = hierarchyError(interaction, member, 'bannable');
      if (err) return replyError(interaction, ctx, err);
    } else if (user.id === interaction.user.id) return replyError(interaction, ctx, 'moderation.errors.self');
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
    const inGame = readInGame(interaction);
    // Marqueur lu par l'écouteur GuildBanAdd → FiveM (relai forcé / ignoré). La fin du tempban (unban) suit le réglage des serveurs.
    fivemSyncService.prepareDiscordBan('ban', interaction.guild.id, user.id, inGame);
    try {
      const result = await moderationService.ban({ guild: interaction.guild, target: user, moderator: interaction.user, reason: readReason(interaction), duration, deleteMessageSeconds: deleteDays * 86400 });
      await interaction.editReply({ embeds: [sanctionEmbed(ctx, interaction.guild, result, user, await inGameLines(ctx, interaction.guild.id, inGame))] });
    } catch (err) {
      fivemSyncService.abortDiscordBan('ban', interaction.guild.id, user.id);
      const e = errorKey(err);
      await replyError(interaction, ctx, e.key, e.vars);
    }
  },
});
