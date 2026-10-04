import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { childLogger } from '../utils/logger';

const log = childLogger('GuildCreate');

export default defineEvent({
  name: Events.GuildCreate,
  async execute(_client, guild) {
    await guildConfigService.ensureGuild(guild);
    log.info({ guild: guild.id, name: guild.name }, 'Nouveau serveur');
  },
});
