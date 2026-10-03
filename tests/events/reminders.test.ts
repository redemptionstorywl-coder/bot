import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { dueReminders, effectiveEndsAt } from '../../src/services/EventService';

const MIN = 60_000;
const start = new Date('2025-06-01T20:00:00Z');
const base = { startsAt: start, reminderOffsets: [1440, 60, 30, 10, 5], remindersSent: [] as number[], status: 'SCHEDULED' as const };

describe('dueReminders', () => {
  it('ne retourne rien bien avant le premier rappel', () => {
    expect(dueReminders(base, start.getTime() - 2000 * MIN)).toEqual([]);
  });

  it('retourne le rappel J-1 exactement à son heure', () => {
    expect(dueReminders(base, start.getTime() - 1440 * MIN)).toEqual([1440]);
  });

  it('retourne tous les rappels passés non envoyés, du plus grand au plus petit', () => {
    expect(dueReminders(base, start.getTime() - 8 * MIN)).toEqual([1440, 60, 30, 10]);
  });

  it('exclut les rappels déjà envoyés', () => {
    expect(dueReminders({ ...base, remindersSent: [1440, 60] }, start.getTime() - 20 * MIN)).toEqual([30]);
  });

  it('ne retourne rien une fois l’événement commencé', () => {
    expect(dueReminders(base, start.getTime())).toEqual([]);
    expect(dueReminders(base, start.getTime() + MIN)).toEqual([]);
  });

  it('ignore les événements non programmés', () => {
    expect(dueReminders({ ...base, status: 'CANCELLED' }, start.getTime() - 5 * MIN)).toEqual([]);
    expect(dueReminders({ ...base, status: 'ONGOING' }, start.getTime() - 5 * MIN)).toEqual([]);
  });

  it('utilise les offsets par défaut si la configuration est vide ou invalide', () => {
    expect(dueReminders({ ...base, reminderOffsets: [] }, start.getTime() - 5 * MIN)).toEqual([1440, 60, 30, 10, 5]);
    expect(dueReminders({ ...base, reminderOffsets: 'oops' }, start.getTime() - 61 * MIN)).toEqual([1440]);
  });

  it('accepte une Date comme instant courant et dédoublonne les offsets', () => {
    expect(dueReminders({ ...base, reminderOffsets: [10, 10, 5] }, new Date(start.getTime() - 3 * MIN))).toEqual([10, 5]);
  });
});

describe('effectiveEndsAt', () => {
  it('utilise endsAt si défini, sinon startsAt + 2 h', () => {
    const ends = new Date(start.getTime() + 30 * MIN);
    expect(effectiveEndsAt({ startsAt: start, endsAt: ends })).toEqual(ends);
    expect(effectiveEndsAt({ startsAt: start, endsAt: null })).toEqual(new Date(start.getTime() + 120 * MIN));
  });
});
