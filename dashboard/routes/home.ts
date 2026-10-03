import { Router } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { render } from '../lib/render';
import { MODULE_KEYS } from '../../src/config/constants';

/** GET / — landing (non connecté) ou redirection vers la liste des serveurs. */
export function createHomeRouter(client: RedemptionClient): Router {
  const router = Router();
  router.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/guilds');
    const ready = client.isReady();
    render(res, 'landing', {
      title: 'Accueil',
      page: 'home',
      stats: {
        guilds: ready ? client.guilds.cache.size : 0,
        members: ready ? client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0) : 0,
        modules: MODULE_KEYS.length,
        commands: client.commands.size,
      },
    });
  });
  return router;
}
