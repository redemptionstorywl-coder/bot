import type { Request, RequestHandler, Response } from 'express';

export interface RateLimitOptions {
  /** Fenêtre glissante en millisecondes */
  windowMs: number;
  /** Nombre maximal de requêtes dans la fenêtre */
  max: number;
  /** Clé d'identification (par défaut IP + utilisateur de session) */
  keyGenerator?: (req: Request) => string;
  /** Requêtes exemptées */
  skip?: (req: Request) => boolean;
  /** Réponse personnalisée */
  onLimit?: (req: Request, res: Response, retryAfterSec: number) => void;
}

/**
 * Limiteur de débit en mémoire à fenêtre glissante (horodatages par clé).
 * `check()` est exposé pour les tests ; `middleware()` pour Express.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly windowMs: number, private readonly max: number) {
    this.timer = setInterval(() => this.prune(), Math.max(windowMs, 30_000));
    this.timer.unref?.();
  }

  /** Enregistre un hit et indique s'il est autorisé. */
  check(key: string, now = Date.now()): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, list[0] + this.windowMs - now) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, remaining: this.max - list.length, retryAfterMs: 0 };
  }

  prune(now = Date.now()): void {
    const from = now - this.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > from);
      if (kept.length) this.hits.set(key, kept);
      else this.hits.delete(key);
    }
  }

  reset(): void {
    this.hits.clear();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

function defaultKey(req: Request): string {
  const user = req.session?.user?.id;
  return `${req.ip ?? 'unknown'}${user ? `:${user}` : ''}`;
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler & { limiter: SlidingWindowRateLimiter } {
  const limiter = new SlidingWindowRateLimiter(options.windowMs, options.max);
  const handler: RequestHandler = (req, res, next) => {
    if (options.skip?.(req)) return next();
    const key = (options.keyGenerator ?? defaultKey)(req);
    const result = limiter.check(key);
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (result.allowed) return next();
    const retryAfter = Math.ceil(result.retryAfterMs / 1000) || 1;
    res.setHeader('Retry-After', String(retryAfter));
    if (options.onLimit) return options.onLimit(req, res, retryAfter);
    if (wantsJson(req)) return res.status(429).json({ error: 'Trop de requêtes, réessayez plus tard.', retryAfter });
    return res.status(429).type('text/plain').send('Trop de requêtes, réessayez plus tard.');
  };
  return Object.assign(handler, { limiter });
}

/** Vrai si la requête attend du JSON (API, fetch) plutôt qu'une page HTML. */
export function wantsJson(req: Request): boolean {
  if (req.path.startsWith('/api/')) return true;
  if (req.xhr) return true;
  const accept = req.headers.accept ?? '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  return req.is('application/json') === 'application/json';
}
