import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { isLocalizedMap, resolveLocalized } from '../../src/services/WelcomeService';

describe('resolveLocalized', () => {
  it('renvoie une chaîne simple telle quelle', () => {
    expect(resolveLocalized('Bienvenue {user}', 'en', 'fr')).toBe('Bienvenue {user}');
  });
  it('renvoie un EmbedSpec simple tel quel (clés non-langue)', () => {
    const spec = { title: 'Hello', description: 'World' };
    expect(resolveLocalized(spec, 'fr')).toBe(spec);
  });
  it('choisit la langue demandée (langue du serveur)', () => {
    expect(resolveLocalized({ fr: 'Salut', en: 'Hi' }, 'en', 'fr')).toBe('Hi');
  });
  it('retombe sur la langue du serveur puis sur la première valeur', () => {
    expect(resolveLocalized({ fr: 'Salut' }, 'en', 'fr')).toBe('Salut');
    expect(resolveLocalized({ en: 'Hi' }, 'fr', 'fr')).toBe('Hi');
  });
  it('gère null / undefined', () => {
    expect(resolveLocalized(null, 'fr')).toBeUndefined();
    expect(resolveLocalized(undefined, 'fr')).toBeUndefined();
  });
  it('isLocalizedMap distingue dictionnaire de langues et objet quelconque', () => {
    expect(isLocalizedMap({ fr: 'a', en: 'b' })).toBe(true);
    expect(isLocalizedMap({ title: 'a' })).toBe(false);
    expect(isLocalizedMap({ fr: 'a', title: 'b' })).toBe(false);
    expect(isLocalizedMap({})).toBe(false);
    expect(isLocalizedMap(['fr'])).toBe(false);
  });
});
