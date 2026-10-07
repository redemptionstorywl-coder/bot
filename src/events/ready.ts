import { ActivityType, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { loggingService } from '../services/LoggingService';
import { logHubService } from '../services/LogHubService';
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

    // Serveurs de logs centraux : « bot démarré » dans 🤖・bot-système
    const commit = (process.env.RENDER_GIT_COMMIT ?? process.env.SOURCE_VERSION ?? '').slice(0, 7);
    void logHubService.system(client, 'bot.startup', (t) => ({
      title: t('loghub.system.startup_title'),
      fields: [
        { name: t('loghub.system.guilds'), value: String(readyClient.guilds.cache.size), inline: true },
        { name: 'Node.js', value: process.version, inline: true },
        ...(commit ? [{ name: t('loghub.system.commit'), value: `\`${commit}\``, inline: true }] : []),
      ],
    }));

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
    // Rotation du statut via le scheduler central (pas de setInterval ad hoc).
    if (!scheduler.registered.includes('core:presence')) scheduler.register({ name: 'core:presence', intervalMs: 60_000, run: async () => rotate() });
  },
});
