import http from 'node:http';
import type { RedemptionClient } from '../src/core/Client';
import { env } from '../src/config/env';
import { childLogger } from '../src/utils/logger';
import { createApp } from './app';
import { createSessionMiddleware } from './auth/session';
import { createSockets } from './sockets';

const log = childLogger('Dashboard');

export interface DashboardHandle {
  close(): Promise<void>;
}

/**
 * Démarre le dashboard web (Express + EJS + Socket.IO).
 * Ne dépend pas de l'état « ready » du bot : les pages utilisent le cache du client avec garde.
 * Une erreur d'écoute (port occupé…) est journalisée sans interrompre le bot.
 */
export async function startDashboard(client: RedemptionClient): Promise<DashboardHandle> {
  const config = env();
  if (!config.DISCORD_CLIENT_SECRET) log.warn('DISCORD_CLIENT_SECRET absent : la connexion au dashboard affichera la page de configuration');
  if (config.NODE_ENV === 'production' && !config.DASHBOARD_URL.startsWith('https://')) log.warn('En production, DASHBOARD_URL devrait être en https (cookies de session « secure »)');

  const sessionMiddleware = createSessionMiddleware(config);
  const app = createApp(client, { env: config, sessionMiddleware });
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  const sockets = createSockets(server, client, sessionMiddleware);

  const listening = await new Promise<boolean>((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      log.error({ err: err.message, code: err.code, port: config.DASHBOARD_PORT }, 'Le dashboard ne peut pas écouter sur ce port');
      resolve(false);
    };
    server.once('error', onError);
    server.listen(config.DASHBOARD_PORT, () => {
      server.off('error', onError);
      server.on('error', (err) => log.error({ err }, 'Erreur serveur HTTP dashboard'));
      log.info({ port: config.DASHBOARD_PORT, url: config.DASHBOARD_URL, oauthRedirectUri: `${config.DASHBOARD_URL.replace(/\/$/, '')}/auth/callback` }, 'Dashboard démarré — ajoutez oauthRedirectUri dans Developer Portal > OAuth2 > Redirects');
      resolve(true);
    });
  });

  return {
    async close() {
      await sockets.close().catch(() => null);
      if (!listening) return;
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
      log.info('Dashboard arrêté');
    },
  };
}
