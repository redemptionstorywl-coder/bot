import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : suppressions de salons en masse. */
export default defineEvent({
  name: Events.ChannelDelete,
  async execute(_client, channel) {
    if (channel.isDMBased()) return;
    await antiNukeService.handleFallback(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  },
});
