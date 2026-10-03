import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { TicketStatus } from '@prisma/client';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { TicketError, canCloseTicket, canManageTicket, canViewTicket, ticketService, type TicketListFilters } from '../../services/TicketService';
import { discordTimestamp } from '../../utils/time';
import { chunk, paginate } from '../../utils/pagination';
import { EPHEMERAL, fetchMember, loadChannelTicket, replyTicketError } from './_shared';
import { autocompleteTypes } from './ticket-type';

/**
 * /ticket — actions staff dans un ticket (close, add, remove, claim, transcript, rename, info) + liste paginée.
 * Les permissions sont vérifiées par action : le créateur peut fermer, le staff (rôles du type inclus) gère tout.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Gérer le ticket courant')
    .addSubcommand((s) => s.setName('close').setDescription('Fermer le ticket').addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(500)))
    .addSubcommand((s) => s.setName('add').setDescription('Ajouter un membre au ticket').addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Retirer un membre du ticket').addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true)))
    .addSubcommand((s) => s.setName('claim').setDescription('Prendre en charge le ticket'))
    .addSubcommand((s) => s.setName('transcript').setDescription('Générer et envoyer le transcript'))
    .addSubcommand((s) => s.setName('rename').setDescription('Renommer le salon du ticket').addStringOption((o) => o.setName('name').setDescription('Nouveau nom').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('info').setDescription('Informations sur un ticket').addIntegerOption((o) => o.setName('number').setDescription('Numéro du ticket (vide = salon courant)').setMinValue(1)))
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Lister les tickets')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Statut')
            .addChoices({ name: 'Ouverts', value: 'open' }, { name: 'Fermés', value: 'closed' }, { name: 'Pris en charge', value: 'CLAIMED' }, { name: 'Supprimés', value: 'DELETED' }, { name: 'Tous', value: 'all' }),
        )
        .addUserOption((o) => o.setName('user').setDescription('Filtrer par créateur'))
        .addStringOption((o) => o.setName('type').setDescription('Filtrer par type').setAutocomplete(true)),
    ),
  module: 'tickets',
  permissions: { internal: 'everyone' },
  cooldown: 2,
  autocomplete: autocompleteTypes,
  async execute(interaction, ctx) {
    const { t, config, lang } = ctx;
    if (!interaction.inCachedGuild() || !config) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    try {
      switch (sub) {
        case 'close': {
          const { ticket, actor } = await loadChannelTicket(interaction, ctx);
          if (!canCloseTicket(ticket, actor)) throw new TicketError(ticket.status === TicketStatus.OPEN || ticket.status === TicketStatus.CLAIMED ? 'no_permission' : 'already_closed');
          await interaction.deferReply(EPHEMERAL);
          const { ticket: closed } = await ticketService.closeTicket({ ticketId: ticket.id, closedById: interaction.user.id, reason: interaction.options.getString('reason') });
          await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.closed_confirm', { number: closed.number }))] }).catch(() => null);
          return;
        }
        case 'add':
        case 'remove': {
          const { ticket, actor } = await loadChannelTicket(interaction, ctx);
          if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
          const user = interaction.options.getUser('user', true);
          await interaction.deferReply(EPHEMERAL);
          if (sub === 'add') {
            await ticketService.addMember({ ticketId: ticket.id, targetId: user.id, byId: interaction.user.id });
            await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.member_added_confirm', { target: `<@${user.id}>` }))] });
          } else {
            await ticketService.removeMember({ ticketId: ticket.id, targetId: user.id, byId: interaction.user.id });
            await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.member_removed_confirm', { target: `<@${user.id}>` }))] });
          }
          return;
        }
        case 'claim': {
          const { ticket, actor } = await loadChannelTicket(interaction, ctx);
          if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
          await interaction.deferReply(EPHEMERAL);
          const updated = await ticketService.claimTicket({ ticketId: ticket.id, staffId: interaction.user.id });
          await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.claimed_confirm', { number: updated.number }))] });
          return;
        }
        case 'transcript': {
          const { ticket, actor } = await loadChannelTicket(interaction, ctx);
          if (!canViewTicket(ticket, actor)) throw new TicketError('no_permission');
          await interaction.deferReply(EPHEMERAL);
          const result = await ticketService.generateTranscript(ticket.id, { closedById: ticket.closedById, closedAt: ticket.closedAt ?? new Date() });
          const channel = interaction.channel?.type === ChannelType.GuildText ? interaction.channel : null;
          await ticketService.sendTranscript(ticket, result, { channel, dm: false });
          await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.transcript_sent'))] });
          return;
        }
        case 'rename': {
          const { ticket, actor } = await loadChannelTicket(interaction, ctx);
          if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
          await interaction.deferReply(EPHEMERAL);
          const name = await ticketService.renameTicket({ ticketId: ticket.id, name: interaction.options.getString('name', true) });
          await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.renamed', { name }))] });
          return;
        }
        case 'info': {
          const number = interaction.options.getInteger('number');
          await interaction.deferReply(EPHEMERAL);
          const member = await fetchMember(interaction);
          let ticket;
          if (number) {
            ticket = await ticketService.getTicketByNumber(guildId, number);
            if (!ticket) throw new TicketError('not_found');
          } else {
            ticket = (await loadChannelTicket(interaction, ctx)).ticket;
          }
          const actor = ticketService.actor(member, config, ticket.type);
          if (!actor.staff && ticket.userId !== actor.userId) throw new TicketError('no_permission');
          await interaction.editReply({ embeds: [ticketService.infoEmbed(ticket, t, lang, config.brandColor)] });
          return;
        }
        case 'list':
        default: {
          const member = await fetchMember(interaction);
          if (!ticketService.isStaff(member, config)) throw new TicketError('staff_only');
          await interaction.deferReply(EPHEMERAL);
          const statusOpt = interaction.options.getString('status') ?? 'open';
          const filters: TicketListFilters = {};
          if (statusOpt === 'open' || statusOpt === 'closed') filters.status = statusOpt;
          else if (statusOpt !== 'all' && statusOpt in TicketStatus) filters.status = statusOpt as TicketStatus;
          const user = interaction.options.getUser('user');
          if (user) filters.userId = user.id;
          const typeKey = interaction.options.getString('type');
          if (typeKey) {
            const type = await ticketService.getType(guildId, typeKey);
            if (!type) throw new TicketError('type_not_found');
            filters.typeId = type.id;
          }
          const result = await ticketService.listTickets(guildId, filters, 1, 50);
          if (!result.items.length) {
            await interaction.editReply({ embeds: [embedService.info(t('tickets.list.empty'))] });
            return;
          }
          const statusLabel = statusOpt === 'all' ? t('tickets.list.all') : statusOpt === 'open' || statusOpt === 'closed' ? t(`tickets.status.${statusOpt === 'open' ? 'OPEN' : 'CLOSED'}`) : t(`tickets.status.${statusOpt}`);
          const lines = result.items.map((tk) =>
            t('tickets.list.line', {
              number: tk.number,
              channel: tk.status === TicketStatus.DELETED ? '—' : `<#${tk.channelId}>`,
              user: `<@${tk.userId}>`,
              type: tk.type?.label ?? '—',
              status: t(`tickets.status.${tk.status}`),
              created: discordTimestamp(tk.createdAt, 'R'),
            }),
          );
          const pages = chunk(lines, 10).map((group, i, all) =>
            embedService.brand(t('tickets.list.title', { status: statusLabel, total: result.total }), group.join('\n')).setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
          );
          await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
          return;
        }
      }
    } catch (err) {
      if (await replyTicketError(interaction, t, err)) return;
      throw err;
    }
  },
});
