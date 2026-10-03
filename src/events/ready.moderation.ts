import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { moderationService } from '../services/ModerationService';
import { antiRaidService } from '../services/AntiRaidService';

/** Attache les services de modération / anti-raid au client et enregistre leurs tâches planifiées. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    moderationService.attach(client);
    antiRaidService.attach(client);
  },
});
