import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { prisma } from '../../src/database/client';
import { WhitelistService, WhitelistError, canReview, parseQuestions } from '../../src/services/WhitelistService';
import { fivemService } from '../../src/services/FiveMService';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const guildId = '123456789012345678';
const userId = '222222222222222222';

function row(over: Record<string, unknown> = {}) {
  return { id: 1, guildId, userId, identifier: 'license:abc', status: 'PENDING', answers: [{ question: 'Q1', answer: 'A1' }], reviewedById: null, reviewedAt: null, note: null, createdAt: new Date(), updatedAt: new Date(), ...over };
}

describe('cycle whitelist', () => {
  let service: WhitelistService;
  beforeEach(() => {
    service = new WhitelistService();
    db.whitelistConfig.findUnique.mockResolvedValue({ guildId, questions: [], reviewChannelId: null, acceptedRoleId: null, pendingRoleId: null, dmOnDecision: true, enabled: true });
    db.log.create.mockResolvedValue({});
    db.guild.findUnique.mockResolvedValue(null);
  });

  it('crée un dossier PENDING', async () => {
    db.whitelist.findFirst.mockResolvedValue(null);
    db.whitelist.create.mockResolvedValue(row());
    const created = await service.apply({ guildId, userId, answers: [{ question: 'Q1', answer: 'A1' }], identifier: 'license:abc' });
    expect(created.status).toBe('PENDING');
    expect(db.whitelist.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guildId, userId, status: 'PENDING', identifier: 'license:abc' }) }));
  });

  it('refuse un second dossier en attente ou déjà accepté', async () => {
    db.whitelist.findFirst.mockResolvedValueOnce(row());
    await expect(service.apply({ guildId, userId, answers: [] })).rejects.toMatchObject({ code: 'already_pending' });
    db.whitelist.findFirst.mockResolvedValueOnce(row({ status: 'ACCEPTED' }));
    await expect(service.apply({ guildId, userId, answers: [] })).rejects.toMatchObject({ code: 'already_accepted' });
  });

  it('refuse quand les candidatures sont fermées', async () => {
    db.whitelistConfig.findUnique.mockResolvedValue({ guildId, questions: [], reviewChannelId: null, acceptedRoleId: null, pendingRoleId: null, dmOnDecision: true, enabled: false });
    await expect(service.apply({ guildId, userId, answers: [] })).rejects.toBeInstanceOf(WhitelistError);
  });

  it('accepte un dossier et notifie FiveM', async () => {
    const emit = vi.spyOn(fivemService, 'emitToGuild').mockResolvedValue(1);
    db.whitelist.findUnique.mockResolvedValue(row());
    db.whitelist.update.mockResolvedValue(row({ status: 'ACCEPTED', reviewedById: '333333333333333333', reviewedAt: new Date() }));
    const reviewed = await service.review({ guildId, id: 1, reviewerId: '333333333333333333', decision: 'ACCEPTED' });
    expect(reviewed.status).toBe('ACCEPTED');
    expect(emit).toHaveBeenCalledWith(guildId, 'whitelist:updated', expect.objectContaining({ discordId: userId, identifier: 'license:abc', status: 'ACCEPTED' }));
  });

  it('refuse de retraiter un dossier déjà tranché', async () => {
    db.whitelist.findUnique.mockResolvedValue(row({ status: 'REJECTED' }));
    await expect(service.review({ guildId, id: 1, reviewerId: 'x', decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'already_reviewed' });
    db.whitelist.findUnique.mockResolvedValue(null);
    await expect(service.review({ guildId, id: 99, reviewerId: 'x', decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('répond à la vérification FiveM', async () => {
    db.whitelist.findFirst.mockResolvedValueOnce(row({ status: 'ACCEPTED' }));
    expect(await service.check(guildId, 'license:abc')).toEqual({ whitelisted: true, status: 'ACCEPTED', discordId: userId });
    db.whitelist.findFirst.mockResolvedValueOnce(null);
    expect(await service.check(guildId, 'license:zzz')).toEqual({ whitelisted: false, status: null, discordId: null });
    db.whitelist.findFirst.mockResolvedValueOnce(row({ status: 'PENDING' }));
    const byDiscord = await service.check(guildId, `discord:${userId}`);
    expect(byDiscord.whitelisted).toBe(false);
    expect(db.whitelist.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { guildId, userId } }));
  });

  it('fonctions pures', () => {
    expect(canReview('PENDING')).toBe(true);
    expect(canReview('ACCEPTED')).toBe(false);
    expect(parseQuestions([{ id: 'q1', label: 'Nom' }])).toEqual([{ id: 'q1', label: 'Nom', required: true, style: 'paragraph' }]);
    expect(parseQuestions('garbage')).toEqual([]);
  });
});
