import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { computeSelection, computeToggle, displayEmoji, emojiMatches, parseEmojiInput, parseRoleMenuOptions, DEFAULT_NOTIFICATIONS } from '../../src/services/RoleService';

const MENU = ['100000000000000001', '100000000000000002', '100000000000000003'];

describe('computeToggle (role menu)', () => {
  it('ajoute un rôle absent', () => {
    expect(computeToggle([], MENU[0]!, MENU, false)).toEqual({ add: [MENU[0]], remove: [], action: 'added' });
  });
  it('retire un rôle présent', () => {
    expect(computeToggle([MENU[0]!, 'other'], MENU[0]!, MENU, false)).toEqual({ add: [], remove: [MENU[0]], action: 'removed' });
  });
  it('mode exclusif : retire les autres rôles du menu uniquement', () => {
    const r = computeToggle([MENU[1]!, MENU[2]!, 'unrelated'], MENU[0]!, MENU, true);
    expect(r.action).toBe('added');
    expect(r.add).toEqual([MENU[0]]);
    expect(r.remove.sort()).toEqual([MENU[1], MENU[2]].sort());
    expect(r.remove).not.toContain('unrelated');
  });
  it('mode exclusif : retirer le rôle actif ne touche à rien d’autre', () => {
    expect(computeToggle([MENU[0]!], MENU[0]!, MENU, true)).toEqual({ add: [], remove: [MENU[0]], action: 'removed' });
  });
});

describe('computeSelection (select menu)', () => {
  it('synchronise la sélection avec les rôles du menu sans toucher aux autres', () => {
    const r = computeSelection([MENU[0]!, MENU[1]!, 'unrelated'], [MENU[1]!, MENU[2]!, 'injected'], MENU);
    expect(r.add).toEqual([MENU[2]]);
    expect(r.remove).toEqual([MENU[0]]);
  });
  it('sélection vide retire tous les rôles du menu', () => {
    expect(computeSelection(MENU, [], MENU).remove).toEqual(MENU);
  });
  it('aucun changement si identique', () => {
    expect(computeSelection([MENU[0]!], [MENU[0]!], MENU)).toEqual({ add: [], remove: [] });
  });
});

describe('parseRoleMenuOptions', () => {
  it('ignore les options invalides et borne à 25', () => {
    const opts = parseRoleMenuOptions([
      { roleId: MENU[0], label: 'A', emoji: '🎮', style: 'primary' },
      { roleId: 'abc' },
      { label: 'sans roleId' },
      ...Array.from({ length: 30 }, (_, i) => ({ roleId: `2000000000000000${String(i).padStart(2, '0')}` })),
    ]);
    expect(opts[0]).toEqual({ roleId: MENU[0], label: 'A', emoji: '🎮', style: 'primary' });
    expect(opts).toHaveLength(25);
    expect(parseRoleMenuOptions(null)).toEqual([]);
  });
});

describe('emoji helpers', () => {
  it('parse unicode et custom', () => {
    expect(parseEmojiInput('🎮')).toBe('🎮');
    expect(parseEmojiInput('<:br:123456789012345678>')).toBe('br:123456789012345678');
    expect(parseEmojiInput('<a:spin:123456789012345678>')).toBe('spin:123456789012345678');
    expect(parseEmojiInput('')).toBeNull();
    expect(parseEmojiInput('not an emoji at all')).toBeNull();
  });
  it('compare par ID pour les customs et par nom pour l’unicode', () => {
    expect(emojiMatches('br:123456789012345678', { id: '123456789012345678', name: 'renamed' })).toBe(true);
    expect(emojiMatches('🎮', { id: null, name: '🎮' })).toBe(true);
    expect(emojiMatches('🎮', { id: null, name: '🎉' })).toBe(false);
  });
  it('affiche un emoji stocké', () => {
    expect(displayEmoji('br:123456789012345678')).toBe('<:br:123456789012345678>');
    expect(displayEmoji('🎮')).toBe('🎮');
  });
});

describe('DEFAULT_NOTIFICATIONS', () => {
  it('contient les 7 notifications attendues avec des clés uniques', () => {
    expect(DEFAULT_NOTIFICATIONS.map((n) => n.key)).toEqual(['announcements', 'battle-royale', 'events', 'tournament', 'shop', 'streams', 'updates']);
    expect(new Set(DEFAULT_NOTIFICATIONS.map((n) => n.key)).size).toBe(7);
  });
});
