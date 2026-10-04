import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { ticketService } from '../services/TicketService';
import { ticketReminderService } from '../services/TicketReminderService';

/** Suit qui (staff ou membre) a parlé en dernier dans chaque ticket, pour les relances automatiques. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(_client, message) {
    if (!message.inGuild() || message.author.bot) return;
    if (!ticketService.isTicketChannel(message.channelId)) return;
    await ticketReminderService.trackMessage(message);
  },
});
