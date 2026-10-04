import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AnnouncementStatus } from '@prisma/client';
import { defineCommand } from '../../structures';
import type { InteractionContext } from '../../structures/types';
import { embedService } from '../../services/EmbedService';
import { AnnouncementError, announcementService, buildMessageWithBrand, type AnnouncementData } from '../../services/AnnouncementService';
import { embedBuilderSessions, renderBuilder, renderContextFromInteraction, type AnnouncementDraft } from '../../services/EmbedBuilderSession';
import { buildCustomId } from '../../utils/customId';
import { discordTimestamp, parseDateInput } from '../../utils/time';
import { chunk, paginate } from '../../utils/pagination';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function announceErrorMessage(err: unknown, t: InteractionContext['t']): string | null {
  if (err instanceof AnnouncementError) return t(`announcements.errors.${err.code}`, { details: err.details ?? '' });
  return null;
}

/** Transforme une annonce persistée en brouillon de session. */
export function toDraft(ann: AnnouncementData, scheduledAt?: Date | null): AnnouncementDraft {
  return {
    id: ann.id,
    status: ann.status,
    title: ann.title,
    channelId: ann.channelId ?? undefined,
    mentionRoleIds: ann.mentionRoleIds,
    mentionEveryone: ann.mentionEveryone,
    scheduledAt: scheduledAt ?? undefined,
  };
}

function statusIcon(status: AnnouncementStatus): string {
  switch (status) {
    case 'DRAFT':
      return '📝';
    case 'SCHEDULED':
      return '⏰';
    case 'PUBLISHED':
      return '✅';
    default:
      return '📦';
  }
}

/** Récupère une annonce en vérifiant qu'elle appartient au serveur courant. */
async function getForGuild(id: number, guildId: string): Promise<AnnouncementData> {
  const ann = await announcementService.get(id);
  if (!ann || ann.guildId !== guildId) throw new AnnouncementError('not_found', String(id));
  return ann;
}

const idOption = (o: import('discord.js').SlashCommandIntegerOption) => o.setName('id').setDescription('Annonce').setRequired(true).setAutocomplete(true).setMinValue(1);

/**
 * /announce — annonces (brouillons, programmation, publication, édition).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Annonces multilingues : créer, programmer, publier')
    .addSubcommand((s) => s.setName('create').setDescription('Créer une annonce (éditeur interactif)'))
    .addSubcommand((s) => s.setName('edit').setDescription('Modifier une annonce').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('delete').setDescription('Supprimer une annonce (et ses messages)').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('duplicate').setDescription('Dupliquer une annonce en brouillon').addIntegerOption(idOption))
    .addSubcommand((s) =>
      s
        .setName('schedule')
        .setDescription('Programmer la publication')
        .addIntegerOption(idOption)
        .addStringOption((o) => o.setName('date').setDescription('Ex : 31/01/2025 20:00 ou in 2h').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('preview').setDescription('Prévisualiser une annonce').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('publish').setDescription('Publier une annonce maintenant').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('archive').setDescription('Archiver une annonce').addIntegerOption(idOption))
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Lister les annonces')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filtrer par statut')
            .addChoices({ name: 'Brouillons', value: 'DRAFT' }, { name: 'Programmées', value: 'SCHEDULED' }, { name: 'Publiées', value: 'PUBLISHED' }, { name: 'Archivées', value: 'ARCHIVED' }),
        ),
    ),
  module: 'announcements',
  permissions: { internal: 'staff', discord: [PermissionFlagsBits.ManageMessages], bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
  cooldown: 2,

  async autocomplete(interaction, { t }) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = String(interaction.options.getFocused());
    const items = await announcementService.search(interaction.guildId, /^\d+$/.test(focused) ? '' : focused, 25);
    const filtered = /^\d+$/.test(focused) ? items.filter((a) => String(a.id).startsWith(focused)) : items;
    return interaction.respond(filtered.slice(0, 25).map((a) => ({ name: `#${a.id} ${statusIcon(a.status)} ${a.title}`.slice(0, 100) || t('announcements.untitled'), value: a.id })));
  },

  async execute(interaction, ctx) {
    const { t, config, lang } = ctx;
    if (!interaction.guild || !config) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    try {
      switch (sub) {
        case 'create': {
          const session = embedBuilderSessions.create({
            guildId,
            userId: interaction.user.id,
            mode: 'announce',
            announcement: { status: AnnouncementStatus.DRAFT, mentionRoleIds: [], mentionEveryone: false },
          });
          await interaction.reply({ ...renderBuilder(session, renderContextFromInteraction(interaction, ctx)), ...EPHEMERAL });
          return;
        }
        case 'edit': {
          const ann = await getForGuild(interaction.options.getInteger('id', true), guildId);
          const pending = await announcementService.getPendingSchedule(ann.id);
          const session = embedBuilderSessions.create({
            guildId,
            userId: interaction.user.id,
            mode: 'announce',
            spec: ann.spec,
            content: ann.content ?? undefined,
            buttons: ann.buttons,
            announcement: toDraft(ann, pending?.scheduledAt),
          });
          await interaction.reply({ ...renderBuilder(session, renderContextFromInteraction(interaction, ctx)), ...EPHEMERAL });
          return;
        }
        case 'delete': {
          const ann = await getForGuild(interaction.options.getInteger('id', true), guildId);
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(buildCustomId('announce', 'del', ann.id, interaction.user.id)).setLabel(t('core.delete')).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId(buildCustomId('announce', 'delcancel', ann.id, interaction.user.id)).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary),
          );
          await interaction.reply({ embeds: [embedService.warning(t('announcements.cmd.delete_confirm', { id: ann.id, title: ann.title, count: ann.messages.length }))], components: [row], ...EPHEMERAL });
          return;
        }
        case 'duplicate': {
          const ann = await getForGuild(interaction.options.getInteger('id', true), guildId);
          const copy = await announcementService.duplicate(ann.id, interaction.user.id);
          await interaction.reply({ embeds: [embedService.success(t('announcements.cmd.duplicated', { id: copy.id, source: ann.id }))], ...EPHEMERAL });
          return;
        }
        case 'schedule': {
          const ann = await getForGuild(interaction.options.getInteger('id', true), guildId);
          const date = parseDateInput(interaction.options.getString('date', true));
          if (!date) {
            await interaction.reply({ embeds: [embedService.error(t('announcements.errors.invalid_date'))], ...EPHEMERAL });
            return;
          }
          const schedule = await announcementService.schedule(ann.id, date, interaction.user.id);
          await interaction.reply({ embeds: [embedService.success(t('announcements.cmd.scheduled', { id: ann.id, date: discordTimestamp(schedule.scheduledAt, 'F'), relative: discordTimestamp(schedule.scheduledAt, 'R') }))], ...EPHEMERAL });
          return;
        }
        case 'preview': {
          const ann = await getForGuild(interaction.options.getInteger('id', true), guildId);
          const spec = await announcementService.preview(ann.id);
          const built = buildMessageWithBrand(spec, { guild: interaction.guild, language: lang }, config.brandColor);
          await interaction.reply({ content: built.content || undefined, embeds: built.embeds, components: built.components, allowedMentions: { parse: [] }, ...EPHEMERAL });
          return;
        }
        case 'publish': {
          const ann = await getForGuild(interaction.options.getInteger('id', true), guildId);
          await interaction.deferReply(EPHEMERAL);
          const published = await announcementService.publish(ann.id, { actorId: interaction.user.id });
          const links = published.messages.map((m) => `https://discord.com/channels/${guildId}/${m.channelId}/${m.messageId}`).join('\n');
          await interaction.editReply({ embeds: [embedService.success(t('announcements.cmd.published', { id: ann.id, links }))] });
          return;
        }
        case 'archive': {
          const ann = await getForGuild(interaction.options.getInteger('id', true), guildId);
          await announcementService.archive(ann.id, interaction.user.id);
          await interaction.reply({ embeds: [embedService.success(t('announcements.cmd.archived', { id: ann.id }))], ...EPHEMERAL });
          return;
        }
        case 'list': {
          const status = (interaction.options.getString('status') as AnnouncementStatus | null) ?? undefined;
          const result = await announcementService.list(guildId, status, { page: 1, pageSize: 50 });
          if (!result.items.length) {
            await interaction.reply({ embeds: [embedService.info(t('announcements.cmd.list_empty'))], ...EPHEMERAL });
            return;
          }
          const pages = chunk(result.items, 8).map((page, i, all) =>
            embedService
              .brand(t('announcements.cmd.list_title', { count: result.total }))
              .setDescription(
                page
                  .map((a) => {
                    const when = a.publishedAt ? discordTimestamp(a.publishedAt, 'd') : discordTimestamp(a.updatedAt, 'd');
                    return `${statusIcon(a.status)} **#${a.id}** ${a.title} — ${t(`announcements.status.${a.status}`)} · ${when}${a.channelId ? ` · <#${a.channelId}>` : ''}`;
                  })
                  .join('\n'),
              )
              .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
          );
          await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
          return;
        }
      }
    } catch (err) {
      const msg = announceErrorMessage(err, t);
      if (!msg) throw err;
      const embeds = [embedService.error(msg)];
      if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
      else await interaction.reply({ embeds, ...EPHEMERAL });
    }
  },
});
