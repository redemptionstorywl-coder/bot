import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { buildCustomId } from '../../utils/customId';
import { EPHEMERAL, MOD_PERMS, readReason, replyError } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Gérer les avertissements d’un membre')
    .addSubcommand((s) => s.setName('list').setDescription('Voir les avertissements actifs').addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Retirer un avertissement par son ID')
        .addIntegerOption((o) => o.setName('id').setDescription('ID de l’avertissement').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
    )
    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Retirer tous les avertissements d’un membre')
        .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)),
    ),
  module: 'moderation',
  permissions: MOD_PERMS.timeout,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const { t } = ctx;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const user = interaction.options.getUser('user', true);
      const warnings = await moderationService.getWarnings(guildId, user.id);
      const lines = warnings.slice(0, 20).map((w) => `**#${w.id}** • <t:${Math.floor(w.createdAt.getTime() / 1000)}:d> • <@${w.moderatorId}>\n└ ${w.reason.slice(0, 120)}`);
      const embed = embedService
        .brand(t('moderation.warnings.title', { user: user.tag, count: warnings.length }), lines.join('\n') || t('moderation.warnings.empty'))
        .setThumbnail(user.displayAvatarURL({ size: 128 }));
      if (warnings.length > 20) embed.setFooter({ text: t('moderation.warnings.more', { count: warnings.length - 20 }) });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId('mod', 'unwarn-open', user.id)).setLabel(t('moderation.warnings.remove_button')).setStyle(ButtonStyle.Secondary).setDisabled(!warnings.length),
        new ButtonBuilder().setCustomId(buildCustomId('mod', 'clearwarns', user.id)).setLabel(t('moderation.warnings.clear_button')).setStyle(ButtonStyle.Danger).setDisabled(!warnings.length),
      );
      await interaction.reply({ embeds: [embed], components: [row], ...EPHEMERAL });
      return;
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      await interaction.deferReply(EPHEMERAL);
      const result = await moderationService.removeWarning(id, interaction.user.id, readReason(interaction), guildId);
      if (!result) return replyError(interaction, ctx, 'moderation.warnings.not_found', { id });
      await interaction.editReply({ embeds: [embedService.success(t('moderation.warnings.removed', { id, user: `<@${result.warning.userId}>`, number: result.sanction.caseNumber }))] });
      return;
    }

    if (sub === 'clear') {
      const user = interaction.options.getUser('user', true);
      await interaction.deferReply(EPHEMERAL);
      const { cleared, sanction } = await moderationService.clearWarnings(guildId, user.id, interaction.user.id, readReason(interaction));
      if (!cleared) return replyError(interaction, ctx, 'moderation.warnings.empty');
      await interaction.editReply({ embeds: [embedService.success(t('moderation.warnings.cleared', { count: cleared, user: `<@${user.id}>`, number: sanction?.caseNumber ?? 0 }))] });
    }
  },
});
