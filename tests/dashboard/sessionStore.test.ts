import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { prisma as mockedPrisma } from '../../src/database/client';
import { PrismaSessionStore, computeExpiry } from '../../dashboard/auth/PrismaSessionStore';

const prisma = mockedPrisma as unknown as ReturnType<typeof createPrismaMock>;

const DAY = 24 * 3600_000;

function call<T>(fn: (cb: (err?: unknown, result?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((err, result) => (err ? reject(err) : resolve(result))));
}

describe('computeExpiry', () => {
  const now = Date.UTC(2026, 0, 1);
  it('utilise cookie.expires en priorité', () => {
    const expires = new Date(now + 3 * DAY);
    expect(computeExpiry({ cookie: { expires, maxAge: 1000 } as never }, now).getTime()).toBe(expires.getTime());
  });
  it('utilise cookie.maxAge sinon', () => {
    expect(computeExpiry({ cookie: { maxAge: 2 * DAY } as never }, now).getTime()).toBe(now + 2 * DAY);
    expect(computeExpiry({ cookie: { originalMaxAge: DAY } as never }, now).getTime()).toBe(now + DAY);
  });
  it('retombe sur 7 jours', () => {
    expect(computeExpiry(undefined, now).getTime()).toBe(now + 7 * DAY);
    expect(computeExpiry({ cookie: {} as never }, now).getTime()).toBe(now + 7 * DAY);
    expect(computeExpiry({ cookie: { expires: 'invalid' } as never }, now).getTime()).toBe(now + 7 * DAY);
  });
});

describe('PrismaSessionStore', () => {
  const store = new PrismaSessionStore();
  beforeEach(() => {
    prisma.dashboardSession.findUnique.mockReset();
    prisma.dashboardSession.upsert.mockReset().mockResolvedValue({});
    prisma.dashboardSession.deleteMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.dashboardSession.updateMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.dashboardSession.delete.mockReset().mockResolvedValue({});
  });

  it('get renvoie null si absent', async () => {
    prisma.dashboardSession.findUnique.mockResolvedValue(null);
    expect(await call((cb) => store.get('sid-1', cb))).toBeNull();
    expect(prisma.dashboardSession.findUnique).toHaveBeenCalledWith({ where: { sid: 'sid-1' } });
  });

  it('get renvoie les données d’une session valide', async () => {
    const data = { cookie: { maxAge: DAY }, user: { id: '1' } };
    prisma.dashboardSession.findUnique.mockResolvedValue({ sid: 'sid-1', data, expiresAt: new Date(Date.now() + DAY) });
    expect(await call((cb) => store.get('sid-1', cb))).toEqual(data);
  });

  it('get ignore et supprime une session expirée', async () => {
    prisma.dashboardSession.findUnique.mockResolvedValue({ sid: 'sid-1', data: {}, expiresAt: new Date(Date.now() - 1000) });
    expect(await call((cb) => store.get('sid-1', cb))).toBeNull();
    expect(prisma.dashboardSession.delete).toHaveBeenCalledWith({ where: { sid: 'sid-1' } });
  });

  it('get transmet les erreurs', async () => {
    prisma.dashboardSession.findUnique.mockRejectedValue(new Error('db down'));
    await expect(call((cb) => store.get('sid-1', cb))).rejects.toThrow('db down');
  });

  it('set upsert la session avec une expiration dérivée du cookie', async () => {
    const before = Date.now();
    await call((cb) => store.set('sid-2', { cookie: { maxAge: 2 * DAY } as never, user: { id: '42' } } as never, cb));
    const arg = prisma.dashboardSession.upsert.mock.calls[0][0] as { where: { sid: string }; create: { sid: string; data: unknown; expiresAt: Date }; update: { expiresAt: Date } };
    expect(arg.where).toEqual({ sid: 'sid-2' });
    expect(arg.create.sid).toBe('sid-2');
    expect((arg.create.data as { user: { id: string } }).user.id).toBe('42');
    expect(arg.create.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 2 * DAY - 50);
    expect(arg.update.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 2 * DAY + 50);
  });

  it('set utilise 7 jours par défaut', async () => {
    const before = Date.now();
    await call((cb) => store.set('sid-3', { cookie: {} as never } as never, cb));
    const arg = prisma.dashboardSession.upsert.mock.calls[0][0] as { create: { expiresAt: Date } };
    expect(arg.create.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY - 50);
  });

  it('destroy supprime la session', async () => {
    await call((cb) => store.destroy('sid-4', cb));
    expect(prisma.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { sid: 'sid-4' } });
  });

  it('touch prolonge l’expiration', async () => {
    await call((cb) => store.touch('sid-5', { cookie: { maxAge: DAY } as never } as never, cb));
    const arg = prisma.dashboardSession.updateMany.mock.calls[0][0] as { where: { sid: string }; data: { expiresAt: Date } };
    expect(arg.where).toEqual({ sid: 'sid-5' });
    expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now() + DAY - 1000);
  });

  it('set transmet les erreurs', async () => {
    prisma.dashboardSession.upsert.mockRejectedValue(new Error('write failed'));
    await expect(call((cb) => store.set('sid-6', { cookie: {} as never } as never, cb))).rejects.toThrow('write failed');
  });
});
