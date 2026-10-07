import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import type { TempVoiceConfig } from '@prisma/client';
import {
  CHANNEL_NAME_MAX,
  DEFAULT_LOBBY_ID,
  MEMBER_NAME_MAX,
  VOICE_LANGUAGE_PRESETS,
  buildChannelName,
  defaultFallback,
  detectLanguageRoles,
  effectiveLobbyIds,
  memberDisplayName,
  resolveChannelName,
  resolveRule,
  ruleFromPreset,
  sanitizeMemberName,
  toTempVoiceSettings,
  truncateUnits,
  voiceNameRuleSchema,
  voiceRuleSchema,
  type VoiceRule,
} from '../../src/services/TempVoiceService';

const FR_ROLE = '100000000000000001';
const EN_ROLE = '100000000000000002';
const ES_ROLE = '100000000000000003';
const OTHER_ROLE = '100000000000000009';

const fr = ruleFromPreset(FR_ROLE, 'fr');
const en = ruleFromPreset(EN_ROLE, 'en');
const es = ruleFromPreset(ES_ROLE, 'es');

describe('langues proposées', () => {
  it('français et anglais par défaut, demandés par le propriétaire', () => {
    expect(buildChannelName(fr, 'Bob')).toBe('🇫🇷 Salon de Bob');
    expect(buildChannelName(en, 'Bob')).toBe("🇬🇧 Bob's lobby");
    expect(defaultFallback()).toEqual({ preset: 'en', emoji: '🇬🇧', template: "{name}'s lobby" });
  });

  it('11 langues, chacune avec drapeau et modèle valides contenant {name}', () => {
    expect(VOICE_LANGUAGE_PRESETS.map((p) => p.key)).toEqual(['fr', 'en', 'es', 'de', 'it', 'pt', 'ar', 'tr', 'pl', 'ru', 'nl']);
    for (const p of VOICE_LANGUAGE_PRESETS) {
      expect(voiceNameRuleSchema.safeParse({ preset: p.key, emoji: p.emoji, template: p.template }).success, p.key).toBe(true);
      expect(buildChannelName(p, 'Zoé').startsWith(p.emoji), p.key).toBe(true);
      expect(buildChannelName(p, 'Zoé')).toContain('Zoé');
    }
  });

  it('ruleFromPreset : langue inconnue → anglais', () => {
    expect(ruleFromPreset(FR_ROLE, 'xx')).toEqual({ roleId: FR_ROLE, preset: 'en', emoji: '🇬🇧', template: "{name}'s lobby" });
  });
});

describe('résolution de la règle depuis les rôles', () => {
  const rules: VoiceRule[] = [fr, en, es];

  it('première règle dont le membre a le rôle, dans l’ordre configuré', () => {
    expect(resolveRule([OTHER_ROLE, EN_ROLE], rules, defaultFallback())).toMatchObject({ index: 1, roleId: EN_ROLE });
    // Français ET anglais : la règle française (n°1) l'emporte
    expect(resolveRule([EN_ROLE, FR_ROLE], rules, defaultFallback())).toMatchObject({ index: 0, roleId: FR_ROLE });
    expect(resolveRule(new Set([ES_ROLE]), rules, defaultFallback()).rule.template).toBe('Sala de {name}');
  });

  it('aucun rôle de langue → règle de repli (anglais par défaut)', () => {
    const r = resolveRule([OTHER_ROLE], rules, defaultFallback());
    expect(r).toMatchObject({ index: -1, roleId: null });
  });

  it('le salon s’appelle toujours « <pseudo> Lobby », quels que soient les rôles', () => {
    expect(resolveChannelName([OTHER_ROLE], 'Bob', { rules, fallback: defaultFallback() })).toBe('Bob Lobby');
    expect(resolveChannelName([FR_ROLE, EN_ROLE], 'Bob', { rules: [en, fr], fallback: defaultFallback() })).toBe('Bob Lobby');
    expect(resolveChannelName([], 'Bob')).toBe('Bob Lobby');
  });
});

describe('nettoyage du pseudo et limites', () => {
  it('retire contrôles, invisibles et retours à la ligne ; fusionne les espaces', () => {
    expect(sanitizeMemberName('  Jean\n\tDupont​  ')).toBe('Jean Dupont');
    expect(sanitizeMemberName('‮evil‬')).toBe('evil');
    expect(sanitizeMemberName('\u0000\u0007')).toBe('');
    expect(sanitizeMemberName(null)).toBe('');
  });

  it('pseudo limité à 32 caractères sans couper un emoji', () => {
    const long = 'A'.repeat(31) + '😀😀';
    const s = sanitizeMemberName(long);
    expect(s.length).toBeLessThanOrEqual(MEMBER_NAME_MAX);
    expect(s.endsWith('…')).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(s.slice(0, -1))).toBe(false);
    expect(truncateUnits('😀😀😀', 4)).toBe('😀…');
  });

  it('pseudo affiché, sinon nom global, sinon nom d’utilisateur, sinon « ? »', () => {
    expect(memberDisplayName({ displayName: 'Zoé', user: { username: 'zoe' } })).toBe('Zoé');
    expect(memberDisplayName({ displayName: '​', user: { globalName: null, username: 'zoe_42' } })).toBe('zoe_42');
    expect(memberDisplayName({ displayName: '', user: { globalName: '', username: '' } })).toBe('?');
  });

  it('nom de salon ≤ 100 caractères : seul le pseudo est raccourci', () => {
    const rule = { emoji: '🇫🇷', template: `${'x'.repeat(80)} {name}` };
    const name = buildChannelName(rule, 'B'.repeat(32));
    expect(name.length).toBeLessThanOrEqual(CHANNEL_NAME_MAX);
    expect(name.startsWith(`🇫🇷 ${'x'.repeat(80)} B`)).toBe(true);
    expect(name.endsWith('…')).toBe(true);
  });

  it('plusieurs {name} et modèle sans emoji', () => {
    expect(buildChannelName({ emoji: '', template: '{name} & {name}' }, 'Al')).toBe('Al & Al');
    const twice = buildChannelName({ emoji: '🇩🇪', template: `{name} ${'y'.repeat(60)} {name}` }, 'Z'.repeat(32));
    expect(twice.length).toBeLessThanOrEqual(CHANNEL_NAME_MAX);
  });

  it('validation des règles : {name} obligatoire, une ligne, emoji Unicode', () => {
    expect(voiceRuleSchema.safeParse({ roleId: FR_ROLE, emoji: '🇫🇷', template: 'Salon de {name}' }).success).toBe(true);
    expect(voiceRuleSchema.safeParse({ roleId: FR_ROLE, emoji: '🇫🇷', template: 'Salon' }).success).toBe(false);
    expect(voiceRuleSchema.safeParse({ roleId: FR_ROLE, emoji: '<:fr:123>', template: '{name}' }).success).toBe(false);
    expect(voiceRuleSchema.safeParse({ roleId: FR_ROLE, emoji: '', template: 'a\n{name}' }).success).toBe(false);
    expect(voiceRuleSchema.safeParse({ roleId: 'abc', emoji: '', template: '{name}' }).success).toBe(false);
  });
});

describe('détection des rôles de langue', () => {
  it('reconnaît les noms et drapeaux usuels, un rôle par langue', () => {
    const roles = [
      { id: '1', name: 'Staff' },
      { id: '2', name: '🇫🇷 Français' },
      { id: '3', name: 'English' },
      { id: '4', name: 'Español 🇪🇸' },
      { id: '5', name: 'Chef de projet' },
      { id: '6', name: 'French' },
    ];
    const found = detectLanguageRoles(roles);
    expect(found.map((r) => [r.roleId, r.preset])).toEqual([
      ['2', 'fr'],
      ['3', 'en'],
      ['4', 'es'],
    ]);
  });

  it('ignore les rôles déjà associés et les codes courts dans une phrase', () => {
    const existing = [ruleFromPreset('2', 'fr')];
    expect(detectLanguageRoles([{ id: '2', name: 'Français' }, { id: '7', name: 'FR' }], existing).map((r) => r.roleId)).toEqual(['7']);
    expect(detectLanguageRoles([{ id: '8', name: 'Fan de foot' }])).toEqual([]);
  });
});

describe('configuration stockée', () => {
  const row = (data: Partial<TempVoiceConfig>): TempVoiceConfig => ({ guildId: '9', lobbyIds: [], categoryId: null, userLimit: null, rules: [], fallback: null, ownerPermissions: true, transferOwnership: true, updatedAt: new Date(), ...data }) as TempVoiceConfig;

  it('lecture tolérante : entrées invalides ignorées, repli anglais', () => {
    const s = toTempVoiceSettings('9', row({ lobbyIds: [DEFAULT_LOBBY_ID, 'oops', DEFAULT_LOBBY_ID], rules: [fr, { roleId: 'x' }, { ...en, template: 'sans nom' }], userLimit: 500 }));
    expect(s.configured).toBe(true);
    expect(s.lobbyIds).toEqual([DEFAULT_LOBBY_ID]);
    expect(s.rules).toEqual([fr]);
    expect(s.userLimit).toBe(99);
    expect(s.fallback).toEqual(defaultFallback());
  });

  it('sans configuration : le salon par défaut est utilisé s’il existe sur le serveur', () => {
    const empty = toTempVoiceSettings('9', null);
    expect(empty.configured).toBe(false);
    expect(effectiveLobbyIds(empty, (id) => id === DEFAULT_LOBBY_ID)).toEqual([DEFAULT_LOBBY_ID]);
    expect(effectiveLobbyIds(empty, () => false)).toEqual([]);
    // Une fois enregistré (même vide), le choix du propriétaire prime
    expect(effectiveLobbyIds({ configured: true, lobbyIds: [] }, () => true)).toEqual([]);
  });
});
