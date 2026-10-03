import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiRaidService } from '../services/AntiRaidService';

/** Anti-bot / anti-compte récent / anti-mass-join (→ lockdown). */
export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(_client, member) {
    await antiRaidService.handleMemberAdd(member);
  },
});
