import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { logger } from '../utils/logger';
import { BRAND } from '../config/constants';
import { logHubService } from '../services/LogHubService';

export default defineEvent({
  name: Events.Error,
  execute(client, error) {
    logger.error({ err: error }, 'Erreur client Discord');
    const message = (error?.message ?? String(error)).slice(0, 1500);
    void logHubService.system(client, 'bot.error', (t) => ({ title: t('loghub.system.error_title'), description: `\`\`\`\n${message}\n\`\`\``, color: BRAND.colors.danger }), `discord:${message.slice(0, 120)}`);
  },
});
