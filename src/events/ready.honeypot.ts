import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { honeypotService } from '../services/HoneypotService';
import { childLogger } from '../utils/logger';

const log = childLogger('Honeypot');

export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await honeypotService.attach(client).catch((err) => log.error({ err }, 'Chargement des salons piège impossible'));
  },
});
