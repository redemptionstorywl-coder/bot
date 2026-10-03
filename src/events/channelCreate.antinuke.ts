import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : créations de salons en masse. */
export default defineEvent({
  name: Events.ChannelCreate,
  async execute(_client, channel) {
    await antiNukeService.handleFallback(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  },
});
