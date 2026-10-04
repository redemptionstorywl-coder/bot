import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { isReminderDue, waitingSince, ticketSettingsSchema, type ReminderState } from '../../src/services/TicketReminderService';

const H = 3_600_000;
const created = new Date('2026-01-01T00:00:00Z');
const at = (h: number) => new Date(created.getTime() + h * H);
const state = (p: Partial<ReminderState> = {}): ReminderState => ({ createdAt: created, lastStaffReplyAt: null, lastMemberMessageAt: null, lastReminderAt: null, remindersMuted: false, ...p });

describe('isReminderDue', () => {
  it('relance un ticket sans réponse du staff après le délai', () => {
    expect(isReminderDue(state(), at(23), 24)).toBe(false);
    expect(isReminderDue(state(), at(24), 24)).toBe(true);
  });
  it('ne relance jamais un ticket permanent', () => {
    expect(isReminderDue(state({ remindersMuted: true }), at(100), 24)).toBe(false);
  });
  it('ne relance pas quand le staff a parlé en dernier (ticket en attente du membre)', () => {
    expect(isReminderDue(state({ lastMemberMessageAt: at(1), lastStaffReplyAt: at(2) }), at(200), 24)).toBe(false);
  });
  it('relance quand le membre a répondu après le staff et que 24 h sont passées depuis la réponse staff', () => {
    const s = state({ lastStaffReplyAt: at(2), lastMemberMessageAt: at(3) });
    expect(isReminderDue(s, at(25), 24)).toBe(false);
    expect(isReminderDue(s, at(26), 24)).toBe(true);
  });
  it('attend un nouveau délai après une relance', () => {
    const s = state({ lastReminderAt: at(24) });
    expect(isReminderDue(s, at(30), 24)).toBe(false);
    expect(isReminderDue(s, at(48), 24)).toBe(true);
  });
});

describe('waitingSince', () => {
  it('part du dernier message membre après la réponse staff', () => {
    expect(waitingSince(state({ lastStaffReplyAt: at(2), lastMemberMessageAt: at(5) }))).toEqual(at(5));
  });
  it('part de la création sinon', () => expect(waitingSince(state())).toEqual(created));
});

describe('ticketSettingsSchema', () => {
  it('borne le délai entre 1 et 168 h', () => {
    expect(ticketSettingsSchema.safeParse({ reminderHours: 0 }).success).toBe(false);
    expect(ticketSettingsSchema.safeParse({ reminderHours: 169 }).success).toBe(false);
    expect(ticketSettingsSchema.safeParse({ reminderHours: 24, reminderPing: 'staff' }).success).toBe(true);
  });
});
