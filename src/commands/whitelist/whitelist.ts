import { ActionRowBuilder, GuildMember, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { GuildKind, ReviewStatus } from '@prisma/client';
import { defineCommand } from '../../structures';
import { whitelistService, WhitelistError, MAX_QUESTIONS, parseAnswers } from '../../services/WhitelistService';
import { embedService } from '../../services/EmbedService';
import { fivemIdentifierSchema } from '../../services/fivem/schemas';
import { env } from '../../config/env';
import { hasInternalPermission } from '../../utils/permissions';
import { buildCustomId } from '../../utils/customId';
import { chunk, paginate } from '../../utils/pagination';
import { discordTimestamp } from '../../utils/time';

const STATUS_CHOICES = Object.values(ReviewStatus).map((s) => ({ name: s, value: s }));

/**
 * /whitelist — candidature (modal), review staff, statut, liste.
 * La configuration (questions, salon de review, rôles, DM, ouverture) est dans `/config module:whitelist`.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Whitelist : candidater, consulter, gérer')
    .addSubcommand((s) => s.setName('apply').setDescription('Déposer une candidature whitelist').addStringOption((o) => o.setName('identifier').setDescription('Identifiant FiveM (license:…) — optionnel').setMaxLength(80)))
    .addSubcommand((s) => s.setName('status').setDescription('Voir l’état de ma candidature'))
    .addSubcommand((s) =>
      s
        .setName('review')
        .setDescription('[Staff] Accepter ou refuser une candidature')
        .addStringOption((o) => o.setName('decision').setDescription('Décision').setRequired(true).addChoices({ name: '✅ accept', value: 'ACCEPTED' }, { name: '⛔ reject', value: 'REJECTED' }))
        .addIntegerOption((o) => o.setName('id').setDescription('Numéro du dossier').setMinValue(1))
        .addUserOption((o) => o.setName('user').setDescription('Candidat (dossier en attente)'))
        .addStringOption((o) => o.setName('note').setDescription('Note transmise au candidat').setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('[Staff] Lister les candidatures').addStringOption((o) => o.setName('status').setDescription('Filtrer par statut').addChoices(...STATUS_CHOICES))),
  module: 'whitelist',
  guildKinds: [GuildKind.PRISON, GuildKind.SCHOOL],
  cooldown: 3,
  async execute(interaction, { t, lang, config }) {
    if (!interaction.guild || !config) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const can = (required: 'staff' | 'admin') => hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required });
    const deny = (level: string) => interaction.reply({ embeds: [embedService.error(t('core.insufficient_level', { level }))], ...ephemeral });

    switch (sub) {
      case 'apply': {
        const settings = await whitelistService.getConfig(guildId);
        if (!settings.enabled) return interaction.reply({ embeds: [embedService.error(t('whitelist.errors.disabled'))], ...ephemeral });
        const latest = await whitelistService.getLatest(guildId, interaction.user.id);
        if (latest?.status === ReviewStatus.PENDING) return interaction.reply({ embeds: [embedService.error(t('whitelist.errors.already_pending'))], ...ephemeral });
        if (latest?.status === ReviewStatus.ACCEPTED) return interaction.reply({ embeds: [embedService.error(t('whitelist.errors.already_accepted'))], ...ephemeral });
        const identifierRaw = interaction.options.getString('identifier')?.trim();
        let identifier = '';
        if (identifierRaw) {
          const parsed = fivemIdentifierSchema.safeParse(identifierRaw);
          if (!parsed.success) return interaction.reply({ embeds: [embedService.error(t('whitelist.errors.invalid_identifier'))], ...ephemeral });
          identifier = parsed.data;
        }
        const questions = whitelistService.resolveQuestions(settings, lang);
        let customId: string;
        try {
          customId = buildCustomId('whitelist', 'apply', identifier);
        } catch {
          // identifiant trop long une fois encodé pour tenir dans un customId (100 caractères)
          return interaction.reply({ embeds: [embedService.error(t('whitelist.errors.invalid_identifier'))], ...ephemeral });
        }
        const modal = new ModalBuilder().setCustomId(customId).setTitle(t('whitelist.apply.modal_title').slice(0, 45));
        for (const q of questions.slice(0, MAX_QUESTIONS)) {
          const input = new TextInputBuilder().setCustomId(q.id).setLabel(q.label.slice(0, 45)).setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph).setRequired(q.required).setMaxLength(q.style === 'short' ? 200 : 1000);
          if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
          modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        }
        await interaction.showModal(modal);
        return;
      }
      case 'status': {
        const row = await whitelistService.getLatest(guildId, interaction.user.id);
        if (!row) return interaction.reply({ embeds: [embedService.info(t('whitelist.status_cmd.none'))], ...ephemeral });
        const embed = embedService
          .brand(t('whitelist.status_cmd.title', { id: row.id }))
          .setDescription(`${t('whitelist.review.status')} : **${t(`whitelist.status.${row.status.toLowerCase()}`)}**\n${t('whitelist.review.submitted')} : ${discordTimestamp(row.createdAt, 'R')}${row.reviewedAt ? `\n${t('whitelist.status_cmd.reviewed')} : ${discordTimestamp(row.reviewedAt, 'R')}` : ''}${row.note ? `\n\n> ${row.note}` : ''}`);
        if (row.identifier) embed.addFields({ name: t('whitelist.review.identifier'), value: `\`${row.identifier}\`` });
        await interaction.reply({ embeds: [embed], ...ephemeral });
        return;
      }
      case 'review': {
        if (!can('staff')) return deny('staff');
        const decision = interaction.options.getString('decision', true) as 'ACCEPTED' | 'REJECTED';
        const id = interaction.options.getInteger('id');
        const user = interaction.options.getUser('user');
        const note = interaction.options.getString('note');
        let targetId = id ?? null;
        if (!targetId && user) {
          const latest = await whitelistService.getLatest(guildId, user.id);
          if (!latest || latest.status !== ReviewStatus.PENDING) return interaction.reply({ embeds: [embedService.error(t('whitelist.errors.not_found'))], ...ephemeral });
          targetId = latest.id;
        }
        if (!targetId) return interaction.reply({ embeds: [embedService.error(t('whitelist.review.need_target'))], ...ephemeral });
        await interaction.deferReply(ephemeral);
        try {
          const row = await whitelistService.review({ guildId, id: targetId, reviewerId: interaction.user.id, decision, note });
          await interaction.editReply({ embeds: [embedService.success(t(decision === 'ACCEPTED' ? 'whitelist.review.accepted' : 'whitelist.review.rejected', { id: row.id, user: `<@${row.userId}>` }))] });
        } catch (err) {
          if (err instanceof WhitelistError) return interaction.editReply({ embeds: [embedService.error(t(`whitelist.errors.${err.code}`))] });
          throw err;
        }
        return;
      }
      case 'list': {
        if (!can('staff')) return deny('staff');
        const status = interaction.options.getString('status') as ReviewStatus | null;
        const rows = await whitelistService.list(guildId, status ?? undefined, 200);
        if (!rows.length) return interaction.reply({ embeds: [embedService.info(t('whitelist.list.empty'))], ...ephemeral });
        const counts = await whitelistService.counts(guildId);
        const pages = chunk(rows, 10).map((group, i, all) =>
          embedService
            .brand(t('whitelist.list.title', { status: status ? t(`whitelist.status.${status.toLowerCase()}`) : t('whitelist.list.all') }))
            .setDescription(
              group
                .map((r) => {
                  const icon = r.status === 'ACCEPTED' ? '✅' : r.status === 'REJECTED' ? '⛔' : '⏳';
                  const first = parseAnswers(r.answers)[0]?.answer;
                  return `${icon} **#${r.id}** <@${r.userId}> · ${discordTimestamp(r.createdAt, 'R')}${first ? ` · _${first.slice(0, 40)}_` : ''}`;
                })
                .join('\n'),
            )
            .setFooter({ text: `${t('core.page', { current: i + 1, total: all.length })} • ⏳ ${counts.PENDING} · ✅ ${counts.ACCEPTED} · ⛔ ${counts.REJECTED}` }),
        );
        await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
        return;
      }
    }
  },
});
