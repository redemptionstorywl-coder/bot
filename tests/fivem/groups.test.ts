import { describe, expect, it } from 'vitest';
import {
  groupsChanged,
  managedGroups,
  moveRoleGroupToTop,
  parseRoleGroups,
  removeRoleGroups,
  resolveGroups,
  roleGroupsSchema,
  touchesMappedRole,
  upsertRoleGroup,
  type RoleGroup,
} from '../../src/services/fivem/groups';
import { syncSettingsSchema } from '../../src/services/fivem/sync';

const STAFF = '111111111111111111';
const MOD = '222222222222222222';
const VIP = '333333333333333333';
const OTHER = '444444444444444444';

const mappings: RoleGroup[] = [
  { roleId: STAFF, group: 'admin' },
  { roleId: MOD, group: 'mod' },
  { roleId: VIP, group: 'vip' },
];

describe('rôles Discord → groupes en jeu : résolution et priorité', () => {
  it('ordre de la liste = priorité : le premier groupe détenu est le principal', () => {
    expect(resolveGroups(mappings, [VIP, MOD])).toEqual({ groups: ['mod', 'vip'], primary: 'mod', managed: ['admin', 'mod', 'vip'] });
    expect(resolveGroups(mappings, [VIP, STAFF, MOD]).primary).toBe('admin');
    expect(resolveGroups(mappings, [VIP]).groups).toEqual(['vip']);
  });

  it('aucun rôle associé → aucun groupe, mais les groupes gérés restent listés (pour les retirer en jeu)', () => {
    expect(resolveGroups(mappings, [OTHER])).toEqual({ groups: [], primary: null, managed: ['admin', 'mod', 'vip'] });
    expect(resolveGroups([], [STAFF])).toEqual({ groups: [], primary: null, managed: [] });
  });

  it('deux rôles vers le même groupe : groupe listé une seule fois', () => {
    const list: RoleGroup[] = [
      { roleId: STAFF, group: 'admin' },
      { roleId: OTHER, group: 'admin' },
      { roleId: VIP, group: 'vip' },
    ];
    expect(resolveGroups(list, [OTHER, VIP, STAFF]).groups).toEqual(['admin', 'vip']);
    expect(managedGroups(list)).toEqual(['admin', 'vip']);
  });

  it('lecture tolérante de la colonne JSON (valeurs invalides et doublons ignorés, nom en minuscules)', () => {
    expect(parseRoleGroups(null)).toEqual([]);
    expect(parseRoleGroups('x')).toEqual([]);
    expect(
      parseRoleGroups([
        { roleId: STAFF, group: 'Admin' },
        { roleId: 'abc', group: 'mod' },
        { roleId: MOD, group: 'mod; quit' },
        { roleId: STAFF, group: 'other' },
        { roleId: VIP, group: 'vip' },
      ]),
    ).toEqual([
      { roleId: STAFF, group: 'admin' },
      { roleId: VIP, group: 'vip' },
    ]);
  });

  it('les noms de groupe sont sûrs pour `add_principal` (pas d’espace ni de séparateur de commande)', () => {
    expect(roleGroupsSchema.safeParse([{ roleId: STAFF, group: 'admin' }]).success).toBe(true);
    for (const bad of ['', 'a b', 'admin;quit', 'group"x', 'x'.repeat(33), 'é']) expect(roleGroupsSchema.safeParse([{ roleId: STAFF, group: bad }]).success).toBe(false);
    expect(roleGroupsSchema.safeParse([{ roleId: STAFF, group: 'a' }, { roleId: STAFF, group: 'b' }]).success).toBe(false);
  });

  it('les réglages de synchronisation acceptent la liste (validée)', () => {
    expect(syncSettingsSchema.parse({ roleGroups: mappings }).roleGroups).toEqual(mappings);
    expect(() => syncSettingsSchema.parse({ roleGroups: [{ roleId: STAFF, group: 'bad name' }] })).toThrow();
  });

  it('détection des changements (ordre compris) et des rôles concernés', () => {
    expect(groupsChanged(['mod'], ['mod'])).toBe(false);
    expect(groupsChanged(['mod'], ['admin', 'mod'])).toBe(true);
    expect(groupsChanged(['admin', 'mod'], ['mod', 'admin'])).toBe(true);
    expect(touchesMappedRole(mappings, [OTHER], [OTHER, '555555555555555555'])).toBe(false);
    expect(touchesMappedRole(mappings, [OTHER], [OTHER, MOD])).toBe(true);
    expect(touchesMappedRole(mappings, [STAFF], [])).toBe(true);
  });
});

describe('édition de la liste (panneau / dashboard)', () => {
  it('ajout en dernier, à une position donnée, ou remplacement en gardant la place', () => {
    const base: RoleGroup[] = [{ roleId: STAFF, group: 'admin' }];
    expect(upsertRoleGroup(base, { roleId: VIP, group: 'VIP' })).toEqual([...base, { roleId: VIP, group: 'vip' }]);
    expect(upsertRoleGroup(base, { roleId: MOD, group: 'mod' }, 1).map((m) => m.roleId)).toEqual([MOD, STAFF]);
    expect(upsertRoleGroup(mappings, { roleId: MOD, group: 'moderator' })).toEqual([mappings[0], { roleId: MOD, group: 'moderator' }, mappings[2]]);
    expect(upsertRoleGroup(mappings, { roleId: VIP, group: 'vip' }, 99).map((m) => m.roleId)).toEqual([STAFF, MOD, VIP]);
    expect(() => upsertRoleGroup(base, { roleId: VIP, group: 'bad name' })).toThrow();
  });

  it('retrait et mise en tête', () => {
    expect(removeRoleGroups(mappings, [MOD, VIP])).toEqual([mappings[0]]);
    expect(moveRoleGroupToTop(mappings, VIP).map((m) => m.group)).toEqual(['vip', 'admin', 'mod']);
    expect(moveRoleGroupToTop(mappings, OTHER)).toEqual(mappings);
  });
});
