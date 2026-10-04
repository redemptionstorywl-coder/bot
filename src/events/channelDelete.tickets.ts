import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { ticketService } from '../services/TicketService';
import { moderationService } from '../services/ModerationService';
import { childLogger } from '../utils/logger';

const log = childLogger('Tickets');

/**
 * Salon de ticket supprimé à la main → le ticket passe en DELETED (transcript si des messages existent).
 * Ignoré pour les salons recréés par /clear (le ticket est rattaché au nouveau salon).
 */
export default defineEvent({
  name: Events.ChannelDelete,
  async execute(_client, channel) {
    if (channel.isDMBased() || moderationService.isNukeDeletion(channel.id)) return;
    try {
      await ticketService.markChannelDeleted(channel.id, channel.guildId);
    } catch (err) {
      log.error({ err, channel: channel.id }, 'markChannelDeleted');
    }
  },
});
