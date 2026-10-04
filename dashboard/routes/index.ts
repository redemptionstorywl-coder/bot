import { Router } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { requireAuth, requireGuildAccess } from '../middleware/auth';
import { createHomeRouter } from './home';
import { createGuildsRouter } from './guilds';
import { createAdminRouter } from './admin';
import { createApiRouter } from './api';
import { createGuildDashboardRouter } from './guild/dashboard';
import { createSettingsRouter } from './guild/settings';
import { createLogsRouter } from './guild/logs';
import { createMembersRouter } from './guild/members';
import { createTicketsRouter } from './guild/tickets';
import { createEmbedsRouter } from './guild/embeds';
import { createAnnouncementsRouter } from './guild/announcements';
import { createWelcomeRouter } from './guild/welcome';
import { createRolesRouter } from './guild/roles';
import { createReactionRolesRouter } from './guild/reactionroles';
import { createModerationRouter } from './guild/moderation';
import { createGiveawaysRouter } from './guild/giveaways';
import { createEventsRouter } from './guild/events';
import { createFiveMRouter } from './guild/fivem';
import { createWhitelistRouter } from './guild/whitelist';
import { createBattleRoyaleRouter } from './guild/battleroyale';
import { createSchoolRouter } from './guild/school';
import { createShopRouter } from './guild/shop';
import { createComingRouter } from './guild/coming';

/**
 * Point de montage de toutes les routes.
 *
 * Pour ajouter une page de module : créer routes/guild/<module>.ts exportant
 * `create<Module>Router(client): Router` (Router({ mergeParams: true })) et l'ajouter
 * dans `guildRouters` ci-dessous AVANT `createComingRouter` (qui sert les pages génériques).
 */
export function mountRoutes(client: RedemptionClient): Router {
  const root = Router();

  root.use('/', createHomeRouter(client));
  root.use('/guilds', createGuildsRouter(client));
  root.use('/admin', createAdminRouter(client));
  root.use('/api', createApiRouter(client));

  const guildScoped = Router({ mergeParams: true });
  guildScoped.use(requireAuth, requireGuildAccess(client));
  const guildRouters = [
    createGuildDashboardRouter,
    createSettingsRouter,
    createLogsRouter,
    createMembersRouter,
    createTicketsRouter,
    createEmbedsRouter,
    createAnnouncementsRouter,
    createWelcomeRouter,
    createRolesRouter,
    createReactionRolesRouter,
    createModerationRouter,
    createGiveawaysRouter,
    createEventsRouter,
    createFiveMRouter,
    createWhitelistRouter,
    createBattleRoyaleRouter,
    createSchoolRouter,
    createShopRouter,
    // ↑ les routeurs des modules métier s'insèrent ici (avant createComingRouter)
    createComingRouter,
  ];
  for (const factory of guildRouters) guildScoped.use('/', factory(client));
  root.use('/guilds/:guildId', guildScoped);

  return root;
}
