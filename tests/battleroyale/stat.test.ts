import { describe, expect, it } from 'vitest';
import { STAT_USER_PREFIX, normalizeName, parseStatTarget, pickByName, statChannelGate } from '../../src/services/battleroyale/stat';

const ID = '123456789012345678';

describe('/stat : option joueur', () => {
  it('vide → soi-même', () => {
    expect(parseStatTarget(null)).toEqual({ kind: 'self' });
    expect(parseStatTarget('   ')).toEqual({ kind: 'self' });
  });

  it('choix d’autocomplete, mention ou ID → membre', () => {
    expect(parseStatTarget(`${STAT_USER_PREFIX}${ID}`)).toEqual({ kind: 'user', userId: ID });
    expect(parseStatTarget(`<@${ID}>`)).toEqual({ kind: 'user', userId: ID });
    expect(parseStatTarget(`<@!${ID}>`)).toEqual({ kind: 'user', userId: ID });
    expect(parseStatTarget(` ${ID} `)).toEqual({ kind: 'user', userId: ID });
  });

  it('autre texte → pseudo en jeu à rechercher (préfixe invalide, rôle, nombre court compris)', () => {
    expect(parseStatTarget('Viper')).toEqual({ kind: 'name', query: 'Viper' });
    expect(parseStatTarget('u:abc')).toEqual({ kind: 'name', query: 'u:abc' });
    expect(parseStatTarget(`<@&${ID}>`)).toEqual({ kind: 'name', query: `<@&${ID}>` });
    expect(parseStatTarget('1234')).toEqual({ kind: 'name', query: '1234' });
    expect((parseStatTarget('x'.repeat(100)) as { query: string }).query).toHaveLength(64);
  });
});

describe('/stat : choix parmi les pseudos', () => {
  const players = [
    { userId: '1', name: 'Viperion' },
    { userId: '2', name: 'Le Viper' },
    { userId: '3', name: 'VIPER' },
    { userId: '4', name: 'Éloïse' },
  ];

  it('égalité exacte (sans casse ni accents) > début > contenu', () => {
    expect(pickByName(players, 'viper')?.userId).toBe('3');
    expect(pickByName(players, 'vipe')?.userId).toBe('1');
    expect(pickByName(players, 'le v')?.userId).toBe('2');
    expect(pickByName(players, 'eloise')?.userId).toBe('4');
    expect(pickByName(players, 'per')?.userId).toBe('1');
  });

  it('aucun résultat → null', () => {
    expect(pickByName(players, 'ghost')).toBeNull();
    expect(pickByName([], 'viper')).toBeNull();
    expect(pickByName(players, '  ')).toBeNull();
    expect(normalizeName('  Élo  ÏSE ')).toBe('elo ise');
  });
});

describe('/stat : salon dédié', () => {
  it('aucun salon configuré → partout', () => {
    expect(statChannelGate(null, 'c1')).toBe('ok');
  });
  it('dans le salon ou un de ses fils → ok ; ailleurs → lien éphémère', () => {
    expect(statChannelGate('stat', 'stat')).toBe('ok');
    expect(statChannelGate('stat', 'thread', 'stat')).toBe('ok');
    expect(statChannelGate('stat', 'general')).toBe('redirect');
    expect(statChannelGate('stat', 'thread', 'general')).toBe('redirect');
    expect(statChannelGate('stat', null)).toBe('redirect');
  });
});
