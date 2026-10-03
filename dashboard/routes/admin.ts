import { Router } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { prisma } from '../../src/database/client';
import { translationService } from '../../src/services/TranslationService';
import { guildConfigService } from '../../src/services/GuildConfigService';
import { scheduler } from '../../src/services/SchedulerService';
import { MODULE_KEYS, GUILD_KIND_LABELS, type ModuleKey } from '../../src/config/constants';
import { render } from '../lib/render';
import { wrap } from '../lib/async';
import { flash } from '../lib/flash';
import { requireAuth, requireOwner } from '../middleware/auth';
import { guildIconUrl } from '../lib/format';

/** GET /admin — vue globale (OWNER_IDS). */
export function createAdminRouter(client: RedemptionClient): Router {
  const router = Router();
  router.use(requireAuth, requireOwner);

  router.get(
    '/',
    wrap(async (_req, res) => {
      const ready = client.isReady();
      const [guilds, users, sessions, logs] = await Promise.all([
        prisma.guild.findMany({ include: { settings: true }, orderBy: { name: 'asc' } }),
        prisma.user.count(),
        prisma.dashboardSession.count({ where: { expiresAt: { gt: new Date() } } }),
        prisma.log.count(),
      ]);
      const rows = await Promise.all(
        guilds.map(async (g) => {
          const live = ready ? client.guilds.cache.get(g.id) : undefined;
          const config = await guildConfigService.get(g.id);
          const active = config ? (Object.keys(config.modules) as ModuleKey[]).filter((k) => config.modules[k]) : [];
          return {
            id: g.id,
            name: live?.name ?? g.name,
            iconUrl: live?.iconURL({ size: 64 }) ?? guildIconUrl(g.id, g.icon, 64),
            kind: g.kind,
            kindLabel: GUILD_KIND_LABELS[g.kind],
            present: Boolean(live),
            leftAt: g.leftAt,
            memberCount: live?.memberCount ?? null,
            modulesActive: active.length,
            modulesTotal: MODULE_KEYS.length,
            defaultLanguage: config?.defaultLanguage ?? g.settings?.defaultLanguage ?? 'fr',
            joinedAt: g.joinedAt,
          };
        }),
      );
      render(res, 'admin', {
        title: 'Administration',
        page: 'admin',
        rows,
        totals: {
          guildsDb: guilds.length,
          guildsLive: ready ? client.guilds.cache.size : 0,
          members: ready ? client.guilds.cache.reduce((a, g) => a + g.memberCount, 0) : 0,
          users,
          sessions,
          logs,
          commands: client.commands.size,
          uptimeSeconds: client.uptimeSeconds,
          pingMs: ready ? Math.round(client.ws.ping) : -1,
          languages: translationService.availableLanguages,
          tasks: scheduler.registered,
          node: process.version,
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
      });
    }),
  );

  router.post(
    '/reload-locales',
    wrap(async (req, res) => {
      translationService.loadLocales();
      for (const id of client.guilds.cache.keys()) translationService.invalidateGuild(id);
      flash(req, 'success', `Fichiers de langue rechargés (${translationService.availableLanguages.length} langues).`);
      res.redirect('/admin');
    }),
  );

  router.post(
    '/invalidate-configs',
    wrap(async (req, res) => {
      for (const id of client.guilds.cache.keys()) guildConfigService.invalidate(id);
      flash(req, 'success', 'Caches de configuration vidés.');
      res.redirect('/admin');
    }),
  );

  return router;
}
