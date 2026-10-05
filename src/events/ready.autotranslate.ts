import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { autoTranslateService } from '../services/AutoTranslateService';

/** Traduction automatique : purge périodique du cache de traductions (SchedulerService). */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute() {
    autoTranslateService.attach();
  },
});
