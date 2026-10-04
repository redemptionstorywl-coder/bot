import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { fivemService } from '../services/FiveMService';
import { fivemSyncService } from '../services/FiveMSyncService';
import { childLogger } from '../utils/logger';

const log = childLogger('FiveMReady');

/** Attache le client aux services FiveM, enregistre le polling et la synchronisation, réconcilie l'état au démarrage. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  execute(client) {
    fivemService.attach(client);
    fivemSyncService.attach(client);
    fivemService.registerTasks();
    fivemSyncService.registerTasks();
    void fivemSyncService.onReady().catch((err) => log.warn({ err }, 'Réconciliation FiveM impossible'));
  },
});
