import { ActivityType, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { loggingService } from '../services/LoggingService';
import { scheduler } from '../services/SchedulerService';
import { childLogger } from '../utils/logger';

const log = childLogger('Ready');

export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client, readyClient) {
    log.info({ user: readyClient.user.tag, guilds: readyClient.guilds.cache.size }, 'Bot connecté');
    loggingService.attach(client);

    for (const guild of readyClient.guilds.cache.values()) {
      await guildConfigService.ensureGuild(guild).catch((err) => log.error({ err, guild: guild.id }, 'ensureGuild'));
    }

    for (const mod of client.modules.values()) {
      try {
        await mod.onReady?.(client);
      } catch (err) {
        log.error({ err, module: mod.key }, 'Module onReady en erreur');
      }
    }

    scheduler.start();

    const statuses = [
      { name: 'Redemption Story Studio', type: ActivityType.Watching },
      { name: `${readyClient.guilds.cache.size} serveurs`, type: ActivityType.Watching },
      { name: '/help', type: ActivityType.Listening },
    ];
    let i = 0;
    const rotate = () => {
      const s = statuses[i++ % statuses.length]!;
      readyClient.user.setPresence({ activities: [{ name: s.name, type: s.type }], status: 'online' });
    };
    rotate();
    setInterval(rotate, 60_000).unref();
  },
});
