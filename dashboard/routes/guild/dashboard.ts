import { Router } from 'express';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { buildOverview } from '../../lib/stats';

/** GET /guilds/:guildId — tableau de bord du serveur. */
export function createGuildDashboardRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  router.get(
    '/',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const [overview, logs] = await Promise.all([buildOverview(client, guild, config), prisma.log.findMany({ where: { guildId: guild.id }, orderBy: { createdAt: 'desc' }, take: 10 })]);
      render(res, 'dashboard', { title: 'Dashboard', page: 'dashboard', overview, logs });
    }),
  );
  return router;
}
