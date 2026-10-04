import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { antiRaidService } from '../services/AntiRaidService';
import { honeypotService } from '../services/HoneypotService';

/** Anti-spam / anti-mass-mention / anti-lien : analyse en mémoire, zéro SQL par message. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(_client, message) {
    if (!message.inGuild() || message.author.bot) return;
    // Salon piège : le message est déjà traité par messageCreate.honeypot (suppression + expulsion).
    // L'anti-raid y ajouterait un timeout et une seconde case (double sanction).
    if (honeypotService.channelFor(message.guildId) === message.channelId) return;
    await antiRaidService.handleMessage(message);
  },
});
