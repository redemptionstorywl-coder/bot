import session, { type SessionData } from 'express-session';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../src/database/client';
import { childLogger } from '../../src/utils/logger';

const log = childLogger('SessionStore');
const DEFAULT_TTL_MS = 7 * 24 * 3600_000;

type Callback<T = void> = (err?: unknown, result?: T) => void;

/** Calcule la date d'expiration d'une session : cookie.expires, sinon cookie.maxAge, sinon 7 jours. */
export function computeExpiry(data: Partial<SessionData> | undefined, now = Date.now(), ttlMs = DEFAULT_TTL_MS): Date {
  const cookie = data?.cookie as { expires?: Date | string | null; maxAge?: number | null; originalMaxAge?: number | null } | undefined;
  if (cookie?.expires) {
    const d = new Date(cookie.expires);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const maxAge = cookie?.maxAge ?? cookie?.originalMaxAge;
  if (typeof maxAge === 'number' && maxAge > 0) return new Date(now + maxAge);
  return new Date(now + ttlMs);
}

/**
 * Store express-session persisté dans la table `DashboardSession` (Prisma).
 * Les sessions expirées sont ignorées à la lecture et purgées par la tâche `core:prune-sessions`.
 */
export class PrismaSessionStore extends session.Store {
  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {
    super();
  }

  override get(sid: string, cb: Callback<SessionData | null>): void {
    prisma.dashboardSession
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row) return cb(undefined, null);
        if (row.expiresAt.getTime() <= Date.now()) {
          void prisma.dashboardSession.delete({ where: { sid } }).catch(() => null);
          return cb(undefined, null);
        }
        cb(undefined, row.data as unknown as SessionData);
      })
      .catch((err: unknown) => {
        log.error({ err }, 'Lecture de session impossible');
        cb(err);
      });
  }

  override set(sid: string, data: SessionData, cb?: Callback): void {
    const expiresAt = computeExpiry(data, Date.now(), this.ttlMs);
    const json = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
    prisma.dashboardSession
      .upsert({ where: { sid }, create: { sid, data: json, expiresAt }, update: { data: json, expiresAt } })
      .then(() => cb?.())
      .catch((err: unknown) => {
        log.error({ err }, 'Écriture de session impossible');
        cb?.(err);
      });
  }

  override destroy(sid: string, cb?: Callback): void {
    prisma.dashboardSession
      .deleteMany({ where: { sid } })
      .then(() => cb?.())
      .catch((err: unknown) => cb?.(err));
  }

  override touch(sid: string, data: SessionData, cb?: Callback): void {
    const expiresAt = computeExpiry(data, Date.now(), this.ttlMs);
    prisma.dashboardSession
      .updateMany({ where: { sid }, data: { expiresAt } })
      .then(() => cb?.())
      .catch((err: unknown) => cb?.(err));
  }

  override length(cb: Callback<number>): void {
    prisma.dashboardSession
      .count({ where: { expiresAt: { gt: new Date() } } })
      .then((n) => cb(undefined, n))
      .catch((err: unknown) => cb(err));
  }

  override clear(cb?: Callback): void {
    prisma.dashboardSession
      .deleteMany({})
      .then(() => cb?.())
      .catch((err: unknown) => cb?.(err));
  }
}
