import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : bans en masse. */
export default defineEvent({
  name: Events.GuildBanAdd,
  async execute(_client, ban) {
    await antiNukeService.handleFallback(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  },
});
