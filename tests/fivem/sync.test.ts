import { describe, expect, it } from 'vitest';
import {
  canSetNickname,
  CHANNEL_RENAME_INTERVAL_MS,
  decideConnection,
  EchoGuard,
  echoKey,
  formatNickname,
  parseIdentifiers,
  playerCountChannelName,
  RenameThrottle,
  resolveDiscordId,
  sanitizePlayerName,
  sessionMinutes,
  syncSettingsSchema,
  trackingLicense,
  type ConnectionFacts,
} from '../../src/services/fivem/sync';
import { normalizedSanctionSchema } from '../../src/services/fivem/schemas';
import { EsxAdapter } from '../../src/services/fivem/adapters';

const DISCORD = '123456789012345678';

describe('identifiants FiveM', () => {
  it('découpe license / discord / steam / fivem et ignore ip', () => {
    const p = parseIdentifiers(['license:abc123', `discord:${DISCORD}`, 'steam:110000112345678', 'fivem:42', 'ip:1.2.3.4', 'license2:zzz']);
    expect(p).toEqual({ license: 'license:abc123', license2: 'license2:zzz', discordId: DISCORD, steam: 'steam:110000112345678', fivemId: 'fivem:42' });
    expect(trackingLicense(p)).toBe('license:abc123');
    expect(trackingLicense(parseIdentifiers(['license2:zzz']))).toBe('license2:zzz');
  });

  it('rejette un discord: non numérique et les entrées malformées', () => {
    expect(parseIdentifiers(['discord:abc', 'nope', ':x', 'license:']).discordId).toBeUndefined();
    expect(parseIdentifiers(null)).toEqual({});
  });

  it('résout le discordId : explicite > identifiant discord: > liaison connue', () => {
    expect(resolveDiscordId({ discordId: '999999999999999999', identifiers: [`discord:${DISCORD}`] })).toBe('999999999999999999');
    expect(resolveDiscordId({ identifiers: ['license:a', `discord:${DISCORD}`], knownByLicense: '888888888888888888' })).toBe(DISCORD);
    expect(resolveDiscordId({ identifiers: ['license:a'], knownByLicense: '888888888888888888' })).toBe('888888888888888888');
    expect(resolveDiscordId({ identifiers: ['license:a'] })).toBeNull();
    expect(resolveDiscordId({ discordId: 'pas-un-id', identifiers: [] })).toBeNull();
  });

  it('sanction : `identifiers` suffit, UNBAN accepté (ESX : alias unban)', () => {
    expect(normalizedSanctionSchema.safeParse({ identifiers: [`discord:${DISCORD}`], type: 'UNBAN', reason: 'appel', staff: 'Bob' }).success).toBe(true);
    const s = new EsxAdapter().normalizeSanction({ identifiers: ['license:abc', `discord:${DISCORD}`], type: 'unban', reason: 'ok', admin: 'Bob' });
    expect(s).toMatchObject({ type: 'UNBAN', identifiers: ['license:abc', `discord:${DISCORD}`] });
  });
});

describe('pseudo → surnom', () => {
  it('nettoie codes couleur, balises GTA, contrôles et invisibles', () => {
    expect(sanitizePlayerName('^1Red^7 ~b~Fox​\u0007  ')).toBe('Red Fox');
    expect(sanitizePlayerName('  `**John**`  ')).toBe('John');
  });

  it('ignore les noms vides ou abusifs', () => {
    expect(sanitizePlayerName('')).toBeNull();
    expect(sanitizePlayerName('^1^2 ~r~')).toBeNull();
    expect(sanitizePlayerName('!!!')).toBeNull();
    expect(sanitizePlayerName('join discord.gg/abc')).toBeNull();
    expect(sanitizePlayerName('@everyone')).toBeNull();
    expect(sanitizePlayerName('https://spam.example')).toBeNull();
    expect(sanitizePlayerName('<@123456789012345678>')).toBeNull();
    expect(sanitizePlayerName(undefined)).toBeNull();
  });

  it('rend {name} {id} {level}', () => {
    expect(formatNickname('{name}', { name: 'John' })).toBe('John');
    expect(formatNickname('[{id}] {name} · Niv.{level}', { name: 'John', id: 7, level: 12 })).toBe('[7] John · Niv.12');
    expect(formatNickname('', { name: 'John' })).toBe('John');
    expect(formatNickname('{name}', { name: '^1' })).toBeNull();
  });

  it('tronque à 32 caractères en raccourcissant {name} en priorité', () => {
    const long = 'A'.repeat(40);
    expect(formatNickname('{name}', { name: long })).toBe('A'.repeat(32));
    const out = formatNickname('[BR] {name} | Niv.{level}', { name: long, level: 99 })!;
    expect(Array.from(out).length).toBeLessThanOrEqual(32);
    expect(out.startsWith('[BR] ')).toBe(true);
    expect(out.endsWith('| Niv.99')).toBe(true);
    // Les emojis ne sont pas coupés en deux.
    const emoji = formatNickname('{name}', { name: 'A😀'.repeat(20) })!;
    expect(Array.from(emoji)).toHaveLength(32);
    expect(emoji).toBe('A😀'.repeat(16));
    // Un pseudo sans lettre ni chiffre (emojis seuls) est ignoré.
    expect(formatNickname('{name}', { name: '😀😀' })).toBeNull();
  });

  it('respecte la hiérarchie et le propriétaire', () => {
    const base = { isOwner: false, botHasPermission: true, botHighestPosition: 10, memberHighestPosition: 5 };
    expect(canSetNickname(base)).toBe(true);
    expect(canSetNickname({ ...base, isOwner: true })).toBe(false);
    expect(canSetNickname({ ...base, botHasPermission: false })).toBe(false);
    expect(canSetNickname({ ...base, memberHighestPosition: 10 })).toBe(false);
    expect(canSetNickname({ ...base, memberHighestPosition: 11 })).toBe(false);
  });
});

describe('anti-écho', () => {
  it('marque une origine jeu 30 s, par type d’action', () => {
    const g = new EchoGuard(30_000);
    const k = echoKey('fromGame', 'ban', 'g1', 'u1');
    expect(k).toBe('fromGame:ban:g1:u1');
    expect(g.has(k, 0)).toBe(false);
    g.mark(k, 1000);
    expect(g.has(k, 1000)).toBe(true);
    expect(g.has(k, 20_000)).toBe(true); // lisible par plusieurs écouteurs
    expect(g.has(echoKey('fromGame', 'unban', 'g1', 'u1'), 2000)).toBe(false);
    expect(g.has(k, 31_001)).toBe(false);
    g.mark(k, 40_000);
    g.clear(k);
    expect(g.has(k, 40_001)).toBe(false);
  });
});

describe('décision de connexion (/check)', () => {
  const facts = (over: Partial<ConnectionFacts> = {}): ConnectionFacts => ({
    discordId: DISCORD,
    isMember: true,
    ban: null,
    requireDiscord: false,
    requireRoleId: null,
    hasRequiredRole: false,
    requireWhitelist: false,
    whitelisted: false,
    ...over,
  });

  it('autorise par défaut, même sans Discord', () => {
    expect(decideConnection(facts())).toMatchObject({ allowed: true, linked: true, banned: false });
    expect(decideConnection(facts({ discordId: null, isMember: null }))).toMatchObject({ allowed: true, linked: false });
  });

  it('refuse un ban Discord actif en priorité (avec raison et fin)', () => {
    const until = new Date('2030-01-01T00:00:00Z');
    const d = decideConnection(facts({ ban: { active: true, reason: 'Cheat', expiresAt: until }, requireRoleId: '1', hasRequiredRole: false }));
    expect(d).toMatchObject({ allowed: false, reason: 'banned', banned: true, banReason: 'Cheat', banExpiresAt: until.toISOString() });
    expect(decideConnection(facts({ ban: { active: false } })).allowed).toBe(true);
  });

  it('requireDiscord : non lié puis non membre', () => {
    expect(decideConnection(facts({ requireDiscord: true, discordId: null, isMember: null })).reason).toBe('discord_required');
    expect(decideConnection(facts({ requireDiscord: true, isMember: false })).reason).toBe('not_member');
    expect(decideConnection(facts({ requireDiscord: true, isMember: null })).reason).toBe('not_member');
    expect(decideConnection(facts({ requireDiscord: true })).allowed).toBe(true);
  });

  it('requireRole implique Discord lié + membre + rôle', () => {
    expect(decideConnection(facts({ requireRoleId: '42', discordId: null, isMember: null })).reason).toBe('discord_required');
    expect(decideConnection(facts({ requireRoleId: '42', isMember: false })).reason).toBe('not_member');
    expect(decideConnection(facts({ requireRoleId: '42', hasRequiredRole: false })).reason).toBe('missing_role');
    expect(decideConnection(facts({ requireRoleId: '42', hasRequiredRole: true })).allowed).toBe(true);
  });

  it('whitelist requise', () => {
    expect(decideConnection(facts({ requireWhitelist: true })).reason).toBe('not_whitelisted');
    expect(decideConnection(facts({ requireWhitelist: true, whitelisted: true })).allowed).toBe(true);
    expect(decideConnection(facts({ requireWhitelist: true, whitelisted: true, discordId: null, isMember: null })).allowed).toBe(true);
    expect(decideConnection(facts({ requireWhitelist: true, requireRoleId: '42', hasRequiredRole: false })).reason).toBe('missing_role');
  });
});

describe('salon compteur', () => {
  const labels = { online: '🟢 En ligne : {players}/{max}', offline: '🔴 Hors ligne', maintenance: '🟠 Maintenance' };

  it('formate le nom selon l’état', () => {
    expect(playerCountChannelName({ online: true, players: 23, maxPlayers: 64 }, labels)).toBe('🟢 En ligne : 23/64');
    expect(playerCountChannelName({ online: true, players: 3, maxPlayers: 0 }, labels)).toBe('🟢 En ligne : 3/?');
    expect(playerCountChannelName({ online: false, players: 0, maxPlayers: 64 }, labels)).toBe('🔴 Hors ligne');
    expect(playerCountChannelName({ online: true, maintenance: true, players: 1, maxPlayers: 64 }, labels)).toBe('🟠 Maintenance');
  });

  it('throttle ≥ 6 min, ignore les noms identiques, applique le dernier nom en attente', () => {
    expect(CHANNEL_RENAME_INTERVAL_MS).toBeGreaterThanOrEqual(6 * 60_000);
    const th = new RenameThrottle();
    const t0 = 10_000_000;
    th.seed('c', '🔴 Hors ligne');
    expect(th.request('c', '🔴 Hors ligne', t0)).toBe(false);
    expect(th.request('c', 'A', t0)).toBe(true);
    th.applied('c', 'A', t0);
    expect(th.request('c', 'A', t0 + 1000)).toBe(false);
    expect(th.request('c', 'B', t0 + 60_000)).toBe(false);
    expect(th.request('c', 'C', t0 + 120_000)).toBe(false);
    expect(th.due(t0 + 5 * 60_000)).toEqual([]);
    expect(th.due(t0 + CHANNEL_RENAME_INTERVAL_MS)).toEqual([{ channelId: 'c', name: 'C' }]);
    th.applied('c', 'C', t0 + CHANNEL_RENAME_INTERVAL_MS);
    expect(th.due(t0 + 2 * CHANNEL_RENAME_INTERVAL_MS)).toEqual([]);
    // Revenir au nom déjà appliqué annule l'attente.
    expect(th.request('c', 'D', t0 + CHANNEL_RENAME_INTERVAL_MS + 1)).toBe(false);
    expect(th.request('c', 'C', t0 + CHANNEL_RENAME_INTERVAL_MS + 2)).toBe(false);
    expect(th.due(t0 + 3 * CHANNEL_RENAME_INTERVAL_MS)).toEqual([]);
  });
});

describe('temps de jeu et réglages', () => {
  it('calcule la durée de session en minutes, bornée', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    expect(sessionMinutes(start, new Date('2026-01-01T10:59:59Z'))).toBe(59);
    expect(sessionMinutes(null, new Date())).toBe(0);
    expect(sessionMinutes(start, new Date('2026-01-01T09:00:00Z'))).toBe(0);
    expect(sessionMinutes(start, new Date('2026-01-05T10:00:00Z'))).toBe(24 * 60);
  });

  it('valide un patch de réglages', () => {
    expect(syncSettingsSchema.parse({ syncNicknames: false, nicknameFormat: '[{id}] {name}', onlineRoleId: null })).toEqual({ syncNicknames: false, nicknameFormat: '[{id}] {name}', onlineRoleId: null });
    expect(syncSettingsSchema.safeParse({ nicknameFormat: 'sans variable' }).success).toBe(false);
    expect(syncSettingsSchema.safeParse({ linkedRoleId: 'abc' }).success).toBe(false);
    expect(syncSettingsSchema.safeParse({ inconnu: true }).success).toBe(false);
  });
});
