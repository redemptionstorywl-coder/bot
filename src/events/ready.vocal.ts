import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { tempVoiceService } from '../services/TempVoiceService';
import { childLogger } from '../utils/logger';

const log = childLogger('TempVoice');

/** Reprise des salons vocaux temporaires : ceux restés vides pendant l'arrêt sont supprimés, ceux disparus oubliés. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await tempVoiceService.attach(client).catch((err) => log.error({ err }, 'Reprise des salons vocaux temporaires impossible'));
  },
});
