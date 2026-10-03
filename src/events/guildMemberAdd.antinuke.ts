import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiNukeService } from '../services/AntiNukeService';

/** Anti-nuke (fallback) : bot ajouté → l'entrée BotAdd de l'audit log donne l'ajouteur. */
export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(_client, member) {
    if (!member.user.bot || member.id === member.client.user?.id) return;
    await antiNukeService.handleFallback(member.guild, AuditLogEvent.BotAdd, member.id);
  },
});
