import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { defineCommand } from '../../structures';
import { dmService, type DmContent } from '../../services/DmService';
import { embedService, parseColor } from '../../services/EmbedService';
import { loggingService } from '../../services/LoggingService';
import { buildCustomId } from '../../utils/customId';
import { TTLCache } from '../../utils/cache';

/** Contenus en attente de confirmation pour /dm all (clé : guildId:userId). */
export const pendingMassDm = new TTLCache<{ content: DmContent; roleId?: string }>(10 * 60_000);

function readContent(interaction: ChatInputCommandInteraction, brandColor: number): DmContent {
  const color = interaction.options.getString('color');
  return {
    message: interaction.options.getString('message', true),
    asEmbed: interaction.options.getBoolean('embed') ?? true,
    title: interaction.options.getString('title') ?? undefined,
    color: color ? parseColor(color, brandColor) : brandColor,
    imageUrl: interaction.options.getString('image') ?? undefined,
  };
}

/**
 * /dm user <membre> <message>  — envoie un message privé à un membre via le bot.
 * /dm all <message> [role]     — envoie un message privé à tous les membres (ou à un rôle), après confirmation.
 * /dm status | cancel          — suivi / annulation de l'envoi massif en cours.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Envoyer un message privé via le bot')
    .addSubcommand((s) =>
      s
        .setName('user')
        .setDescription('Envoyer un message privé à un membre')
        .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Message (variables : {user} {username} {server}…)').setRequired(true).setMaxLength(2000))
        .addBooleanOption((o) => o.setName('embed').setDescription('Envoyer dans un embed (défaut : oui)'))
        .addStringOption((o) => o.setName('title').setDescription('Titre de l’embed').setMaxLength(256))
        .addStringOption((o) => o.setName('color').setDescription('Couleur hex de l’embed (#2F8BFF)').setMaxLength(9))
        .addStringOption((o) => o.setName('image').setDescription('URL d’une image').setMaxLength(2048)),
    )
    .addSubcommand((s) =>
      s
        .setName('all')
        .setDescription('Envoyer un message privé à tous les membres (ou à un rôle)')
        .addStringOption((o) => o.setName('message').setDescription('Message (variables : {user} {username} {server}…)').setRequired(true).setMaxLength(2000))
        .addRoleOption((o) => o.setName('role').setDescription('Limiter aux membres ayant ce rôle'))
        .addBooleanOption((o) => o.setName('embed').setDescription('Envoyer dans un embed (défaut : oui)'))
        .addStringOption((o) => o.setName('title').setDescription('Titre de l’embed').setMaxLength(256))
        .addStringOption((o) => o.setName('color').setDescription('Couleur hex de l’embed (#2F8BFF)').setMaxLength(9))
        .addStringOption((o) => o.setName('image').setDescription('URL d’une image').setMaxLength(2048)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Progression de l’envoi massif en cours'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Annuler l’envoi massif en cours')),
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageGuild] },
  cooldown: 3,
  async execute(interaction, ctx) {
    const { t, config } = ctx;
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const eph = { flags: MessageFlags.Ephemeral } as const;

    if (sub === 'user') {
      await interaction.deferReply(eph);
      const member = await interaction.guild.members.fetch(interaction.options.getUser('user', true).id).catch(() => null);
      if (!member) {
        await interaction.editReply({ embeds: [embedService.error(t('core.member_not_found'))] });
        return;
      }
      const content = readContent(interaction, config.brandColor);
      const result = await dmService.sendToMember(member, content);
      if (result.ok) {
        await loggingService.log({ guildId: interaction.guild.id, category: 'MESSAGE', action: 'dm.user', title: t('dm.log.user_title'), description: content.message.slice(0, 1000), actorId: interaction.user.id, targetId: member.id });
        await interaction.editReply({ embeds: [embedService.success(t('dm.user.sent', { user: `<@${member.id}>` }))] });
      } else {
        await interaction.editReply({ embeds: [embedService.error(t(`dm.errors.${result.reason ?? 'unknown'}`, { user: `<@${member.id}>` }))] });
      }
      return;
    }

    if (sub === 'status') {
      const job = dmService.getLastJob(interaction.guild.id);
      if (!job) {
        await interaction.reply({ embeds: [embedService.info(t('dm.all.no_job'))], ...eph });
        return;
      }
      await interaction.reply({ embeds: [progressEmbed(job, t)], ...eph });
      return;
    }

    if (sub === 'cancel') {
      const ok = dmService.cancel(interaction.guild.id);
      await interaction.reply({ embeds: [ok ? embedService.success(t('dm.all.cancelled')) : embedService.info(t('dm.all.no_job'))], ...eph });
      return;
    }

    // all → confirmation
    await interaction.deferReply(eph);
    if (dmService.getActiveJob(interaction.guild.id)) {
      await interaction.editReply({ embeds: [embedService.warning(t('dm.errors.mass_dm_running'))] });
      return;
    }
    const role = interaction.options.getRole('role');
    const content = readContent(interaction, config.brandColor);
    const targets = await dmService.resolveTargets(interaction.guild, role?.id);
    if (!targets.length) {
      await interaction.editReply({ embeds: [embedService.warning(t('dm.all.no_targets'))] });
      return;
    }
    pendingMassDm.set(`${interaction.guild.id}:${interaction.user.id}`, { content, roleId: role?.id });
    const me = await interaction.guild.members.fetchMe();
    const preview = dmService.buildPayload(content, me, interaction.guild);
    const minutes = Math.ceil((targets.length * 1.2) / 60);
    const confirm = embedService
      .warning(t('dm.all.confirm', { count: targets.length, target: role ? `<@&${role.id}>` : t('dm.all.everyone'), minutes }), t('dm.all.confirm_title'))
      .setFooter({ text: t('dm.all.confirm_footer') });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId('dm', 'confirm')).setLabel(t('dm.all.btn_confirm', { count: targets.length })).setStyle(ButtonStyle.Danger).setEmoji('✉️'),
      new ButtonBuilder().setCustomId(buildCustomId('dm', 'abort')).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ content: preview.content ? `> ${preview.content.slice(0, 1500)}` : undefined, embeds: [...(preview.embeds ?? []), confirm], components: [row] });
  },
});

export function progressEmbed(job: ReturnType<typeof dmService.getLastJob> & object, t: (k: string, v?: Record<string, string | number>) => string) {
  const done = job.sent + job.failed + job.skipped;
  const pct = job.total ? Math.round((done / job.total) * 100) : 100;
  const bar = '█'.repeat(Math.round(pct / 10)).padEnd(10, '░');
  const status = job.finishedAt ? (job.cancelled ? t('dm.all.status_cancelled') : t('dm.all.status_done')) : t('dm.all.status_running');
  return embedService
    .brand(t('dm.all.progress_title'), `${bar} **${pct}%** · ${status}`)
    .addFields(
      { name: t('dm.all.f_sent'), value: `${job.sent}/${job.total}`, inline: true },
      { name: t('dm.all.f_closed'), value: String(job.skipped), inline: true },
      { name: t('dm.all.f_failed'), value: String(job.failed), inline: true },
    );
}
