import fs from 'node:fs';
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
import { ticketReminderService } from './services/TicketReminderService';
import { activityService } from './services/ActivityService';
import { logHubService } from './services/LogHubService';
import { logDispatchService } from './services/LogDispatchService';
import { BRAND } from './config/constants';
import { startDashboard } from '../dashboard/server';

/**
 * Racine du projet (dossier contenant prisma/schema.prisma) : `__dirname` vaut src/ en développement (tsx)
 * et dist/src/ une fois compilé — un chemin relatif fixe pointait hors du projet en `npm run dev`.
 */
function projectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'prisma', 'schema.prisma'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

async function main(): Promise<void> {
  const config = env();
  logger.info({ env: config.NODE_ENV, clientId: config.CLIENT_ID, token: maskSecret(config.DISCORD_TOKEN) }, 'Démarrage de Redemption Story Bot');

  // scripts/start.js applique déjà les migrations (et pose RUN_MIGRATIONS=0) ; SKIP_MIGRATIONS=1 les désactive partout.
  if (process.env.RUN_MIGRATIONS !== '0' && process.env.SKIP_MIGRATIONS !== '1') {
    try {
      logger.info('Application des migrations Prisma…');
      execSync('npx prisma migrate deploy', { stdio: 'pipe', cwd: projectRoot(), env: process.env });
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
      const count = await deployCommands(client, { token: config.DISCORD_TOKEN, clientId: config.CLIENT_ID, devGuildId: config.DEV_GUILD_ID || undefined });
      void logHubService.system(client, 'bot.deploy', (t) => ({ title: t('loghub.system.deploy_title'), description: t(config.DEV_GUILD_ID ? 'loghub.system.deploy_dev' : 'loghub.system.deploy_global', { count }) }));
    } catch (err) {
      logger.error({ err }, 'Échec du déploiement des commandes');
      void logHubService.system(client, 'bot.error', (t) => ({ title: t('loghub.system.deploy_failed_title'), description: String((err as Error)?.message ?? err).slice(0, 1500), color: BRAND.colors.danger }), 'deploy');
    }
  });

  await client.login(config.DISCORD_TOKEN);

  const dashboard = await startDashboard(client);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Arrêt en cours…');
    scheduler.stop();
    for (const mod of client.modules.values()) await Promise.resolve(mod.onShutdown?.(client)).catch(() => null);
    // Buffers mémoire (messages de tickets, compteurs d'activité) : écrits en base avant la déconnexion.
    await ticketService.flushMessages().catch((err) => logger.warn({ err }, 'Flush des messages de tickets à l’arrêt'));
    await ticketReminderService.flushActivity().catch((err) => logger.warn({ err }, 'Flush de l’activité des tickets à l’arrêt'));
    await activityService.flush().catch((err) => logger.warn({ err }, 'Flush de l’activité à l’arrêt'));
    // Logs en attente (file groupée) : envoyés avant la déconnexion.
    await logDispatchService.drain().catch((err) => logger.warn({ err }, 'Envoi des logs en attente à l’arrêt'));
    await dashboard.close().catch(() => null);
    client.destroy();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
    const message = (reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)).slice(0, 1500);
    void logHubService.system(client, 'bot.error', (t) => ({ title: t('loghub.system.error_title'), description: `\`\`\`\n${message}\n\`\`\``, color: BRAND.colors.danger }), `rejection:${message.slice(0, 120)}`);
  });
  process.on('uncaughtException', (err) => logger.fatal({ err }, 'Uncaught exception'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Impossible de démarrer le bot');
  process.exit(1);
});
