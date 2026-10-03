import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { normalizedSanctionSchema, normalizedStatsSchema, serverStatusSchema, statsBatchSchema, fivemIdentifierSchema, pickDiscordId, pickLicense } from '../../src/services/fivem/schemas';
import { getAdapter, EsxAdapter, QbCoreAdapter, CustomAdapter } from '../../src/services/fivem/adapters';
import { resolveStatus, OFFLINE_AFTER_MS } from '../../src/services/FiveMService';
import { checkRateLimit } from '../../src/api/fivem';

describe('schémas FiveM', () => {
  it('valide un statut complet et applique les défauts', () => {
    const s = serverStatusSchema.parse({ online: true, players: '3', maxPlayers: 64, playerList: [{ id: '1', name: 'John', identifiers: ['license:abc'] }] });
    expect(s.players).toBe(3);
    expect(s.playerList[0]?.id).toBe(1);
    expect(s.playerList[0]?.identifiers).toEqual(['license:abc']);
    expect(serverStatusSchema.parse({}).online).toBe(true);
  });
  it('refuse un statut invalide', () => {
    expect(serverStatusSchema.safeParse({ players: -1 }).success).toBe(false);
    expect(serverStatusSchema.safeParse({ playerList: [{ name: 'x' }] }).success).toBe(false);
  });
  it('valide des stats et refuse un identifiant mal formé', () => {
    const s = normalizedStatsSchema.parse({ identifier: 'license:abc123', kills: '4' });
    expect(s.kills).toBe(4);
    expect(s.mode).toBe('increment');
    expect(s.wins).toBe(0);
    expect(normalizedStatsSchema.safeParse({ identifier: 'notanid' }).success).toBe(false);
    expect(fivemIdentifierSchema.safeParse('steam:110000112345678').success).toBe(true);
  });
  it('accepte un lot de stats', () => {
    const r = statsBatchSchema.safeParse([{ identifier: 'license:a' }, { identifier: 'license:b', wins: 1 }]);
    expect(r.success).toBe(true);
    expect(statsBatchSchema.safeParse([]).success).toBe(false);
  });
  it('exige identifier ou discordId pour une sanction', () => {
    expect(normalizedSanctionSchema.safeParse({ type: 'BAN', reason: 'x', staff: 'a' }).success).toBe(false);
    expect(normalizedSanctionSchema.safeParse({ discordId: '123456789012345678', type: 'WARN', reason: 'x', staff: 'a' }).success).toBe(true);
    expect(normalizedSanctionSchema.safeParse({ identifier: 'license:a', type: 'MUTE', reason: 'x', staff: 'a' }).success).toBe(false);
  });
  it('extrait license et discord des identifiants', () => {
    const ids = ['steam:1', 'discord:123456789012345678', 'license:abc'];
    expect(pickLicense(ids)).toBe('license:abc');
    expect(pickDiscordId(ids)).toBe('123456789012345678');
    expect(pickDiscordId(['license:abc'])).toBeUndefined();
  });
});

describe('adaptateurs', () => {
  it('sélectionne le bon adaptateur', () => {
    expect(getAdapter('ESX')).toBeInstanceOf(EsxAdapter);
    expect(getAdapter('QBCORE')).toBeInstanceOf(QbCoreAdapter);
    expect(getAdapter('CUSTOM')).toBeInstanceOf(CustomAdapter);
    expect(getAdapter(undefined)).toBeInstanceOf(CustomAdapter);
  });
  it('ESX : normalise stats et sanctions', () => {
    const esx = new EsxAdapter();
    const stats = esx.normalizeStats({ identifier: 'license:abc', stats: { kills: 3, deaths: '2', played: 1, damage_dealt: 500, playtime: 12, victories: 1 } });
    expect(stats).toMatchObject({ identifier: 'license:abc', kills: 3, deaths: 2, matches: 1, damage: 500, playtimeMinutes: 12, wins: 1 });
    const sanction = esx.normalizeSanction({ identifier: 'license:abc', type: 'ban', reason: 'Cheat', time: 3600, admin: 'Bob' });
    expect(sanction).toMatchObject({ type: 'BAN', duration: 3600, staff: 'Bob' });
    expect(() => esx.normalizeStats({ kills: 1 })).toThrow();
  });
  it('QBCore : construit l’identifiant depuis citizenid et mappe les sanctions', () => {
    const qb = new QbCoreAdapter();
    const stats = qb.normalizeStats({ citizenid: 'ABC123', metadata: { wins: 2, kills: 10, rounds: 4, playtime: 30 } });
    expect(stats.identifier).toBe('citizenid:ABC123');
    expect(stats).toMatchObject({ wins: 2, kills: 10, matches: 4, playtimeMinutes: 30 });
    expect(qb.normalizeStats({ license: 'license:zzz', citizenid: 'X' }).identifier).toBe('license:zzz');
    const sanction = qb.normalizeSanction({ license: 'license:zzz', action: 'kick', reason: 'AFK', admin: 'Alice' });
    expect(sanction).toMatchObject({ identifier: 'license:zzz', type: 'KICK', staff: 'Alice' });
  });
  it('Custom : validation stricte', () => {
    const custom = new CustomAdapter();
    expect(custom.normalizeStats({ identifier: 'license:a', xp: 10 }).xp).toBe(10);
    expect(() => custom.normalizeStats({ identifier: 'license:a', kills: -1 })).toThrow();
    expect(() => custom.normalizeSanction({ identifier: 'license:a', type: 'ban', reason: 'x', staff: 's' })).toThrow();
  });
});

describe('resolveStatus', () => {
  const base = { lastStatus: { online: true, players: 5, maxPlayers: 32, playerList: [] }, maintenance: false };
  it('reste en ligne si récent', () => {
    const now = Date.now();
    const s = resolveStatus({ ...base, lastSeenAt: new Date(now - 30_000) }, now);
    expect(s.online).toBe(true);
    expect(s.stale).toBe(false);
    expect(s.players).toBe(5);
  });
  it('passe hors ligne après 3 minutes sans nouvelles', () => {
    const now = Date.now();
    const s = resolveStatus({ ...base, lastSeenAt: new Date(now - OFFLINE_AFTER_MS - 1) }, now);
    expect(s.online).toBe(false);
    expect(s.stale).toBe(true);
  });
  it('propage la maintenance et tolère un lastStatus invalide', () => {
    expect(resolveStatus({ lastStatus: { garbage: true, players: 'x' }, lastSeenAt: new Date(), maintenance: true }).maintenance).toBe(true);
    expect(resolveStatus({ lastStatus: null, lastSeenAt: null, maintenance: false }).online).toBe(false);
  });
});

describe('rate limit', () => {
  it('bloque au-delà de 120 requêtes par minute', () => {
    const ip = `test-${Math.random()}`;
    const now = 1_000_000;
    for (let i = 0; i < 120; i++) expect(checkRateLimit(ip, now).allowed).toBe(true);
    const blocked = checkRateLimit(ip, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(checkRateLimit(ip, now + 60_001).allowed).toBe(true);
  });
});
