import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { honeypotService } from '../services/HoneypotService';

export default defineEvent({
  name: Events.MessageCreate,
  async execute(_client, message) {
    await honeypotService.handleMessage(message);
  },
});
