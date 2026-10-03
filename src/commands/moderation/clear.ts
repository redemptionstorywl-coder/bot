import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService, type PurgeFilter } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { EPHEMERAL, MOD_PERMS, errorKey, readReason, replyError } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprimer un nombre de messages dans ce salon')
    .addIntegerOption((o) => o.setName('amount').setDescription('Nombre de messages à supprimer (1-500)').setRequired(true).setMinValue(1).setMaxValue(500))
    .addUserOption((o) => o.setName('user').setDescription('Ne supprimer que les messages de cet utilisateur'))
    .addStringOption((o) =>
      o
        .setName('filter')
        .setDescription('Filtre')
        .addChoices(
          { name: 'Tous', value: 'all' },
          { name: 'Bots uniquement', value: 'bots' },
          { name: 'Humains uniquement', value: 'humans' },
          { name: 'Messages avec liens', value: 'links' },
          { name: 'Messages avec fichiers', value: 'files' },
          { name: 'Messages avec embeds', value: 'embeds' },
        ),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
  module: 'moderation',
  permissions: MOD_PERMS.messages,
  cooldown: 5,
  async execute(interaction, ctx) {
    if (!interaction.guild || !interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) return;
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');
    const filter = (interaction.options.getString('filter') ?? 'all') as PurgeFilter;
    await interaction.deferReply(EPHEMERAL);
    try {
      const { deleted, sanction } = await moderationService.purge({ channel: interaction.channel, moderator: interaction.user, options: { amount, userId: user?.id ?? null, filter }, reason: readReason(interaction) });
      await interaction.editReply({ embeds: [embedService.success(ctx.t('moderation.purge.done', { count: deleted, channel: `<#${interaction.channel.id}>`, number: sanction.caseNumber }))] });
    } catch (e) {
      const k = errorKey(e);
      await replyError(interaction, ctx, k.key, k.vars);
    }
  },
});
