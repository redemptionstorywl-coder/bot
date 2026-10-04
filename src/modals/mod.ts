import { EmbedBuilder, GuildMember, MessageFlags, PermissionFlagsBits, type ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { isGuildNameConfirmed, moderationService, nukeReportFields } from '../services/ModerationService';
import { embedService } from '../services/EmbedService';
import { hasInternalPermission } from '../utils/permissions';
import { formatDuration } from '../utils/time';
import { env } from '../config/env';
import { BRAND } from '../config/constants';
import { childLogger } from '../utils/logger';

const log = childLogger('ModModal');

/**
 * Modals du module modération (namespace `mod`) :
 *  - mod:unwarn:<userId>     → champs `id` (ID de l'avertissement) et `reason`
 *  - mod:nukeguild:<1|0>     → confirmation de /clear serveur (champ `name` = nom exact du serveur ; 1 = inclure les tickets)
 */
export default defineModal({
  id: 'mod',
  module: 'moderation',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    const [action, userId] = args;
    if (!interaction.guild) return;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;

    if (action === 'nukeguild') {
      await nukeGuild(interaction, ctx, userId === '1');
      return;
    }
    if (action === 'unwarn') {
      const rawId = interaction.fields.getTextInputValue('id').trim();
      const reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
      const id = Number(rawId.replace(/^#/, ''));
      if (!Number.isInteger(id) || id <= 0) {
        await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: rawId }))], ...ephemeral });
        return;
      }
      await interaction.deferReply(ephemeral);
      const result = await moderationService.removeWarning(id, interaction.user.id, reason, interaction.guild.id);
      if (!result || (userId && result.warning.userId !== userId)) {
        await interaction.editReply({ embeds: [embedService.error(t('moderation.warnings.not_found', { id }))] });
        return;
      }
      await interaction.editReply({ embeds: [embedService.success(t('moderation.warnings.removed', { id, user: `<@${result.warning.userId}>`, number: result.sanction.caseNumber }))] });
      return;
    }
    await interaction.reply({ embeds: [embedService.error(t('core.not_found'))], ...ephemeral });
  },
});

/** /clear serveur : vérifie le nom saisi, lance la recréation des salons puis envoie le rapport en DM. */
async function nukeGuild(interaction: ModalSubmitInteraction, ctx: InteractionContext, includeTickets: boolean): Promise<void> {
  const { t, lang } = ctx;
  const guild = interaction.guild!;
  const ephemeral = { flags: MessageFlags.Ephemeral } as const;
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  if (!hasInternalPermission({ member, config: ctx.config, ownerIds: env().OWNER_IDS, required: 'admin' })) {
    await interaction.reply({ embeds: [embedService.error(t('moderation.nuke_guild.admin_only'))], ...ephemeral });
    return;
  }
  if (!guild.members.me?.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
    await interaction.reply({ embeds: [embedService.error(t('moderation.nuke_guild.bot_missing'))], ...ephemeral });
    return;
  }
  if (!isGuildNameConfirmed(interaction.fields.getTextInputValue('name'), guild.name)) {
    await interaction.reply({ embeds: [embedService.error(t('moderation.nuke_guild.mismatch'))], ...ephemeral });
    return;
  }
  if (moderationService.isNukingGuild(guild.id)) {
    await interaction.reply({ embeds: [embedService.error(t('moderation.nuke_guild.already_running'))], ...ephemeral });
    return;
  }
  // Le salon de la commande va être supprimé : on répond tout de suite, le rapport final part en DM.
  await interaction.reply({ embeds: [embedService.warning(t('moderation.nuke_guild.in_progress'), t('moderation.nuke_guild.title'))], ...ephemeral });
  let embed: EmbedBuilder;
  try {
    const report = await moderationService.nukeGuild(guild, interaction.user, { includeTickets });
    embed = new EmbedBuilder()
      .setColor(report.errors.length ? BRAND.colors.warning : BRAND.colors.primary)
      .setTitle(t('moderation.nuke_guild.dm_title', { server: guild.name }).slice(0, 256))
      .setDescription(
        `${t('moderation.nuke_guild.done', { count: report.cleared.length, duration: formatDuration(Math.max(1, Math.round(report.durationMs / 1000)), lang), number: report.sanction.caseNumber })}\n${t('moderation.nuke_guild.dm_description', { number: report.sanction.caseNumber })}`,
      )
      .addFields(nukeReportFields(t, lang, report))
      .setFooter({ text: BRAND.footer })
      .setTimestamp();
  } catch (err) {
    log.error({ err, guild: guild.id }, '/clear serveur en échec');
    const key = (err as { key?: string }).key;
    embed = embedService.error(key ? t(key) : t('moderation.nuke_guild.failed', { error: ((err as Error).message ?? String(err)).slice(0, 500) }));
  }
  const dmSent = await interaction.user.send({ embeds: [embed] }).then(() => true).catch(() => false);
  // Le message éphémère peut encore exister (salon d'origine ignoré) : on le met à jour au mieux.
  await interaction.editReply({ embeds: [embed] }).catch(() => null);
  if (!dmSent) log.warn({ guild: guild.id, user: interaction.user.id }, 'Rapport /clear serveur non envoyé en DM (DM fermés ?)');
}
