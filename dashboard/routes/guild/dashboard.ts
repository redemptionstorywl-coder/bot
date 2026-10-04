import { Router } from 'express';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { fivemService } from '../../../src/services/FiveMService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { buildOverview } from '../../lib/stats';
import { logTitle, logIcon, logCategoryLabel } from '../../lib/logs';
import { resolveUserProfiles } from '../../lib/names';
import { groupedModules } from '../../lib/modules';
import { toServerView } from './fivem';

/** GET /guilds/:guildId — vue d'ensemble du serveur. */
export function createGuildDashboardRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  router.get(
    '/',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const [overview, logs, servers] = await Promise.all([
        buildOverview(client, guild, config),
        prisma.log.findMany({ where: { guildId: guild.id }, orderBy: { createdAt: 'desc' }, take: 8 }),
        config.modules.fivem ? fivemService.listServers(guild.id).catch(() => []) : Promise.resolve([]),
      ]);
      const recent = (logs ?? []).map((l) => ({ ...l, title: logTitle(l), icon: logIcon(l.category), categoryLabel: logCategoryLabel(l.category) }));
      const profiles = await resolveUserProfiles(client, guild.id, recent.map((l) => l.actorId));
      render(res, 'dashboard', {
        title: "Vue d'ensemble",
        page: 'dashboard',
        overview,
        logs: recent,
        profiles,
        servers: (servers ?? []).map(toServerView),
        moduleGroups: groupedModules(config.modules),
      });
    }),
  );
  return router;
}
