import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { prisma } from '../../src/database/client';
const prismaMock = prisma as unknown as ReturnType<typeof createPrismaMock>;

import { Prisma } from '@prisma/client';
import { ModerationService } from '../../src/services/ModerationService';

describe('ModerationService.createSanction — numérotation des cases', () => {
  beforeEach(() => {
    prismaMock.sanction.aggregate.mockReset();
    prismaMock.sanction.create.mockReset();
  });

  it('attribue max(caseNumber)+1 dans une transaction', async () => {
    const svc = new ModerationService();
    prismaMock.sanction.aggregate.mockResolvedValue({ _max: { caseNumber: 41 } });
    prismaMock.sanction.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data, createdAt: new Date() }));
    const s = await svc.createSanction({ guildId: 'g1', type: 'WARN', userId: 'u1', moderatorId: 'm1', reason: 'Spam' });
    expect(s.caseNumber).toBe(42);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.sanction.aggregate).toHaveBeenCalledWith({ where: { guildId: 'g1' }, _max: { caseNumber: true } });
    expect(prismaMock.sanction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guildId: 'g1', caseNumber: 42, type: 'WARN', reason: 'Spam' }) }));
  });

  it('commence à 1 pour un serveur sans sanction', async () => {
    const svc = new ModerationService();
    prismaMock.sanction.aggregate.mockResolvedValue({ _max: { caseNumber: null } });
    prismaMock.sanction.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data, createdAt: new Date() }));
    const s = await svc.createSanction({ guildId: 'g2', type: 'KICK', userId: 'u1', moderatorId: 'm1' });
    expect(s.caseNumber).toBe(1);
  });

  it('réessaie en cas de collision sur l’index unique (P2002)', async () => {
    const svc = new ModerationService();
    prismaMock.sanction.aggregate.mockResolvedValueOnce({ _max: { caseNumber: 7 } }).mockResolvedValueOnce({ _max: { caseNumber: 8 } });
    prismaMock.sanction.create
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }))
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ id: 2, ...data, createdAt: new Date() }));
    const s = await svc.createSanction({ guildId: 'g1', type: 'BAN', userId: 'u1', moderatorId: 'm1' });
    expect(s.caseNumber).toBe(9);
    expect(prismaMock.sanction.create).toHaveBeenCalledTimes(2);
  });

  it('propage les autres erreurs sans réessayer', async () => {
    const svc = new ModerationService();
    prismaMock.sanction.aggregate.mockResolvedValue({ _max: { caseNumber: 1 } });
    prismaMock.sanction.create.mockRejectedValue(new Error('boom'));
    await expect(svc.createSanction({ guildId: 'g1', type: 'BAN', userId: 'u1', moderatorId: 'm1' })).rejects.toThrow('boom');
    expect(prismaMock.sanction.create).toHaveBeenCalledTimes(1);
  });
});
