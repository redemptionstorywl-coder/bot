import type { Request, Response } from 'express';
import { statusTitle } from './errors';

export interface RenderData {
  /** Titre de l'onglet / en-tête de page */
  title?: string;
  /** Clé de navigation active (NAVIGATION[].key) */
  page?: string;
  [key: string]: unknown;
}

/**
 * Rend `views/pages/<page>.ejs` à l'intérieur du layout `views/layouts/main.ejs`.
 * Aucune dépendance express-ejs-layouts : la page est rendue en premier puis injectée dans `body`.
 *
 *   render(res, 'settings', { title: 'Paramètres', page: 'settings', ...data });
 */
export function render(res: Response, view: string, data: RenderData = {}): void {
  const req = res.req as Request;
  const options: Record<string, unknown> = { ...data };
  if (data.page && !res.locals.page) res.locals.page = data.page;
  res.render(`pages/${view}`, options, (err, body) => {
    if (err) return req.next?.(err);
    res.render('layouts/main', { ...options, body, view }, (layoutErr, html) => {
      if (layoutErr) return req.next?.(layoutErr);
      res.send(html);
    });
  });
}

/** Page d'erreur stylée (dans le layout si possible, sinon HTML minimal). */
export function renderError(res: Response, status: number, message: string, details?: string[]): void {
  res.status(status);
  const options = { title: statusTitle(status), page: 'error', status, message, details: details ?? [], statusTitle: statusTitle(status) };
  res.render('pages/error', options, (err, body) => {
    if (err) return fallback();
    res.render('layouts/main', { ...options, body, view: 'error' }, (layoutErr, html) => {
      if (layoutErr) return fallback();
      res.send(html);
    });
  });
  function fallback(): void {
    const safe = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
    res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${status} — ${safe(statusTitle(status))}</title><link rel="stylesheet" href="/css/app.css"></head><body class="error-fallback"><main class="error-page"><h1>${status}</h1><p>${safe(message)}</p><a class="btn btn-primary" href="/">Retour à l'accueil</a></main></body></html>`);
  }
}
