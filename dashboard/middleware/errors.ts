import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../lib/errors';
import { renderError } from '../lib/render';
import { wantsJson } from '../lib/rateLimit';
import { childLogger } from '../../src/utils/logger';

const log = childLogger('Dashboard');

export const notFoundHandler: RequestHandler = (req, res) => {
  if (wantsJson(req)) {
    res.status(404).json({ error: 'Ressource introuvable.' });
    return;
  }
  renderError(res, 404, "La page demandée n'existe pas ou a été déplacée.");
};

/** Gestionnaire d'erreurs final : jamais de stack trace renvoyée au client. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isHttp = err instanceof HttpError;
  const bodyParserError = typeof err === 'object' && err !== null && 'type' in err && typeof (err as { type: unknown }).type === 'string';
  let status = isHttp ? err.status : 500;
  let message = isHttp ? err.message : 'Une erreur interne est survenue. Réessayez plus tard.';
  let details = isHttp ? (err.details ?? []) : [];
  if (!isHttp && bodyParserError) {
    const type = (err as { type: string }).type;
    if (type === 'entity.parse.failed') (status = 400), (message = 'Corps de requête illisible (JSON invalide).');
    else if (type === 'entity.too.large') (status = 413), (message = 'Requête trop volumineuse.');
    else if (type === 'parameters.too.many') (status = 413), (message = 'Trop de champs dans le formulaire.');
    details = [];
  }
  if (status >= 500) log.error({ err, path: req.originalUrl, method: req.method }, 'Erreur dashboard');
  else log.debug({ status, message, path: req.originalUrl }, 'Réponse erreur dashboard');

  if (res.headersSent) return;
  if (wantsJson(req)) {
    res.status(status).json({ error: message, ...(details.length ? { details } : {}) });
    return;
  }
  if (status === 401 && req.method === 'GET' && req.session) {
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/login');
    return;
  }
  renderError(res, status, message, details);
};
