import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../src/core/Client';
import { env } from '../../src/config/env';
import { render } from '../lib/render';
import { wrap } from '../lib/async';
import { validate, valid } from '../lib/validate';
import { HttpError } from '../lib/errors';
import { flash } from '../lib/flash';
import { buildAuthorizeUrl, exchangeCode, fetchGuilds, fetchUser, revokeToken, type OAuthConfig } from './oauth';
import { childLogger } from '../../src/utils/logger';

const log = childLogger('DashboardOAuth');

export function oauthConfig(): OAuthConfig | null {
  const cfg = env();
  if (!cfg.DISCORD_CLIENT_SECRET) return null;
  return { clientId: cfg.CLIENT_ID, clientSecret: cfg.DISCORD_CLIENT_SECRET, redirectUri: `${cfg.DASHBOARD_URL.replace(/\/$/, '')}/auth/callback` };
}

const callbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(128).optional(),
  error_description: z.string().max(512).optional(),
});

export function createAuthRouter(_client: RedemptionClient): Router {
  const router = Router();

  router.get('/login', (req, res) => {
    const cfg = oauthConfig();
    if (!cfg) {
      render(res, 'config-missing', { title: 'Configuration requise', page: 'login', redirectUri: `${env().DASHBOARD_URL.replace(/\/$/, '')}/auth/callback` });
      return;
    }
    if (req.session.user) return res.redirect('/guilds');
    const state = crypto.randomBytes(24).toString('base64url');
    req.session.oauthState = state;
    req.session.save(() => res.redirect(buildAuthorizeUrl(cfg, state)));
  });

  router.get(
    '/callback',
    validate({ query: callbackQuery }),
    wrap(async (req, res) => {
      const cfg = oauthConfig();
      if (!cfg) return res.redirect('/auth/login');
      const { query } = valid<unknown, z.infer<typeof callbackQuery>>(req);
      const expectedState = req.session.oauthState;
      delete req.session.oauthState;
      if (query.error) {
        log.warn({ error: query.error }, 'Connexion Discord refusée');
        flash(req, 'error', query.error === 'access_denied' ? 'Connexion annulée : vous avez refusé l’autorisation.' : `Discord a renvoyé une erreur (${query.error}).`);
        return res.redirect('/');
      }
      if (!query.code || !query.state || !expectedState || query.state !== expectedState) {
        throw new HttpError(400, 'État OAuth2 invalide : recommencez la connexion.');
      }
      const token = await exchangeCode(cfg, query.code);
      const [user, guilds] = await Promise.all([fetchUser(token.access_token), fetchGuilds(token.access_token)]);
      const returnTo = req.session.returnTo;
      await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
      req.session.user = user;
      req.session.guilds = guilds;
      req.session.accessToken = token.access_token;
      req.session.fetchedAt = Date.now();
      flash(req, 'success', `Bienvenue, ${user.globalName ?? user.username} !`);
      log.info({ userId: user.id, guilds: guilds.length }, 'Connexion dashboard');
      req.session.save(() => res.redirect(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/guilds'));
    }),
  );

  router.post(
    '/logout',
    wrap(async (req, res) => {
      const cfg = oauthConfig();
      const token = req.session.accessToken;
      if (cfg && token) void revokeToken(cfg, token);
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      res.clearCookie('rss.sid');
      res.redirect('/');
    }),
  );

  return router;
}
