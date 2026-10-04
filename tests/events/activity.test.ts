import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma } from '../../src/database/client';
import { ActivityService } from '../../src/services/ActivityService';

const prismaMock = prisma as unknown as ReturnType<typeof createPrismaMock>;

describe('ActivityService', () => {
  let service: ActivityService;

  beforeEach(() => {
    service = new ActivityService();
    prismaMock.messageActivity.upsert.mockImplementation(async (args: unknown) => args);
    prismaMock.messageActivity.findUnique.mockResolvedValue(null);
  });

  it('incrémente en mémoire sans toucher la base', () => {
    service.increment('g1', 'u1');
    service.increment('g1', 'u1');
    service.increment('g1', 'u2');
    expect(service.getPending('g1', 'u1')).toBe(2);
    expect(service.getPending('g1', 'u2')).toBe(1);
    expect(service.pendingSize).toBe(2);
    expect(prismaMock.messageActivity.upsert).not.toHaveBeenCalled();
    expect(prismaMock.messageActivity.findUnique).not.toHaveBeenCalled();
  });

  it('flush : un upsert incrémental par couple serveur/utilisateur, puis buffer vidé', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    service.increment('g1', 'u1', at);
    service.increment('g1', 'u1', at);
    service.increment('g1', 'u1', at);
    service.increment('g2', 'u1', at);

    const written = await service.flush();
    expect(written).toBe(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.messageActivity.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.messageActivity.upsert).toHaveBeenCalledWith({
      where: { guildId_userId: { guildId: 'g1', userId: 'u1' } },
      create: { guildId: 'g1', userId: 'u1', count: 3, lastAt: at },
      update: { count: { increment: 3 }, lastAt: at },
    });
    expect(service.pendingSize).toBe(0);
    expect(await service.flush()).toBe(0);
  });

  it('flush concurrent (arrêt pendant la tâche planifiée) : attend l’écriture en cours puis écrit le reste', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    prismaMock.$transaction.mockImplementationOnce(async (ops: Promise<unknown>[]) => {
      await gate;
      return Promise.all(ops);
    });
    service.increment('g1', 'u1');
    const first = service.flush();
    service.increment('g1', 'u2'); // reçu pendant l'écriture
    let secondDone = false;
    const second = service.flush().then((n) => {
      secondDone = true;
      return n;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(secondDone).toBe(false); // ne rend pas la main pendant l'écriture en cours
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(service.pendingSize).toBe(0);
    expect(prismaMock.messageActivity.upsert).toHaveBeenCalledTimes(2);
  });

  it('flush : réinjecte les compteurs en cas d’erreur base', async () => {
    service.increment('g1', 'u1');
    service.increment('g1', 'u1');
    prismaMock.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(service.flush()).rejects.toThrow('db down');
    expect(service.getPending('g1', 'u1')).toBe(2);
    // Flush suivant OK
    await expect(service.flush()).resolves.toBe(1);
    expect(service.pendingSize).toBe(0);
  });

  it('getCount = base + mémoire, avec cache de la valeur en base', async () => {
    prismaMock.messageActivity.findUnique.mockResolvedValueOnce({ guildId: 'g1', userId: 'u1', count: 40, lastAt: new Date() });
    service.increment('g1', 'u1');
    service.increment('g1', 'u1');
    expect(await service.getCount('g1', 'u1')).toBe(42);
    service.increment('g1', 'u1');
    expect(await service.getCount('g1', 'u1')).toBe(43);
    expect(prismaMock.messageActivity.findUnique).toHaveBeenCalledTimes(1);
    expect(await service.getCount('g1', 'inconnu')).toBe(0);
  });

  it('découpe les gros flushs en lots de 50', async () => {
    for (let i = 0; i < 120; i++) service.increment('g1', `u${i}`);
    await service.flush();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(prismaMock.messageActivity.upsert).toHaveBeenCalledTimes(120);
  });
});
