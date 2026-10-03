import { Router } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { env } from '../../src/config/env';
import { render } from '../lib/render';
import { requireAuth } from '../middleware/auth';
import { manageableGuilds } from '../lib/access';
import { guildIconUrl } from '../lib/format';
import { buildBotInviteUrl } from '../auth/oauth';

/** GET /guilds — cartes des serveurs gérables (Gérer / Inviter). */
export function createGuildsRouter(client: RedemptionClient): Router {
  const router = Router();
  router.get('/', requireAuth, (req, res) => {
    const user = req.session.user!;
    const cfg = env();
    const ready = client.isReady();
    const cards = manageableGuilds(req.session.guilds, user.id, cfg.OWNER_IDS)
      .map((g) => {
        const botGuild = ready ? client.guilds.cache.get(g.id) : undefined;
        return {
          id: g.id,
          name: g.name,
          iconUrl: guildIconUrl(g.id, g.icon),
          owner: g.owner,
          botPresent: Boolean(botGuild),
          memberCount: botGuild?.memberCount ?? null,
          inviteUrl: buildBotInviteUrl(cfg.CLIENT_ID, g.id),
        };
      })
      .sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
    render(res, 'guilds', { title: 'Serveurs', page: 'guilds', cards, botReady: ready });
  });
  return router;
}
