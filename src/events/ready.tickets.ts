import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { ticketService } from '../services/TicketService';
import { childLogger } from '../utils/logger';

const log = childLogger('Tickets');

/** Relie le TicketService au client et charge en mémoire les salons des tickets ouverts. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    ticketService.attach(client);
    try {
      const count = await ticketService.loadOpenChannels();
      log.info({ openTickets: count }, 'Tickets ouverts chargés');
    } catch (err) {
      log.error({ err }, 'Impossible de charger les tickets ouverts');
    }
  },
});
