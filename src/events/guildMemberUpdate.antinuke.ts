import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : ajout de rôles à permissions dangereuses en masse. */
export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(_client, oldMember, newMember) {
    if (oldMember.partial) return;
    const added = newMember.roles.cache.some((r) => !oldMember.roles.cache.has(r.id));
    if (!added) return;
    await antiNukeService.handleFallback(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
  },
});
