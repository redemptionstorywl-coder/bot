import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { leaderboardService } from '../services/LeaderboardService';

/** Message de classement Battle Royale supprimé → republié automatiquement (au plus une fois par minute). */
export default defineEvent({
  name: Events.MessageDelete,
  execute(_client, message) {
    leaderboardService.onMessageDeleted(message.id);
  },
});
