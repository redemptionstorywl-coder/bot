import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma } from '../../src/database/client';
import { TicketError, ticketService } from '../../src/services/TicketService';

const mock = prisma as unknown as ReturnType<typeof createPrismaMock>;
const type = { id: 7, maxPerUser: 1, enabled: true };

describe('TicketService — maxPerUser', () => {
  beforeEach(() => {
    mock.$transaction = vi.fn() as never;
  });

  it('autorise l’ouverture sous la limite', async () => {
    mock.ticket.count.mockResolvedValue(0);
    await expect(ticketService.assertCanOpen('g1', 'u1', type)).resolves.toBeUndefined();
    expect(mock.ticket.count).toHaveBeenCalledWith({ where: { guildId: 'g1', userId: 'u1', typeId: 7, status: { in: ['OPEN', 'CLAIMED'] } } });
  });

  it('refuse quand la limite est atteinte', async () => {
    mock.ticket.count.mockResolvedValue(1);
    const err = await ticketService.assertCanOpen('g1', 'u1', type).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TicketError);
    expect((err as TicketError).code).toBe('max_per_user');
    expect((err as TicketError).vars).toEqual({ count: 1, max: 1 });
  });

  it('respecte une limite supérieure à 1', async () => {
    mock.ticket.count.mockResolvedValue(2);
    await expect(ticketService.assertCanOpen('g1', 'u1', { ...type, maxPerUser: 3 })).resolves.toBeUndefined();
    mock.ticket.count.mockResolvedValue(3);
    await expect(ticketService.assertCanOpen('g1', 'u1', { ...type, maxPerUser: 3 })).rejects.toMatchObject({ code: 'max_per_user' });
  });

  it('refuse un type désactivé', async () => {
    await expect(ticketService.assertCanOpen('g1', 'u1', { ...type, enabled: false })).rejects.toMatchObject({ code: 'type_disabled' });
  });

  it('openTicket refuse avant toute réservation de numéro', async () => {
    mock.ticket.count.mockResolvedValue(1);
    const fakeType = { ...type, guildId: 'g1', key: 'support', label: 'Support', language: null, nameFormat: 'ticket-{number}' } as never;
    const fakeGuild = { id: 'g1' } as never;
    const fakeMember = { id: 'u1', user: { username: 'john', tag: 'john' } } as never;
    await expect(ticketService.openTicket({ guild: fakeGuild, member: fakeMember, type: fakeType, answers: [], lang: 'fr', config: null })).rejects.toMatchObject({ code: 'max_per_user' });
    expect(mock.$transaction).not.toHaveBeenCalled();
  });
});
