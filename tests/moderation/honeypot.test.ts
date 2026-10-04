import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { decideHoneypot, HONEYPOT_DESCRIPTION, HONEYPOT_TITLE } from '../../src/services/HoneypotService';

const base = { channelId: 'trap', trapChannelId: 'trap', isBot: false, isWebhook: false, isSystem: false, isStaff: false };

describe('decideHoneypot', () => {
  it('piège un membre ordinaire', () => expect(decideHoneypot(base)).toBe('trap'));
  it('ignore les autres salons et l’absence de configuration', () => {
    expect(decideHoneypot({ ...base, channelId: 'general' })).toBe('ignore');
    expect(decideHoneypot({ ...base, trapChannelId: null })).toBe('ignore');
  });
  it('ignore bots, webhooks et messages système', () => {
    expect(decideHoneypot({ ...base, isBot: true })).toBe('ignore');
    expect(decideHoneypot({ ...base, isWebhook: true })).toBe('ignore');
    expect(decideHoneypot({ ...base, isSystem: true })).toBe('ignore');
  });
  it('ne sanctionne pas le staff', () => expect(decideHoneypot({ ...base, isStaff: true })).toBe('staff'));
  it('affiche le texte d’avertissement fourni', () => {
    expect(HONEYPOT_TITLE).toBe('⛔ DO NOT SEND MESSAGES HERE');
    expect(HONEYPOT_DESCRIPTION).toContain('automated anti-spam trap');
    expect(HONEYPOT_DESCRIPTION).toContain('you will be kicked from the server');
  });
});
