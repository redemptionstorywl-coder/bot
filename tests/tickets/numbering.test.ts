import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma } from '../../src/database/client';
import { ticketService } from '../../src/services/TicketService';

const mock = prisma as unknown as ReturnType<typeof createPrismaMock>;

describe('TicketService — numérotation atomique', () => {
  let counter = 0;

  beforeEach(() => {
    counter = 0;
    mock.$transaction = vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(mock) : Promise.all(arg as Promise<unknown>[]))) as never;
    mock.ticketCounter.upsert.mockImplementation(async (args: { where: { guildId: string } }) => ({ guildId: args.where.guildId, value: ++counter }));
    mock.ticket.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: counter, ...args.data }));
  });

  it('réserve des numéros séquentiels dans une transaction', async () => {
    const a = await ticketService.reserveTicket({ guildId: 'g1', typeId: 1, userId: 'u1', formAnswers: [] });
    const b = await ticketService.reserveTicket({ guildId: 'g1', typeId: 1, userId: 'u2', formAnswers: [] });
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(mock.$transaction).toHaveBeenCalledTimes(2);
    expect(typeof (mock.$transaction as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('function');
  });

  it('incrémente le compteur côté base (upsert + increment) et crée le ticket dans la même transaction', async () => {
    await ticketService.reserveTicket({ guildId: 'g1', typeId: 2, userId: 'u1', formAnswers: [{ question: 'Q', answer: 'A' }], language: 'fr' });
    expect(mock.ticketCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { guildId: 'g1' }, create: { guildId: 'g1', value: 1 }, update: { value: { increment: 1 } } }),
    );
    expect(mock.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ guildId: 'g1', number: 1, typeId: 2, userId: 'u1', status: 'OPEN', language: 'fr', formAnswers: [{ question: 'Q', answer: 'A' }] }) }),
    );
  });

  it('des réservations concurrentes obtiennent des numéros distincts', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => ticketService.reserveTicket({ guildId: 'g1', typeId: 1, userId: `u${i}`, formAnswers: [] })));
    const numbers = results.map((r) => r.number).sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(numbers).size).toBe(5);
  });

  it('construit un nom de salon valide depuis le format du type', () => {
    expect(ticketService.buildChannelName({ nameFormat: 'ticket-{number}', key: 'support' }, 12, 'John')).toBe('ticket-12');
    expect(ticketService.buildChannelName({ nameFormat: '{type}-{username}-{number}', key: 'bug' }, 3, 'Jöhn Dóe!')).toBe('bug-john-doe-3');
  });
});
