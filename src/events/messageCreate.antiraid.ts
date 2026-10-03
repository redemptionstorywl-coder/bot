import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiRaidService } from '../services/AntiRaidService';

/** Anti-spam / anti-mass-mention / anti-lien : analyse en mémoire, zéro SQL par message. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(_client, message) {
    if (!message.inGuild() || message.author.bot) return;
    await antiRaidService.handleMessage(message);
  },
});
