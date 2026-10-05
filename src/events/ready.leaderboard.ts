import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { leaderboardService } from '../services/LeaderboardService';

/** Classement Battle Royale en direct : attache le client et enregistre l'anti-rafale + le rafraîchissement de sécurité. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  execute(client) {
    leaderboardService.attach(client);
    leaderboardService.registerTasks();
  },
});
