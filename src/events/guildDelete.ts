import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';

export default defineEvent({
  name: Events.GuildDelete,
  async execute(_client, guild) {
    if (guild.available === false) return;
    await guildConfigService.markLeft(guild.id);
  },
});
