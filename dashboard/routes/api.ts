import { Router } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { requireAuth, requireGuildAccess } from '../middleware/auth';
import { wrap } from '../lib/async';
import { buildOverview } from '../lib/stats';
import { toggleModuleHandler } from './guild/modules';

/**
 * API JSON du dashboard (session + CSRF) : /api/guilds/:guildId/…
 * Les routeurs sans session (FiveM, Shop) sont montés séparément dans app.ts.
 */
export function createApiRouter(client: RedemptionClient): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/me', (req, res) => {
    const { user } = req.session;
    res.json({ user, guilds: (req.session.guilds ?? []).map((g) => ({ id: g.id, name: g.name, owner: g.owner })) });
  });

  const guild = Router({ mergeParams: true });
  guild.use(requireGuildAccess(client));
  guild.get(
    '/overview',
    wrap(async (_req, res) => {
      res.json(await buildOverview(client, res.locals.guild!, res.locals.config!));
    }),
  );
  guild.get('/channels', (_req, res) => {
    const g = res.locals.guild!;
    res.json({ text: g.textChannels, voice: g.voiceChannels, forums: g.forums, categories: g.categories });
  });
  guild.get('/roles', (_req, res) => {
    res.json({ roles: res.locals.guild!.roles });
  });
  guild.get('/config', (_req, res) => {
    const c = res.locals.config!;
    res.json({ guildId: c.guildId, kind: c.kind, defaultLanguage: c.defaultLanguage, enabledLanguages: c.enabledLanguages, modules: c.modules, translationMode: c.translationMode, logChannels: c.logChannels, brandColor: c.brandColor });
  });
  guild.post('/modules/:key', toggleModuleHandler(client));
  router.use('/guilds/:guildId', guild);

  return router;
}
