import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { matchChannel, matchRole, matchRoles, normalizeName, substituteObject, substitutePlaceholders } from '../../src/services/TemplateService';

const TEXT = 0;
const CATEGORY = 4;
const FORUM = 15;

describe('normalizeName', () => {
  it('retire emojis, séparateurs, accents et majuscules', () => {
    expect(normalizeName('👋・welcome')).toBe('welcome');
    expect(normalizeName('📜・rules')).toBe('rules');
    expect(normalizeName('🛡️ RS Team')).toBe('rsteam');
    expect(normalizeName('🇫🇷・Français')).toBe('francais');
    expect(normalizeName('💬・general-chat')).toBe('generalchat');
    expect(normalizeName('🎫 GENERAL SUPPORT')).toBe('generalsupport');
    expect(normalizeName('staff_tasks')).toBe('stafftasks');
    expect(normalizeName('📢・ankündigungen')).toBe('ankundigungen');
  });
});

describe('matchChannel', () => {
  const channels = [
    { id: '1', name: '👋・welcome', type: TEXT },
    { id: '2', name: '📜・rules', type: TEXT },
    { id: '3', name: '👑 STAFF', type: CATEGORY },
    { id: '4', name: '💡・suggestions', type: FORUM },
    { id: '5', name: '🎫・create-ticket', type: TEXT },
  ];
  it('trouve par synonyme, dans l’ordre de priorité', () => {
    expect(matchChannel(channels, ['bienvenue', 'welcome'])?.id).toBe('1');
    expect(matchChannel(channels, ['reglement', 'règlement', 'rules'])?.id).toBe('2');
    expect(matchChannel(channels, ['tickets', 'create-ticket'])?.id).toBe('5');
  });
  it('respecte le type demandé', () => {
    expect(matchChannel(channels, ['staff'], 'category')?.id).toBe('3');
    expect(matchChannel(channels, ['staff'], 'text')).toBeNull();
    expect(matchChannel(channels, ['suggestions'], 'text')).toBeNull();
    expect(matchChannel(channels, ['suggestions'], 'forum')?.id).toBe('4');
  });
  it('retourne null si rien ne correspond', () => {
    expect(matchChannel(channels, ['giveaways', 'concours'])).toBeNull();
    expect(matchChannel([], ['welcome'])).toBeNull();
  });
});

describe('matchRole(s)', () => {
  const roles = [
    { id: 'r1', name: '👑 GAGYC' },
    { id: 'r2', name: '🛡️ Administrator' },
    { id: 'r3', name: '🎧 Support' },
    { id: 'r4', name: '🛡️ RS Team' },
    { id: 'r5', name: '🧠 Manager' },
  ];
  it('trouve plusieurs rôles sans doublon, ordre des noms', () => {
    expect(matchRoles(roles, ['Support', 'Manager', 'RS Team', '🛡️ RS Team']).map((r) => r.id)).toEqual(['r3', 'r5', 'r4']);
  });
  it('matchRole renvoie le premier ou null', () => {
    expect(matchRole(roles, ['Admin', 'Administrator'])?.id).toBe('r2');
    expect(matchRole(roles, ['Moderator'])).toBeNull();
  });
});

describe('substitutePlaceholders', () => {
  const map = { rules: { id: '200', name: 'rules', type: TEXT }, ticket: null };
  it('remplace par la mention, ou un libellé neutre si absent', () => {
    expect(substitutePlaceholders('Lisez {channel:rules} puis {channel:ticket}', map)).toBe('Lisez <#200> puis #ticket');
    expect(substitutePlaceholders('Pas de placeholder {user}', map)).toBe('Pas de placeholder {user}');
  });
  it('substitueObject parcourt les objets imbriqués', () => {
    const spec = { title: 'x', fields: [{ name: 'a', value: '{channel:rules}' }], footer: { text: '{channel:ticket}' } };
    expect(substituteObject(spec, map)).toEqual({ title: 'x', fields: [{ name: 'a', value: '<#200>' }], footer: { text: '#ticket' } });
  });
});
