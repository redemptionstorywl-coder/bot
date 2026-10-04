import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiRaidService } from '../services/AntiRaidService';

/**
 * Anti-bot / anti-compte récent / anti-mass-join (→ lockdown).
 * Contrôle mémoïsé : guildMemberAdd.welcome attend le même résultat avant autoroles et message de bienvenue.
 */
export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(_client, member) {
    await antiRaidService.screenMember(member);
  },
});
