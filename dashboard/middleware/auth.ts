import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { env } from '../../src/config/env';
import { guildConfigService } from '../../src/services/GuildConfigService';
import { HttpError } from '../lib/errors';
import { hasGuildAccess, isDiscordId } from '../lib/access';
import { describeGuild, getBotGuild, botGuildIds } from '../lib/guildData';
import { wantsJson } from '../lib/rateLimit';
import { fetchGuilds, GUILDS_TTL_MS } from '../auth/oauth';
import { childLogger } from '../../src/utils/logger';

const log = childLogger('DashboardAuth');

/** Rafraîchit la liste des serveurs de l'utilisateur si elle date de plus de 10 minutes. */
export async function refreshGuildsIfStale(req: Request): Promise<void> {
  const s = req.session;
  if (!s?.user || !s.accessToken) return;
  if (s.fetchedAt && Date.now() - s.fetchedAt < GUILDS_TTL_MS) return;
  try {
    s.guilds = await fetchGuilds(s.accessToken);
    s.fetchedAt = Date.now();
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      await new Promise<void>((resolve) => s.destroy(() => resolve()));
      throw new HttpError(401, 'Votre session Discord a expiré, veuillez vous reconnecter.');
    }
    // Discord injoignable : on garde la liste connue et on réessaie plus tard
    s.fetchedAt = Date.now() - GUILDS_TTL_MS + 60_000;
    log.warn({ err }, 'Rafraîchissement des serveurs impossible');
  }
}

/** Exige une session connectée. Redirige vers /auth/login (ou 401 JSON pour l'API). */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session?.user) {
    if (wantsJson(req)) return next(new HttpError(401, 'Connexion requise.'));
    if (req.method === 'GET') req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  refreshGuildsIfStale(req)
    .then(() => next())
    .catch(next);
};

/** Exige un propriétaire du bot (OWNER_IDS). */
export const requireOwner: RequestHandler = (req, _res, next) => {
  const user = req.session?.user;
  if (!user) return next(new HttpError(401, 'Connexion requise.'));
  if (!env().OWNER_IDS.includes(user.id)) return next(new HttpError(403, 'Cette page est réservée aux propriétaires du bot.'));
  next();
};

/**
 * Exige l'accès au serveur `:guildId` (voir lib/access.ts) et attache
 * `res.locals.guild` (vue Discord) et `res.locals.config` (configuration résolue).
 */
export function requireGuildAccess(client: RedemptionClient): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const user = req.session?.user;
      if (!user) throw new HttpError(401, 'Connexion requise.');
      const guildId = req.params.guildId;
      if (!isDiscordId(guildId)) throw new HttpError(400, 'Identifiant de serveur invalide.');
      if (!client.isReady()) throw new HttpError(503, 'Le bot est en cours de démarrage, réessayez dans quelques secondes.');
      if (!hasGuildAccess(req.session.guilds, guildId, user.id, env().OWNER_IDS, botGuildIds(client))) {
        throw new HttpError(403, "Vous n'avez pas accès à la gestion de ce serveur (le bot doit y être présent et vous devez être administrateur).");
      }
      const guild = getBotGuild(client, guildId);
      if (!guild) throw new HttpError(404, 'Serveur introuvable.');
      res.locals.guild = describeGuild(guild);
      res.locals.config = (await guildConfigService.get(guildId)) ?? (await guildConfigService.getOrCreate(guild));
    })()
      .then(() => next())
      .catch(next);
  };
}
