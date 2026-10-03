import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { fivemService } from '../services/FiveMService';

/** Attache le client au service FiveM et enregistre le polling, quel que soit le type de serveur. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  execute(client) {
    fivemService.attach(client);
    fivemService.registerTasks();
  },
});
