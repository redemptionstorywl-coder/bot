import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { activityService } from '../services/ActivityService';

/**
 * Compteur d'activité : un incrément mémoire par message (aucune requête SQL ici).
 * Le flush en base est assuré par la tâche scheduler `activity:flush`.
 */
export default defineEvent({
  name: Events.MessageCreate,
  execute(_client, message) {
    if (!message.inGuild() || message.author.bot || message.system) return;
    activityService.increment(message.guildId, message.author.id, message.createdAt);
  },
});
