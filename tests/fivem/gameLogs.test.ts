import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});
vi.mock('../../src/config/env', () => ({ env: () => ({ FIVEM_API_KEY: 'global-api-key', OWNER_IDS: [] }) }));
vi.mock('../../src/services/FiveMSyncService', () => ({ fivemSyncService: { attach: vi.fn() } }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));

import { prisma } from '../../src/database/client';
import { loggingService } from '../../src/services/LoggingService';
import { createFiveMRouter } from '../../src/api/fivem';
import { gameLogBatchSchema, gameLogEntrySchema, GAME_LOG_TYPES } from '../../src/services/fivem/schemas';
import { cleanText, collectLicenses, customRoute, parsePlayer, redactData, renderGameLog, shortLicense } from '../../src/services/fivem/gameLogs';
import { consumeRate, gameLogService } from '../../src/services/GameLogService';
import { translationService } from '../../src/services/TranslationService';
import { run as luaRoutes } from '../../scripts/checks/lua-routes';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const t = translationService.bind('fr');
const ctx = { t, lang: 'fr' };
const LICENSE = `license:${'a1b2'.repeat(10)}`;
const player = (id: number, name: string, extra: string[] = []) => ({ id, name, identifiers: [LICENSE.replace('a1b2', String(id).padStart(4, '0')), 'ip:1.2.3.4', 'steam:110000112345678', ...extra] });

describe('schéma des logs en jeu (POST /logs)', () => {
  it('accepte un lot { type, ts, data } de 1 à 50 entrées, tableau Lua vide = objet vide', () => {
    expect(gameLogBatchSchema.parse([{ type: 'connect', ts: 1700000000, data: { id: 1, name: 'Viper' } }])[0]!.type).toBe('connect');
    expect(gameLogEntrySchema.parse({ type: 'server', data: [] }).data).toEqual({});
    expect(gameLogEntrySchema.parse({ type: 'server' }).data).toEqual({});
    for (const type of GAME_LOG_TYPES) expect(gameLogEntrySchema.safeParse({ type, data: {} }).success, type).toBe(true);
  });

  it('refuse type inconnu, lot vide ou trop grand, données trop lourdes ou trop profondes', () => {
    expect(gameLogEntrySchema.safeParse({ type: 'teleport', data: {} }).success).toBe(false);
    expect(gameLogBatchSchema.safeParse([]).success).toBe(false);
    expect(gameLogBatchSchema.safeParse(Array.from({ length: 51 }, () => ({ type: 'chat', data: {} }))).success).toBe(false);
    expect(gameLogEntrySchema.safeParse({ type: 'custom', data: { blob: 'x'.repeat(9000) } }).success).toBe(false);
    expect(gameLogEntrySchema.safeParse({ type: 'custom', data: { a: { b: { c: { d: { e: 1 } } } } } }).success).toBe(false);
    expect(gameLogEntrySchema.safeParse({ type: 'custom', data: 'texte' }).success).toBe(false);
  });
});

describe('rendu des logs en jeu', () => {
  it('connexion : joueur, Discord lié (identifiant discord:), licence raccourcie ; IP et steam jamais affichés', () => {
    const r = renderGameLog({ type: 'connect', data: player(3, '^1Viper', ['discord:222222222222222222']) }, ctx);
    expect(r.action).toBe('game.connect');
    expect(r.route).toBe('game.connections');
    const text = JSON.stringify(r.fields);
    expect(text).toContain('**Viper** (#3)');
    expect(text).toContain('<@222222222222222222>');
    expect(text).toContain('license:0003…a1b2');
    expect(text).not.toContain('1.2.3.4');
    expect(text).not.toContain('steam:');
    expect(r.targetId).toBe('222222222222222222');
    expect(JSON.stringify(r.data)).not.toContain('1.2.3.4');
    expect(JSON.stringify(r.data)).not.toContain('steam:');
  });

  it('connexion refusée : titre et raison', () => {
    const r = renderGameLog({ type: 'connect', data: { name: 'Bob', identifiers: [], refused: true, reason: 'banned' } }, ctx);
    expect(r.title).toBe('⛔ Connexion refusée');
    expect(r.fields.find((f) => f.name === 'Raison')?.value).toBe('banned');
  });

  it('déconnexion : raison et durée de session', () => {
    const r = renderGameLog({ type: 'disconnect', data: { ...player(3, 'Viper'), reason: 'Exiting', duration: 3700 } }, ctx);
    expect(r.fields.map((f) => f.name)).toEqual(['Joueur', 'Raison', 'Session']);
  });

  it('kill : tueur → victime, arme, distance ; Discord retrouvé par licence ; pas en base', () => {
    const victim = player(9, 'Cible');
    const discordByLicense = new Map([[victim.identifiers[0]!, '333333333333333333']]);
    const r = renderGameLog({ type: 'kill', data: { killer: player(3, 'Viper'), victim, weapon: 'WEAPON_PISTOL', distance: 23.456, headshot: true } }, { ...ctx, discordByLicense });
    expect(r.route).toBe('game.kills');
    expect(r.description).toContain('**Viper**');
    expect(r.description).toContain('<@333333333333333333>');
    expect(r.fields.find((f) => f.name === 'Arme')?.value).toBe('pistol');
    expect(r.fields.find((f) => f.name === 'Distance')?.value).toBe('23.5 m');
    expect(r.skipDatabase).toBe(true);
    expect(r.targetId).toBe('333333333333333333');
  });

  it('fin de partie : vainqueur, durée, classement', () => {
    const r = renderGameLog({ type: 'match_end', data: { matchId: 'm-42', winner: player(3, 'Viper'), duration: 1260, players: 48, top: [{ name: 'Viper', kills: 7, place: 1 }, { name: 'Bob', kills: 2 }] } }, ctx);
    expect(r.route).toBe('game.matches');
    expect(r.fields.find((f) => f.name === 'Classement')?.value).toBe('1. **Viper** — 7 kill(s)\n2. **Bob** — 2 kill(s)');
  });

  it('sanctions : ban (rouge), staff, durée, effet sur Discord ; warn orange ; unban bleu', () => {
    const ban = renderGameLog({ type: 'ban', data: { target: player(3, 'Viper'), staff: 'Admin Bob', reason: 'Cheat', duration: 86400, discord: 'banned', caseNumber: 12, origin: 'txAdmin' } }, ctx);
    expect(ban.route).toBe('game.sanctions');
    expect(ban.color).toBe(0xef4444);
    expect(ban.fields.map((f) => f.name)).toEqual(['Joueur', 'Staff', 'Durée', 'Raison', 'Origine', 'Sur Discord', 'Case']);
    expect(renderGameLog({ type: 'warn', data: { target: player(3, 'V'), reason: 'x' } }, ctx).color).toBe(0xf59e0b);
    expect(renderGameLog({ type: 'unban', data: { target: player(3, 'V') } }, ctx).color).toBe(0x2f8bff);
  });

  it('sanction reçue par /sanctions (identifiants seuls) : pseudo retrouvé par la licence', () => {
    const r = renderGameLog({ type: 'ban', data: { target: { identifiers: ['license:0123456789abcdef'], discordId: '444444444444444444' }, staff: 'Bob', reason: 'Cheat', discord: 'recorded' } }, { ...ctx, nameByLicense: new Map([['license:0123456789abcdef', 'Viper']]) });
    expect(r.fields[0]!.value).toBe('**Viper** · <@444444444444444444> · `license:0123…cdef`');
    expect(r.fields.find((f) => f.name === 'Sur Discord')?.value).toBe('enregistré (aucune action Discord)');
  });

  it('serveur : événements connus, sinon titre générique ; custom : salon indiqué', () => {
    expect(renderGameLog({ type: 'server', data: { event: 'restart_scheduled', secondsRemaining: 600 } }, ctx).title).toBe('⏰ Redémarrage programmé');
    expect(renderGameLog({ type: 'server', data: { event: 'offline' } }, ctx).color).toBe(0xef4444);
    expect(renderGameLog({ type: 'server', data: { event: 'quelquechose' } }, ctx).title).toBe('⚙️ Serveur de jeu');
    const custom = renderGameLog({ type: 'custom', data: { channel: 'anticheat', title: 'Speedhack', color: '#ff0000', fields: [{ name: 'Vitesse', value: '420 km/h', inline: true }] } }, ctx);
    expect(custom.route).toBe('game.anticheat');
    expect(custom.color).toBe(0xff0000);
    expect(custom.fields).toEqual([{ name: 'Vitesse', value: '420 km/h', inline: true }]);
    expect(customRoute('nimporte')).toBe('game.server');
  });

  it('chat : message cité, pas en base ; anticheat : rouge', () => {
    const chat = renderGameLog({ type: 'chat', data: { ...player(3, 'Viper'), message: 'gg' } }, ctx);
    expect(chat.description).toContain('> gg');
    expect(chat.skipDatabase).toBe(true);
    expect(renderGameLog({ type: 'anticheat', data: { player: player(3, 'V'), reason: 'aimbot' } }, ctx).color).toBe(0xef4444);
  });

  it('helpers : nettoyage, licence courte, joueurs, licences d’un lot, données expurgées', () => {
    expect(cleanText('^1Red ~g~Green')).toBe('Red Green');
    expect(shortLicense('license:0123456789abcdef')).toBe('license:0123…cdef');
    expect(shortLicense('steam:1')).toBeNull();
    expect(parsePlayer('Bob')).toEqual({ id: null, name: 'Bob', license: null, discordId: null });
    expect(collectLicenses([{ type: 'kill', data: { killer: player(1, 'a'), victim: player(2, 'b') } }])).toHaveLength(2);
    expect(redactData({ ids: ['license:abc', 'ip:1.2.3.4', 'xbl:1', 'discord:1'], endpoint: '1.2.3.4:30120' })).toEqual({ ids: ['license:abc', 'discord:1'], endpoint: null });
  });
});

describe('quota par serveur de jeu', () => {
  it('600 entrées / minute, fenêtre fixe', () => {
    let state: { count: number; resetAt: number } | undefined;
    const first = consumeRate(state, 600, 0);
    expect(first.allowed).toBe(true);
    state = first.state;
    const over = consumeRate(state, 1, 30_000);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSec).toBe(30);
    expect(consumeRate(state, 1, 61_000).allowed).toBe(true);
  });
});

describe('POST /api/fivem/servers/:guildId/:serverKey/logs', () => {
  const GUILD = '123456789012345678';
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    const app = express();
    app.use('/api/fivem', createFiveMRouter({ uptimeSeconds: 1 } as never));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/fivem/servers/${GUILD}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    db.fiveMServer.findUnique.mockResolvedValue({ id: 42, guildId: GUILD, key: 'logs', name: 'RS BR', framework: 'CUSTOM', enabled: true, apiKey: null });
    db.fiveMPlayer.findMany.mockResolvedValue([]);
    db.guild.findUnique.mockResolvedValue(null);
    vi.mocked(loggingService.log).mockClear();
  });
  const post = (key: string, body: unknown, apiKey = 'global-api-key') => fetch(`${base}/${key}/logs`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify(body) });

  it('clé API requise', async () => {
    expect((await post('logs', [{ type: 'connect', data: {} }], 'mauvaise-cle')).status).toBe(401);
  });

  it('lot valide : 202, chaque entrée devient un log GAME routé vers la section du jeu', async () => {
    const res = await post('logs', [
      { type: 'connect', ts: 1700000000, data: { id: 1, name: 'Viper', identifiers: ['license:abc', 'discord:222222222222222222'] } },
      { type: 'kill', data: { killer: { id: 1, name: 'Viper' }, victim: { id: 2, name: 'Bob' }, weapon: 'WEAPON_RIFLE' } },
    ]);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, accepted: 2 });
    const calls = vi.mocked(loggingService.log).mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.action)).toEqual(['game.connect', 'game.kill']);
    expect(calls[0]).toMatchObject({ guildId: GUILD, category: 'GAME', targetId: '222222222222222222', game: { serverId: 42, serverName: 'RS BR', route: 'game.connections' }, data: expect.objectContaining({ serverKey: 'logs' }) });
    expect(calls[0]!.timestamp).toEqual(new Date(1700000000 * 1000));
    expect(calls[1]).toMatchObject({ skipDatabase: true, game: { route: 'game.kills' } });
  });

  it('lot invalide : 400 validation', async () => {
    const res = await post('logs', [{ type: 'teleport', data: {} }]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation');
  });

  it('quota dépassé : 429 + Retry-After (rs_bridge garde ses entrées)', async () => {
    db.fiveMServer.findUnique.mockResolvedValue({ id: 43, guildId: GUILD, key: 'busy', name: 'Busy', framework: 'CUSTOM', enabled: true, apiKey: null });
    gameLogService.takeQuota(43, 595);
    const res = await post('busy', Array.from({ length: 10 }, () => ({ type: 'chat', data: { message: 'x' } })));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('ressource Lua rs_bridge ⇄ API', () => {
  it('server/logs.lua envoie un lot conforme à gameLogBatchSchema (POST /logs)', async () => {
    const result = await luaRoutes();
    expect(result.problems).toEqual([]);
    expect(result.summary).toMatch(/\d+ appels Lua/);
    expect(result.notes.some((n) => n.includes('POST /logs'))).toBe(false); // route utilisée par la ressource
  }, 60_000);
});
