import type { RedemptionClient } from './Client';
import { scheduler } from '../services/SchedulerService';
import { loggingService } from '../services/LoggingService';
import { prisma } from '../database/client';
import { childLogger } from '../utils/logger';

const log = childLogger('CoreTasks');

/**
 * Tâches de maintenance génériques. Les services métiers enregistrent leurs propres tâches
 * (annonces programmées, giveaways, événements…) via `scheduler.register`.
 */
export function registerCoreTasks(client: RedemptionClient): void {
  scheduler.register({
    name: 'core:cooldowns',
    intervalMs: 60_000,
    async run() {
      client.cooldowns.sweep();
    },
  });
  scheduler.register({
    name: 'core:prune-logs',
    intervalMs: 6 * 3600_000,
    async run() {
      const count = await loggingService.prune(90);
      if (count) log.info({ count }, 'Logs anciens supprimés');
    },
  });
  scheduler.register({
    name: 'core:prune-sessions',
    intervalMs: 3600_000,
    async run() {
      await prisma.dashboardSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    },
  });
}
