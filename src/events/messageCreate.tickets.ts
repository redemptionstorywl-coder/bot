import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { ticketService } from '../services/TicketService';

/**
 * Collecte en direct les messages des tickets ouverts (table TicketMessage, via buffer).
 * Aucune requête SQL si le salon n'est pas un ticket : le test se fait sur le cache mémoire du service.
 */
export default defineEvent({
  name: Events.MessageCreate,
  execute(_client, message) {
    if (!message.inGuild()) return;
    if (!ticketService.isTicketChannel(message.channelId)) return;
    ticketService.recordMessage(message);
  },
});
