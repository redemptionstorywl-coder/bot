import { describe, expect, it } from 'vitest';
import { hasGuildAccess, manageableGuilds, type SessionGuild } from '../../dashboard/lib/access';

const guilds: SessionGuild[] = [
  { id: '100000000000000001', name: 'Owner', icon: null, owner: true, permissions: '0' },
  { id: '100000000000000002', name: 'Admin', icon: null, owner: false, permissions: String(0x8) },
  { id: '100000000000000003', name: 'Manage', icon: null, owner: false, permissions: String(0x20 | 0x400) },
  { id: '100000000000000004', name: 'Member', icon: null, owner: false, permissions: String(0x400 | 0x800) },
];
const bot = new Set(['100000000000000001', '100000000000000002', '100000000000000003', '100000000000000004', '100000000000000009']);
const user = '200000000000000001';

describe('hasGuildAccess', () => {
  it('autorise le propriétaire du serveur', () => {
    expect(hasGuildAccess(guilds, '100000000000000001', user, [], bot)).toBe(true);
  });
  it('autorise Administrator et ManageGuild', () => {
    expect(hasGuildAccess(guilds, '100000000000000002', user, [], bot)).toBe(true);
    expect(hasGuildAccess(guilds, '100000000000000003', user, [], bot)).toBe(true);
  });
  it('refuse un simple membre', () => {
    expect(hasGuildAccess(guilds, '100000000000000004', user, [], bot)).toBe(false);
  });
  it('refuse si le bot est absent, même pour un admin ou un owner du bot', () => {
    const noBot = new Set<string>();
    expect(hasGuildAccess(guilds, '100000000000000002', user, [], noBot)).toBe(false);
    expect(hasGuildAccess(guilds, '100000000000000002', user, [user], noBot)).toBe(false);
  });
  it('autorise OWNER_IDS sur tout serveur où le bot est présent, même hors de la liste de session', () => {
    expect(hasGuildAccess(guilds, '100000000000000009', user, [user], bot)).toBe(true);
    expect(hasGuildAccess(undefined, '100000000000000009', user, [user], bot)).toBe(true);
  });
  it('refuse un serveur inconnu de la session', () => {
    expect(hasGuildAccess(guilds, '100000000000000009', user, [], bot)).toBe(false);
  });
  it('accepte un itérable de guild IDs', () => {
    expect(hasGuildAccess(guilds, '100000000000000001', user, [], ['100000000000000001'])).toBe(true);
    expect(hasGuildAccess(guilds, '100000000000000001', user, [], [])).toBe(false);
  });
  it('refuse les entrées vides', () => {
    expect(hasGuildAccess(guilds, '', user, [], bot)).toBe(false);
    expect(hasGuildAccess(guilds, '100000000000000001', '', [], bot)).toBe(false);
  });
});

describe('manageableGuilds', () => {
  it('filtre les serveurs administrables', () => {
    expect(manageableGuilds(guilds, user, []).map((g) => g.id)).toEqual(['100000000000000001', '100000000000000002', '100000000000000003']);
  });
  it('renvoie tout pour un owner du bot', () => {
    expect(manageableGuilds(guilds, user, [user])).toHaveLength(4);
  });
  it('gère une session sans serveurs', () => {
    expect(manageableGuilds(undefined, user, [])).toEqual([]);
  });
});
