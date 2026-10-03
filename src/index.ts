import path from 'node:path';
import { execSync } from 'node:child_process';
import { Events } from 'discord.js';
import { env, maskSecret } from './config/env';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './database/client';
import { RedemptionClient } from './core/Client';
import { loadAll } from './core/loaders';
import { deployCommands } from './core/deploy';
import { scheduler } from './services/SchedulerService';
import { registerCoreTasks } from './core/tasks';
import { ticketService } from './services/TicketService';
import { activityService } from './services/ActivityService';
import { startDashboard } from '../dashboard/server';

async function main(): Promise<void> {
  const config = env();
  logger.info({ env: config.NODE_ENV, clientId: config.CLIENT_ID, token: maskSecret(config.DISCORD_TOKEN) }, 'Démarrage de Redemption Story Bot');

  if (process.env.RUN_MIGRATIONS !== '0') {
    try {
      logger.info('Application des migrations Prisma…');
      execSync('npx prisma migrate deploy', { stdio: 'pipe', cwd: path.resolve(__dirname, '..', '..'), env: process.env });
      logger.info('Migrations à jour');
    } catch (err) {
      const out = (err as { stdout?: Buffer; stderr?: Buffer }).stderr?.toString() || (err as Error).message;
      logger.error({ details: out.split('\n').slice(-5).join(' ') }, 'Migrations non appliquées (RUN_MIGRATIONS=0 pour désactiver)');
    }
  }

  await connectDatabase();

  const client = new RedemptionClient();
  loadAll(client, path.resolve(__dirname));
  registerCoreTasks(client);

  client.once(Events.ClientReady, async () => {
    try {
      await deployCommands(client, { token: config.DISCORD_TOKEN, clientId: config.CLIENT_ID, devGuildId: config.DEV_GUILD_ID || undefined });
    } catch (err) {
      logger.error({ err }, 'Échec du déploiement des commandes');
    }
  });

  await client.login(config.DISCORD_TOKEN);

  const dashboard = await startDashboard(client);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Arrêt en cours…');
    scheduler.stop();
    for (const mod of client.modules.values()) await Promise.resolve(mod.onShutdown?.(client)).catch(() => null);
    // Buffers mémoire (messages de tickets, compteurs d'activité) : écrits en base avant la déconnexion.
    await ticketService.flushMessages().catch((err) => logger.warn({ err }, 'Flush des messages de tickets à l’arrêt'));
    await activityService.flush().catch((err) => logger.warn({ err }, 'Flush de l’activité à l’arrêt'));
    await dashboard.close().catch(() => null);
    client.destroy();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled rejection'));
  process.on('uncaughtException', (err) => logger.fatal({ err }, 'Uncaught exception'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Impossible de démarrer le bot');
  process.exit(1);
});
