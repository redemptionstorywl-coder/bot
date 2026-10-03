import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : expulsions en masse. */
export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(client, member) {
    if (member.id === client.user?.id) return;
    await antiNukeService.handleFallback(member.guild, AuditLogEvent.MemberKick, member.id);
  },
});
