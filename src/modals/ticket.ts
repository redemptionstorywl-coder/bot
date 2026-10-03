import { PermissionFlagsBits } from 'discord.js';
import { defineModal } from '../structures';
import { embedService } from '../services/EmbedService';
import { TicketError, canCloseTicket, canManageTicket, parseQuestions, ticketService } from '../services/TicketService';
import { env } from '../config/env';
import { hasInternalPermission } from '../utils/permissions';
import { EPHEMERAL, createTicketAndReply, fetchMember, loadTicketContext, parseUserId, readAnswers, readQuestionsConfig, replyTicketError } from '../commands/tickets/_shared';

/**
 * Modals du module tickets :
 *  - `ticket:open:<typeId>`          : formulaire d'ouverture (questions du type)
 *  - `ticket:close-modal:<ticketId>` : raison de fermeture
 *  - `ticket:add-modal:<ticketId>` / `ticket:remove-modal:<ticketId>` : membre (ID ou mention)
 *  - `ticket:questions:<typeId>`     : configuration des questions d'un type (admin)
 */
export default defineModal({
  id: 'ticket',
  module: 'tickets',
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild()) return;
    const { t, config } = ctx;
    const [action = '', arg = ''] = args;
    try {
      switch (action) {
        case 'open': {
          await interaction.deferReply(EPHEMERAL);
          const type = await ticketService.getType(interaction.guildId, Number(arg));
          if (!type) throw new TicketError('type_not_found');
          const answers = readAnswers(interaction, parseQuestions(type.questions));
          await createTicketAndReply(interaction, type, answers, ctx);
          return;
        }
        case 'close-modal': {
          const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
          if (!canCloseTicket(ticket, actor)) throw new TicketError(ticket.status === 'OPEN' || ticket.status === 'CLAIMED' ? 'no_permission' : 'already_closed');
          await interaction.deferReply(EPHEMERAL);
          const reason = interaction.fields.getTextInputValue('reason').trim() || null;
          const { ticket: closed } = await ticketService.closeTicket({ ticketId: ticket.id, closedById: interaction.user.id, reason });
          await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.closed_confirm', { number: closed.number }))] }).catch(() => null);
          return;
        }
        case 'add-modal':
        case 'remove-modal': {
          const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
          if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
          await interaction.deferReply(EPHEMERAL);
          const targetId = parseUserId(interaction.fields.getTextInputValue('user'));
          if (!targetId) throw new TicketError('invalid_user');
          if (action === 'add-modal') {
            await ticketService.addMember({ ticketId: ticket.id, targetId, byId: interaction.user.id });
            await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.member_added_confirm', { target: `<@${targetId}>` }))] });
          } else {
            await ticketService.removeMember({ ticketId: ticket.id, targetId, byId: interaction.user.id });
            await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.member_removed_confirm', { target: `<@${targetId}>` }))] });
          }
          return;
        }
        case 'questions': {
          const member = await fetchMember(interaction);
          const isAdmin = hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: 'admin' }) || member?.permissions.has(PermissionFlagsBits.Administrator) === true;
          if (!isAdmin) throw new TicketError('no_permission');
          await interaction.deferReply(EPHEMERAL);
          const type = await ticketService.getType(interaction.guildId, Number(arg));
          if (!type) throw new TicketError('type_not_found');
          const questions = readQuestionsConfig(interaction);
          const updated = await ticketService.updateType(interaction.guildId, type.id, { questions });
          await interaction.editReply({ embeds: [embedService.success(t('tickets.type.questions_updated', { label: updated.label, count: questions.length }))] });
          return;
        }
        default:
          return;
      }
    } catch (err) {
      if (await replyTicketError(interaction, t, err)) return;
      throw err;
    }
  },
});
