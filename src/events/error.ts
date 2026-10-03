import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { logger } from '../utils/logger';

export default defineEvent({
  name: Events.Error,
  execute(_client, error) {
    logger.error({ err: error }, 'Erreur client Discord');
  },
});
