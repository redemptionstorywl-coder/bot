import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { logHubService } from '../services/LogHubService';
import { childLogger } from '../utils/logger';

const log = childLogger('GuildCreate');

export default defineEvent({
  name: Events.GuildCreate,
  async execute(client, guild) {
    await guildConfigService.ensureGuild(guild);
    log.info({ guild: guild.id, name: guild.name }, 'Nouveau serveur');
    // Sécurité : tout ajout du bot à un serveur est signalé dans les serveurs de logs centraux.
    void logHubService.system(client, 'bot.guild_join', (t) => ({
      title: t('loghub.system.guild_join_title'),
      fields: [
        { name: t('loghub.system.server'), value: `${guild.name} (\`${guild.id}\`)`, inline: false },
        { name: t('loghub.system.owner'), value: `<@${guild.ownerId}> (\`${guild.ownerId}\`)`, inline: true },
        { name: t('loghub.system.members'), value: String(guild.memberCount), inline: true },
      ],
    }));
  },
});
