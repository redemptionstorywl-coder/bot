import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { HttpError } from '../lib/errors';

export const CSRF_FIELD = '_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Comparaison en temps constant de deux jetons. */
export function verifyCsrfToken(expected: string | undefined, provided: unknown): boolean {
  if (!expected || typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Extrait le jeton fourni par le client (champ caché `_csrf` ou en-tête `x-csrf-token`). */
export function extractCsrfToken(req: Pick<Request, 'body' | 'headers' | 'query'>): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body && typeof body === 'object' ? body[CSRF_FIELD] : undefined;
  if (typeof fromBody === 'string') return fromBody;
  const header = req.headers[CSRF_HEADER];
  if (typeof header === 'string') return header;
  if (Array.isArray(header)) return header[0];
  return undefined;
}

/** Garantit un jeton en session et l'expose à `res.locals.csrfToken`. */
export function csrfToken(): RequestHandler {
  return (req, res, next) => {
    if (req.session) {
      if (!req.session.csrfToken) req.session.csrfToken = generateCsrfToken();
      res.locals.csrfToken = req.session.csrfToken;
    }
    next();
  };
}

export interface CsrfOptions {
  /** Chemins exemptés (API sans session : FiveM, webhooks) */
  ignore?: (req: Request) => boolean;
}

/** Rejette (403) toute mutation sans jeton valide. */
export function csrfProtection(options: CsrfOptions = {}): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (options.ignore?.(req)) return next();
    const expected = req.session?.csrfToken;
    const provided = extractCsrfToken(req);
    if (!verifyCsrfToken(expected, provided)) return next(new HttpError(403, 'Jeton CSRF invalide ou expiré. Rechargez la page puis réessayez.'));
    next();
  };
}
