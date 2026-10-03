import express, { type Express, type RequestHandler, type Router } from 'express';
import type { RedemptionClient } from '../src/core/Client';
import type { Env } from '../src/config/env';
import { createFiveMRouter } from '../src/api/fivem';
import { childLogger } from '../src/utils/logger';
import { VIEWS_DIR, PUBLIC_DIR } from './lib/paths';
import { securityHeaders } from './middleware/security';
import { csrfProtection, csrfToken } from './middleware/csrf';
import { viewLocals } from './middleware/locals';
import { notFoundHandler, errorHandler } from './middleware/errors';
import { createRateLimiter } from './lib/rateLimit';
import { createAuthRouter } from './auth/routes';
import { mountRoutes } from './routes';

const log = childLogger('Dashboard');

/** Routeurs d'API sans session (auth par clé gérée dans le routeur). */
const SESSIONLESS_API_PREFIXES = ['/api/fivem', '/api/shop'];
export function isSessionlessApi(path: string): boolean {
  return SESSIONLESS_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Charge `src/api/shop.ts` s'il existe (module optionnel fourni par le module Shop). */
function loadShopRouter(client: RedemptionClient): Router | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../src/api/shop') as { createShopWebhookRouter?: (client: RedemptionClient) => Router };
    if (typeof mod.createShopWebhookRouter === 'function') return mod.createShopWebhookRouter(client);
    return null;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'MODULE_NOT_FOUND') log.warn({ err }, 'Routeur Shop présent mais non chargeable');
    return null;
  }
}

export interface CreateAppOptions {
  env: Env;
  sessionMiddleware: RequestHandler;
}

export function createApp(client: RedemptionClient, { env, sessionMiddleware }: CreateAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  app.set('view engine', 'ejs');
  app.set('views', VIEWS_DIR);
  app.set('view cache', env.NODE_ENV === 'production');
  app.locals.rmWhitespace = false;

  app.use(securityHeaders());
  app.use(express.static(PUBLIC_DIR, { maxAge: env.NODE_ENV === 'production' ? '1d' : 0, index: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 5000 }));

  // API sans session (montées avant la session et le CSRF)
  app.use('/api/fivem', createFiveMRouter(client));
  const shopRouter = loadShopRouter(client);
  if (shopRouter) {
    app.use('/api/shop', shopRouter);
    log.info('Routeur /api/shop monté');
  }

  // Limitation de débit (fenêtre glissante, en mémoire)
  app.use('/auth', createRateLimiter({ windowMs: 5 * 60_000, max: 30, keyGenerator: (req) => req.ip ?? 'unknown' }));
  app.use(
    '/api',
    createRateLimiter({ windowMs: 60_000, max: 120, skip: (req) => isSessionlessApi(req.originalUrl) }),
  );

  app.use(sessionMiddleware);
  app.use(csrfToken());
  app.use(csrfProtection({ ignore: (req) => isSessionlessApi(req.path) }));
  app.use(viewLocals(client));

  app.use('/auth', createAuthRouter(client));
  app.use(mountRoutes(client));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
