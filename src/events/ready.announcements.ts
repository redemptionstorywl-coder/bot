import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { announcementService } from '../services/AnnouncementService';
import { embedTemplateService } from '../services/EmbedTemplateService';
import { scheduler } from '../services/SchedulerService';
import { childLogger } from '../utils/logger';

const log = childLogger('Announcements');

/**
 * Attache le client aux services embeds / annonces et enregistre la tâche de publication
 * des annonces programmées (toutes les 15 s).
 */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    announcementService.attach(client);
    embedTemplateService.attach(client);
    scheduler.register({
      name: 'announcements:scheduled',
      intervalMs: 15_000,
      runOnStart: true,
      async run() {
        const r = await announcementService.processDue();
        if (r.sent || r.failed) log.info(r, 'Annonces programmées traitées');
      },
    });
  },
});
