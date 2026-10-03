import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { isLocalizedMap, resolveLocalized, setLocalized } from '../../src/services/WelcomeService';

describe('resolveLocalized', () => {
  it('renvoie une chaîne simple telle quelle', () => {
    expect(resolveLocalized('Bienvenue {user}', 'en', 'fr')).toBe('Bienvenue {user}');
  });
  it('renvoie un EmbedSpec simple tel quel (clés non-langue)', () => {
    const spec = { title: 'Hello', description: 'World' };
    expect(resolveLocalized(spec, 'fr')).toBe(spec);
  });
  it('choisit la langue de l’utilisateur', () => {
    expect(resolveLocalized({ fr: 'Salut', en: 'Hi' }, 'en', 'fr')).toBe('Hi');
  });
  it('retombe sur la langue du serveur puis sur la première valeur', () => {
    expect(resolveLocalized({ fr: 'Salut', en: 'Hi' }, 'de', 'fr')).toBe('Salut');
    expect(resolveLocalized({ es: 'Hola' }, 'de', 'fr')).toBe('Hola');
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

describe('setLocalized', () => {
  it('remplace tout sans langue', () => {
    expect(setLocalized({ fr: 'a' }, 'b', null, 'fr')).toBe('b');
    expect(setLocalized('a', null, undefined, 'fr')).toBeNull();
  });
  it('fusionne dans un dictionnaire existant', () => {
    expect(setLocalized({ fr: 'a' }, 'b', 'en', 'fr')).toEqual({ fr: 'a', en: 'b' });
  });
  it('rattache une valeur simple existante à la langue de base', () => {
    expect(setLocalized('Salut', 'Hi', 'en', 'fr')).toEqual({ fr: 'Salut', en: 'Hi' });
  });
  it('supprime une langue et renvoie null quand vide', () => {
    expect(setLocalized({ fr: 'a', en: 'b' }, null, 'en', 'fr')).toEqual({ fr: 'a' });
    expect(setLocalized({ en: 'b' }, null, 'en', 'fr')).toBeNull();
  });
});
