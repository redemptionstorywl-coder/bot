import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { buildDefaultRoleMap, enabledLanguageDefinitions, resolveRoleMap } from '../../src/services/LanguageService';
import { LANGUAGES } from '../../src/config/constants';

const FR_ROLE = LANGUAGES.find((l) => l.code === 'fr')!.defaultRoleId!;
const EN_ROLE = LANGUAGES.find((l) => l.code === 'en')!.defaultRoleId!;

describe('buildDefaultRoleMap', () => {
  it('reprend tous les rôles par défaut quand ils existent', () => {
    const map = buildDefaultRoleMap(() => true);
    expect(Object.keys(map)).toHaveLength(LANGUAGES.filter((l) => l.defaultRoleId).length);
    expect(map.fr).toBe(FR_ROLE);
    expect(map.ar).toBe('1553404184747970690');
  });
  it('ne garde que les rôles présents sur le serveur', () => {
    const map = buildDefaultRoleMap((id) => id === FR_ROLE || id === EN_ROLE);
    expect(map).toEqual({ fr: FR_ROLE, en: EN_ROLE });
  });
});

describe('resolveRoleMap', () => {
  it('préfère la configuration LanguageRole', () => {
    const map = resolveRoleMap({ fr: '900000000000000001', de: '900000000000000002' }, () => true);
    expect(map).toEqual({ fr: '900000000000000001', de: '900000000000000002' });
  });
  it('retombe sur les défauts si aucun LanguageRole valide', () => {
    expect(resolveRoleMap({}, (id) => id === FR_ROLE)).toEqual({ fr: FR_ROLE });
    expect(resolveRoleMap({ fr: 'deleted-role' }, (id) => id === EN_ROLE)).toEqual({ en: EN_ROLE });
  });
  it('vide si rien n’existe', () => {
    expect(resolveRoleMap({}, () => false)).toEqual({});
  });
});

describe('enabledLanguageDefinitions', () => {
  it('suit l’ordre de LANGUAGES et ignore les codes inconnus', () => {
    expect(enabledLanguageDefinitions({ enabledLanguages: ['es', 'fr', 'xx'] }).map((l) => l.code)).toEqual(['fr', 'es']);
    expect(enabledLanguageDefinitions(null).map((l) => l.code)).toEqual(['fr', 'en']);
  });
});
