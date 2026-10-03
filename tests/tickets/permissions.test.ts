import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { canCloseTicket, canManageTicket, canViewTicket, parseQuestions, ticketService } from '../../src/services/TicketService';
import { parseUserId } from '../../src/commands/tickets/_shared';
import { parseQuestionLine, serializeQuestion } from '../../src/commands/tickets/_configPanel';

const open = { userId: 'creator', status: 'OPEN' as const };
const claimed = { userId: 'creator', status: 'CLAIMED' as const };
const closed = { userId: 'creator', status: 'CLOSED' as const };
const deleted = { userId: 'creator', status: 'DELETED' as const };

describe('Permissions de fermeture', () => {
  it('le créateur peut fermer son ticket ouvert', () => {
    expect(canCloseTicket(open, { userId: 'creator', staff: false })).toBe(true);
    expect(canCloseTicket(claimed, { userId: 'creator', staff: false })).toBe(true);
  });
  it('le staff peut fermer tout ticket ouvert', () => {
    expect(canCloseTicket(open, { userId: 'mod', staff: true })).toBe(true);
  });
  it('un autre membre ne peut pas fermer', () => {
    expect(canCloseTicket(open, { userId: 'random', staff: false })).toBe(false);
  });
  it('un ticket déjà fermé ou supprimé ne peut pas être refermé', () => {
    expect(canCloseTicket(closed, { userId: 'creator', staff: false })).toBe(false);
    expect(canCloseTicket(closed, { userId: 'mod', staff: true })).toBe(false);
    expect(canCloseTicket(deleted, { userId: 'mod', staff: true })).toBe(false);
  });
});

describe('Permissions de gestion / consultation', () => {
  it('claim/add/remove/transfer/delete = staff uniquement', () => {
    expect(canManageTicket(open, { userId: 'creator', staff: false })).toBe(false);
    expect(canManageTicket(open, { userId: 'mod', staff: true })).toBe(true);
    expect(canManageTicket(deleted, { userId: 'mod', staff: true })).toBe(false);
  });
  it('transcript/réouverture = créateur ou staff, jamais sur un ticket supprimé', () => {
    expect(canViewTicket(closed, { userId: 'creator', staff: false })).toBe(true);
    expect(canViewTicket(closed, { userId: 'random', staff: false })).toBe(false);
    expect(canViewTicket(closed, { userId: 'mod', staff: true })).toBe(true);
    expect(canViewTicket(deleted, { userId: 'creator', staff: false })).toBe(false);
  });
});

describe('Boutons de contrôle', () => {
  const t = (key: string) => key;
  it('propose les actions de gestion sur un ticket ouvert', () => {
    const rows = ticketService.buildControls({ id: 5, status: 'OPEN', claimedById: null }, t);
    const ids = rows.flatMap((r) => r.components.map((c) => (c.toJSON() as { custom_id: string }).custom_id));
    expect(ids).toEqual(['ticket:close:5', 'ticket:claim:5', 'ticket:transcript:5', 'ticket:add:5', 'ticket:remove:5', 'ticket:transfer:5', 'ticket:delete:5']);
  });
  it('désactive le claim une fois pris en charge', () => {
    const rows = ticketService.buildControls({ id: 5, status: 'CLAIMED', claimedById: 'mod' }, t);
    const claim = rows[0]!.components[1]!.toJSON() as { disabled?: boolean };
    expect(claim.disabled).toBe(true);
  });
  it('propose réouverture / transcript / suppression sur un ticket fermé', () => {
    const rows = ticketService.buildControls({ id: 5, status: 'CLOSED', claimedById: null }, t);
    const ids = rows.flatMap((r) => r.components.map((c) => (c.toJSON() as { custom_id: string }).custom_id));
    expect(ids).toEqual(['ticket:reopen:5', 'ticket:transcript:5', 'ticket:delete:5']);
    expect(ticketService.buildControls({ id: 5, status: 'DELETED', claimedById: null }, t)).toEqual([]);
  });
});

describe('Helpers', () => {
  it('parseUserId accepte ID et mention', () => {
    expect(parseUserId('123456789012345678')).toBe('123456789012345678');
    expect(parseUserId('<@123456789012345678>')).toBe('123456789012345678');
    expect(parseUserId('<@!123456789012345678>')).toBe('123456789012345678');
    expect(parseUserId('bob')).toBeNull();
  });
  it('parseQuestions ignore les entrées invalides et limite à 5', () => {
    const qs = parseQuestions([{ id: 'a', label: 'A' }, { bad: true }, ...Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, label: `Q${i}` }))]);
    expect(qs).toHaveLength(5);
    expect(qs[0]).toMatchObject({ id: 'a', label: 'A', style: 'short', required: true });
  });
  it('parseQuestionLine / serializeQuestion sont cohérents', () => {
    const q = parseQuestionLine('Pseudo en jeu | Ex: John | short | required | 32', 1)!;
    expect(q).toMatchObject({ id: 'q1', label: 'Pseudo en jeu', placeholder: 'Ex: John', style: 'short', required: true, maxLength: 32 });
    expect(serializeQuestion(q)).toBe('Pseudo en jeu | Ex: John | short | required | 32');
    expect(parseQuestionLine('Détails | | paragraph | optional', 2)).toMatchObject({ style: 'paragraph', required: false });
    expect(parseQuestionLine('   ', 3)).toBeNull();
    expect(() => parseQuestionLine('X | | short | required | 99999', 4)).toThrow();
  });
});
