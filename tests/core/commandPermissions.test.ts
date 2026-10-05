import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { decideCommandAccess } from '../../src/services/CommandPermissionService';

const base = { memberRoleIds: ['r1'], isOwner: false, isDiscordAdmin: false };

describe('decideCommandAccess', () => {
  it('sans règle : vérifications par défaut', () => expect(decideCommandAccess({ ...base, rule: null })).toBe('default'));
  it('propriétaire toujours autorisé', () => expect(decideCommandAccess({ ...base, isOwner: true, rule: { roleIds: [], enabled: false } })).toBe('allow'));
  it('commande désactivée', () => expect(decideCommandAccess({ ...base, rule: { roleIds: [], enabled: false } })).toBe('deny_disabled'));
  it('rôle configuré : donne l’accès', () => expect(decideCommandAccess({ ...base, rule: { roleIds: ['r1'], enabled: true } })).toBe('allow'));
  it('rôle configuré absent : refusé', () => expect(decideCommandAccess({ ...base, rule: { roleIds: ['r9'], enabled: true } })).toBe('deny_role'));
  it('administrateur Discord autorisé malgré les rôles', () => expect(decideCommandAccess({ ...base, isDiscordAdmin: true, rule: { roleIds: ['r9'], enabled: true } })).toBe('allow'));
  it('commande verrouillée : jamais restreinte', () => expect(decideCommandAccess({ ...base, locked: true, rule: { roleIds: ['r9'], enabled: false } })).toBe('default'));
});
