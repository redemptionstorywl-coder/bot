import { describe, expect, it, vi } from 'vitest';
import type { ModalSubmitInteraction } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { MAX_TYPE_QUESTIONS, TICKET_TITLE_MAX, planOpenModal, slugifyTicketTitle, uniqueChannelName } from '../../src/services/tickets/title';
import { buildOpenModal, readOpenFields } from '../../src/commands/tickets/_shared';
import { ticketService, type TicketQuestion } from '../../src/services/TicketService';

const t = (key: string) => key;
const type = { id: 7, key: 'support', label: 'Support', emoji: '🎫', nameFormat: 'ticket-{number}' } as never;
const q = (i: number, style: 'short' | 'paragraph' = 'short'): TicketQuestion => ({ id: `q${i}`, label: `Question ${i}`, style, required: true });

type Input = { custom_id: string; required?: boolean; max_length?: number; style: number; label: string };
const inputs = (modal: ReturnType<typeof buildOpenModal>) => modal.toJSON().components.map((row) => (row as unknown as { components: Input[] }).components[0]!);

describe('slugifyTicketTitle — titre → nom de salon Discord', () => {
  it('minuscules, espaces → tirets, accents et emojis conservés', () => {
    expect(slugifyTicketTitle('Problème de connexion 🔌')).toBe('problème-de-connexion-🔌');
    expect(slugifyTicketTitle('  Hello   World  ')).toBe('hello-world');
    expect(slugifyTicketTitle('🇫🇷 Drapeau')).toBe('🇫🇷-drapeau');
  });
  it('retire les caractères interdits et fusionne les tirets', () => {
    expect(slugifyTicketTitle('Ça marche pas / bug #12 !!')).toBe('ça-marche-pas-bug-12');
    expect(slugifyTicketTitle('"Remboursement" <boutique>')).toBe('remboursement-boutique');
  });
  it('100 caractères maximum, sans couper un emoji', () => {
    expect(slugifyTicketTitle('a'.repeat(150))).toHaveLength(100);
    const name = slugifyTicketTitle(`${'a'.repeat(99)}😀`)!;
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('\uD83D')).toBe(false);
  });
  it('titre vide après nettoyage → null (repli sur le format de la raison)', () => {
    expect(slugifyTicketTitle('???')).toBeNull();
    expect(slugifyTicketTitle('---')).toBeNull();
    expect(slugifyTicketTitle('   ')).toBeNull();
  });
});

describe('uniqueChannelName / ticketChannelName', () => {
  it('suffixe -<numéro> uniquement si le nom est déjà pris', () => {
    expect(uniqueChannelName('bug-boutique', ['general'], 12)).toBe('bug-boutique');
    expect(uniqueChannelName('bug-boutique', ['bug-boutique'], 12)).toBe('bug-boutique-12');
    expect(uniqueChannelName('a'.repeat(100), ['a'.repeat(100)], 123)).toHaveLength(100);
  });
  it('titre utilisable → slug ; sinon format de la raison', () => {
    expect(ticketService.ticketChannelName({ type, number: 42, username: 'john', title: 'Bug boutique', taken: [] })).toBe('bug-boutique');
    expect(ticketService.ticketChannelName({ type, number: 42, username: 'john', title: 'Bug boutique', taken: ['bug-boutique'] })).toBe('bug-boutique-42');
    expect(ticketService.ticketChannelName({ type, number: 42, username: 'john', title: '!!!', taken: [] })).toBe('ticket-42');
    expect(ticketService.ticketChannelName({ type, number: 42, username: 'john', title: null, taken: [] })).toBe('ticket-42');
  });
});

describe('Formulaire d’ouverture (5 champs max)', () => {
  it('planOpenModal : titre + questions + message s’il reste une place', () => {
    expect(planOpenModal([])).toEqual({ questions: [], message: true, dropped: 0 });
    expect(planOpenModal([q(1), q(2), q(3)])).toEqual({ questions: [q(1), q(2), q(3)], message: true, dropped: 0 });
    expect(planOpenModal([q(1), q(2), q(3), q(4)])).toEqual({ questions: [q(1), q(2), q(3), q(4)], message: false, dropped: 0 });
    expect(planOpenModal([q(1), q(2), q(3), q(4), q(5)])).toMatchObject({ message: false, dropped: 1 });
    expect(MAX_TYPE_QUESTIONS).toBe(4);
  });

  it('sans question : titre obligatoire (50 car.) puis message facultatif', () => {
    const modal = buildOpenModal(type, [], t);
    expect(modal.toJSON().custom_id).toBe('ticket:open:7');
    const fields = inputs(modal);
    expect(fields.map((f) => f.custom_id)).toEqual(['title', 'message']);
    expect(fields[0]).toMatchObject({ required: true, max_length: TICKET_TITLE_MAX, style: 1, label: 'tickets.open.modal_title_label' });
    expect(fields[1]).toMatchObject({ required: false, style: 2 });
  });

  it('questions existantes de la raison : le titre passe en premier, ≤ 5 champs', () => {
    const one = inputs(buildOpenModal(type, [q(1, 'paragraph')], t));
    expect(one.map((f) => f.custom_id)).toEqual(['title', 'q_q1', 'message']);
    const four = inputs(buildOpenModal(type, [q(1), q(2), q(3), q(4)], t));
    expect(four.map((f) => f.custom_id)).toEqual(['title', 'q_q1', 'q_q2', 'q_q3', 'q_q4']);
    const five = inputs(buildOpenModal(type, [q(1), q(2), q(3), q(4), q(5)], t));
    expect(five).toHaveLength(5);
    expect(five[0]!.custom_id).toBe('title');
  });

  it('readOpenFields : titre et message nettoyés, message absent → null', () => {
    const values: Record<string, string> = { title: '  Bug boutique  ', message: '   ' };
    const interaction = {
      fields: {
        getTextInputValue: (id: string) => {
          if (!(id in values)) throw new Error('champ absent');
          return values[id]!;
        },
      },
    } as unknown as ModalSubmitInteraction;
    expect(readOpenFields(interaction)).toEqual({ title: 'Bug boutique', message: null });
    values.message = 'Mon achat n’est pas arrivé';
    expect(readOpenFields(interaction).message).toBe('Mon achat n’est pas arrivé');
    delete values.message;
    expect(readOpenFields(interaction).message).toBeNull();
  });
});
