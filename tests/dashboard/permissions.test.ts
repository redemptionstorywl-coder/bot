import { describe, expect, it } from 'vitest';
import { parsePermissions, hasPermission, canManageGuild, PERMISSION_ADMINISTRATOR, PERMISSION_MANAGE_GUILD } from '../../dashboard/lib/access';

describe('parsePermissions', () => {
  it('parse une chaîne décimale', () => {
    expect(parsePermissions('8')).toBe(8n);
    expect(parsePermissions('32')).toBe(32n);
  });
  it('gère les bitfields > 2^53 sans perte', () => {
    const big = '1125899906842623'; // 2^50 - 1
    expect(parsePermissions(big)).toBe(BigInt(big));
    expect(parsePermissions('9007199254740993')).toBe(9007199254740993n);
  });
  it('accepte number et bigint', () => {
    expect(parsePermissions(8)).toBe(8n);
    expect(parsePermissions(8n)).toBe(8n);
    expect(parsePermissions(-5)).toBe(0n);
    expect(parsePermissions(-5n)).toBe(0n);
  });
  it('renvoie 0 pour une valeur invalide', () => {
    expect(parsePermissions('abc')).toBe(0n);
    expect(parsePermissions('')).toBe(0n);
    expect(parsePermissions(null)).toBe(0n);
    expect(parsePermissions(undefined)).toBe(0n);
    expect(parsePermissions('1.5')).toBe(0n);
    expect(parsePermissions('-8')).toBe(0n);
  });
  it('tolère les espaces', () => {
    expect(parsePermissions(' 8 ')).toBe(8n);
  });
});

describe('hasPermission / canManageGuild', () => {
  it('détecte Administrator (0x8)', () => {
    expect(hasPermission(parsePermissions('8'), PERMISSION_ADMINISTRATOR)).toBe(true);
    expect(canManageGuild('8')).toBe(true);
  });
  it('détecte ManageGuild (0x20) combiné à d’autres bits', () => {
    expect(hasPermission(parsePermissions(String(0x20 | 0x400 | 0x800)), PERMISSION_MANAGE_GUILD)).toBe(true);
    expect(canManageGuild(String(0x20 | 0x400))).toBe(true);
  });
  it('refuse sans ces permissions', () => {
    expect(canManageGuild(String(0x400 | 0x800 | 0x10000))).toBe(false);
    expect(canManageGuild('0')).toBe(false);
    expect(canManageGuild('nope')).toBe(false);
  });
  it('fonctionne avec un bitfield complet (toutes permissions)', () => {
    expect(canManageGuild('2251799813685247')).toBe(true);
  });
});
