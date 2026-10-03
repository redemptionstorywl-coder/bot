import { defineSelectMenu } from '../structures';
import { embedService } from '../services/EmbedService';
import { TicketError, canManageTicket, ticketService } from '../services/TicketService';
import { loadTicketContext, replyTicketError, startOpenFlow } from '../commands/tickets/_shared';

/**
 * Menus du module tickets :
 *  - `ticket:panel-select:<panelId>` : select menu du panneau (style SELECT)
 *  - `ticket:pick:<panelId>`         : « Quel est le sujet ? » (réponse éphémère du bouton panneau)
 *  - `ticket:transfer-select:<ticketId>` : transfert vers un autre type
 */
export default defineSelectMenu({
  id: 'ticket',
  module: 'tickets',
  async execute(interaction, args, ctx) {
    if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;
    const { t } = ctx;
    const [action = '', arg = ''] = args;
    const value = interaction.values[0];
    if (!value) return;
    try {
      switch (action) {
        case 'panel-select':
        case 'pick': {
          const panel = await ticketService.getPanel(Number(arg));
          if (!panel || panel.guildId !== interaction.guildId) throw new TicketError('panel_not_found');
          const type = await ticketService.getType(interaction.guildId, Number(value));
          if (!type) throw new TicketError('type_not_found');
          await startOpenFlow(interaction, type, ctx);
          return;
        }
        case 'transfer-select': {
          const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
          if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
          await interaction.deferUpdate();
          const updated = await ticketService.transferTicket({ ticketId: ticket.id, newTypeId: Number(value), byId: interaction.user.id });
          await interaction.editReply({ content: '', embeds: [embedService.success(t('tickets.actions.transferred_confirm', { type: updated.type?.label ?? '—' }))], components: [] });
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
