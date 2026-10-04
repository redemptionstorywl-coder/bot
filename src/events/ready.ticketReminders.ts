import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { ticketReminderService } from '../services/TicketReminderService';

export default defineEvent({
  name: Events.ClientReady,
  once: true,
  execute(client) {
    ticketReminderService.attach(client);
  },
});
