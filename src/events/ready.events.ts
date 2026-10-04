import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { scheduler } from '../services/SchedulerService';
import { eventService } from '../services/EventService';
import { giveawayService } from '../services/GiveawayService';
import { pollService } from '../services/PollService';
import { activityService } from '../services/ActivityService';
import { childLogger } from '../utils/logger';

const log = childLogger('Ready:events');

/**
 * Module Événements / Giveaways / Sondages / Activité :
 * attache le client aux services et enregistre les tâches périodiques.
 */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  execute(client) {
    eventService.attach(client);
    giveawayService.attach(client);
    pollService.attach(client);

    scheduler.register({ name: 'events:reminders', intervalMs: 30_000, runOnStart: true, run: () => eventService.tick() });
    scheduler.register({ name: 'giveaways:end', intervalMs: 15_000, runOnStart: true, run: () => giveawayService.tick() });
    scheduler.register({ name: 'polls:end', intervalMs: 15_000, runOnStart: true, run: () => pollService.tick() });
    scheduler.register({
      name: 'activity:flush',
      intervalMs: 60_000,
      run: async () => {
        await activityService.flush();
      },
    });

    // Le flush final de l'activité est fait par l'arrêt propre de src/index.ts (SIGINT / SIGTERM).

    log.info('Services événements / giveaways / sondages / activité prêts');
  },
});
