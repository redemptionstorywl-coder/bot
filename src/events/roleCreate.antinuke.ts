import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : créations de rôles en masse. */
export default defineEvent({
  name: Events.GuildRoleCreate,
  async execute(_client, role) {
    await antiNukeService.handleFallback(role.guild, AuditLogEvent.RoleCreate, role.id);
  },
});
