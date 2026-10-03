import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { prisma } from '../../src/database/client';
import { SchoolService, SchoolError, sortHouses, hasCapacity, parseAnswers } from '../../src/services/SchoolService';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const guildId = '123456789012345678';

describe('fonctions pures School', () => {
  it('classe les maisons par points puis nom', () => {
    const sorted = sortHouses([{ name: 'B', points: 10 }, { name: 'A', points: 10 }, { name: 'C', points: 50 }]);
    expect(sorted.map((h) => h.name)).toEqual(['C', 'A', 'B']);
  });
  it('capacité', () => {
    expect(hasCapacity(null, 999)).toBe(true);
    expect(hasCapacity(20, 19)).toBe(true);
    expect(hasCapacity(20, 20)).toBe(false);
  });
  it('parse les réponses', () => {
    expect(parseAnswers([{ question: 'Q', answer: 'A' }])).toHaveLength(1);
    expect(parseAnswers(null)).toEqual([]);
  });
});

describe('SchoolService', () => {
  const service = new SchoolService();
  beforeEach(() => {
    db.log.create.mockResolvedValue({});
    db.guild.findUnique.mockResolvedValue(null);
    db.schoolConfig.findUnique.mockResolvedValue(null);
  });
  it('inscrit un profil une seule fois', async () => {
    db.schoolProfile.findUnique.mockResolvedValueOnce(null);
    db.schoolProfile.create.mockResolvedValue({ id: 1, guildId, userId: 'u', firstName: 'Jean', lastName: 'Valjean', role: 'STUDENT', class: null, house: null, clubs: [] });
    const p = await service.register({ guildId, userId: 'u', firstName: ' Jean ', lastName: 'Valjean' });
    expect(p.firstName).toBe('Jean');
    expect(db.schoolProfile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ firstName: 'Jean', role: 'STUDENT' }) }));
    db.schoolProfile.findUnique.mockResolvedValueOnce({ id: 1 });
    await expect(service.register({ guildId, userId: 'u', firstName: 'a', lastName: 'b' })).rejects.toMatchObject({ code: 'profile_exists' });
  });
  it('refuse de rejoindre un club complet ou déjà rejoint', async () => {
    db.schoolProfile.findUnique.mockResolvedValue({ id: 1, guildId, userId: 'u', clubs: [{ clubId: 5 }], class: null, house: null });
    db.schoolClub.findFirst.mockResolvedValue({ id: 5, guildId, name: 'Échecs', roleId: null, maxMembers: 10, _count: { members: 3 } });
    await expect(service.joinClub(guildId, 'u', 5)).rejects.toMatchObject({ code: 'already_member' });
    db.schoolProfile.findUnique.mockResolvedValue({ id: 1, guildId, userId: 'u', clubs: [], class: null, house: null });
    db.schoolClub.findFirst.mockResolvedValue({ id: 5, guildId, name: 'Échecs', roleId: null, maxMembers: 3, _count: { members: 3 } });
    await expect(service.joinClub(guildId, 'u', 5)).rejects.toMatchObject({ code: 'club_full' });
  });
  it('ajoute et retire des points sans passer sous zéro', async () => {
    db.schoolHouse.findFirst.mockResolvedValue({ id: 2, guildId, name: 'Rouge', emoji: null, points: 5 });
    db.schoolHouse.update.mockImplementation(async ({ data }: { data: { points: number } }) => ({ id: 2, guildId, name: 'Rouge', emoji: null, points: data.points }));
    expect((await service.addHousePoints(guildId, 2, 10, 'staff')).points).toBe(15);
    expect((await service.addHousePoints(guildId, 2, -50, 'staff')).points).toBe(0);
    db.schoolHouse.findFirst.mockResolvedValue(null);
    await expect(service.addHousePoints(guildId, 9, 1, 'staff')).rejects.toBeInstanceOf(SchoolError);
  });
  it('ne tranche une candidature qu’une fois', async () => {
    db.schoolApplication.findUnique.mockResolvedValue({ id: 3, guildId, userId: 'u', role: 'TEACHER', status: 'ACCEPTED' });
    await expect(service.reviewApplication({ guildId, id: 3, reviewerId: 's', decision: 'REJECTED' })).rejects.toMatchObject({ code: 'already_reviewed' });
    db.schoolApplication.findUnique.mockResolvedValue({ id: 3, guildId, userId: 'u', role: 'TEACHER', status: 'PENDING', answers: [], createdAt: new Date() });
    db.schoolApplication.update.mockResolvedValue({ id: 3, guildId, userId: 'u', role: 'TEACHER', status: 'ACCEPTED', note: null, answers: [], createdAt: new Date() });
    const app = await service.reviewApplication({ guildId, id: 3, reviewerId: 's', decision: 'ACCEPTED' });
    expect(app.status).toBe('ACCEPTED');
    expect(db.schoolProfile.updateMany).toHaveBeenCalledWith({ where: { guildId, userId: 'u' }, data: { role: 'TEACHER' } });
  });
});
