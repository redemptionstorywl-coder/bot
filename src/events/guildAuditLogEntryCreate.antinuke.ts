import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/**
 * Anti-nuke : point d'entrée principal. L'entrée d'audit log fournit directement l'exécuteur et l'action
 * (intent GuildModeration + permission ViewAuditLog requis). Les événements `*.antinuke.ts` restants
 * sont des fallbacks (fetchAuditLogs) utilisés seulement si ce flux n'est pas actif pour le serveur.
 */
export default defineEvent({
  name: Events.GuildAuditLogEntryCreate,
  async execute(_client, entry, guild) {
    await antiNukeService.handleAuditEntry(entry, guild);
  },
});
