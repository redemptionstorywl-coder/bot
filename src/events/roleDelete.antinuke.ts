import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : suppressions de rôles en masse. */
export default defineEvent({
  name: Events.GuildRoleDelete,
  async execute(_client, role) {
    await antiNukeService.handleFallback(role.guild, AuditLogEvent.RoleDelete, role.id);
  },
});
