/**
 * Tests bout-en-bout des pages de modules FiveM, Whitelist, Battle Royale, School RP et Shop :
 * GET 200 + au moins une mutation par page, conversion des erreurs de service en flash.
 * Prisma est mocké ; seules les méthodes réseau des services sont remplacées via vi.mock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { createPrismaMock } from '../helpers/prisma';
import { GUILD_ID, USER_ID, TEXT_CHANNEL_ID, STAFF_ROLE_ID, fakeClient, fakeGuild, primeBaseMocks, request, sessionData, setTestEnv, signedCookie, type FakeGuild } from '../helpers/dashboard';

vi.hoisted(() => {
  process.env.DISCORD_TOKEN = 'x'.repeat(40);
  process.env.CLIENT_ID = '123456789012345678';
  process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
  process.env.OWNER_IDS = '900000000000000001';
  process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
  process.env.DASHBOARD_URL = 'http://localhost:3999';
  process.env.DISCORD_CLIENT_SECRET = '';
  process.env.LOG_LEVEL = 'error';
  process.env.NODE_ENV = 'test';
});

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

vi.mock('../../src/services/FiveMService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/FiveMService')>();
  const svc = mod.fivemService;
  svc.testConnection = vi.fn(async () => ({ online: true, players: 5, maxPlayers: 64, version: '2.1.0', playerList: [] })) as never;
  return mod;
});

import { prisma as mockedPrisma } from '../../src/database/client';
import { Prisma } from '@prisma/client';
import { createApp } from '../../dashboard/app';
import { createSessionMiddleware } from '../../dashboard/auth/session';
import { env } from '../../src/config/env';
import { fivemService, FiveMError } from '../../src/services/FiveMService';
import { NAVIGATION } from '../../dashboard/lib/navigation';

setTestEnv();
const prisma = mockedPrisma as unknown as ReturnType<typeof createPrismaMock>;
let server: http.Server;
let base: string;
let guild: FakeGuild;
let currentSession: Record<string, unknown> | null = null;

async function get(p: string) {
  const r = await request(base, 'GET', p, { cookie: signedCookie(env().SESSION_SECRET) });
  if (r.status >= 400 && process.env.DEBUG_DASH) console.log(p, r.status, r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000));
  return r;
}

async function post(p: string, body: Record<string, string | string[]>) {
  const headers: Record<string, string> = { cookie: signedCookie(env().SESSION_SECRET), 'content-type': 'application/x-www-form-urlencoded' };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const item of Array.isArray(v) ? v : [v]) params.append(k, item);
  params.set('_csrf', 'csrf-test-token');
  const r = await request(base, 'POST', p, headers, params.toString());
  if (r.status >= 400 && process.env.DEBUG_DASH) console.log(p, r.status, r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000));
  return r;
}

/** Suit la redirection d'un POST et renvoie la page (avec ses messages flash). */
async function follow(r: { location: string | null }) {
  expect(r.location).toBeTruthy();
  return get(r.location!);
}

const MODELS = [
  'dashboardSession', 'guild', 'guildSettings', 'logChannel', 'log', 'commandPermission', 'user', 'sanction',
  'fiveMServer', 'fiveMPlayer', 'whitelist', 'whitelistConfig', 'battleRoyaleProfile', 'battleRoyaleStats', 'battlePass',
  'schoolConfig', 'schoolProfile', 'schoolClass', 'schoolHouse', 'schoolClub', 'schoolClubMember', 'schoolApplication',
  'shopCategory', 'shopProduct', 'shopOrder',
];

const OTHER_USER = '200000000000000002';

const serverRow = {
  id: 1, guildId: GUILD_ID, key: 'main', name: 'Prison RP', framework: 'ESX', host: 'http://1.2.3.4:30120', apiKey: 'secret-key-1234', statusChannelId: TEXT_CHANNEL_ID, statusMessageId: null,
  lastStatus: { online: true, players: 3, maxPlayers: 64, version: '1.0.0', playerList: [{ id: 1, name: 'Bob', identifiers: ['license:abc'], ping: 42 }] }, lastSeenAt: new Date(), maintenance: false, enabled: true, createdAt: new Date(), updatedAt: new Date(),
};
const whitelistRow = { id: 5, guildId: GUILD_ID, userId: USER_ID, identifier: null, status: 'PENDING', answers: [{ question: 'Prénom / Nom', answer: 'Jean Valjean' }], reviewedById: null, reviewedAt: null, note: null, createdAt: new Date(), updatedAt: new Date() };
const brProfile = { id: 1, guildId: GUILD_ID, userId: USER_ID, nickname: 'Tester', identifier: 'license:abc', level: 3, xp: 450, playtimeMinutes: 120, battlePassTier: 1, battlePassXp: 1200, battlePassPremium: false, createdAt: new Date(), updatedAt: new Date() };
const brStats = { id: 1, profileId: 1, season: 1, wins: 4, kills: 20, deaths: 10, matches: 15, damage: 5000, top10: 8, updatedAt: new Date() };
const battlePassRow = { id: 1, guildId: GUILD_ID, season: 1, name: 'Saison 1', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31'), tiers: [{ tier: 1, xpRequired: 1000, freeReward: 'Skin', premiumReward: null }, { tier: 2, xpRequired: 2000 }], active: true, createdAt: new Date() };
const classRow = { id: 1, guildId: GUILD_ID, name: 'Terminale A', teacherId: USER_ID, roleId: STAFF_ROLE_ID, channelId: TEXT_CHANNEL_ID, capacity: 30, _count: { students: 1 } };
const houseRow = { id: 1, guildId: GUILD_ID, name: 'Gryffondor', emoji: '🦁', color: '#FF0000', roleId: null, points: 100, _count: { members: 1 } };
const clubRow = { id: 1, guildId: GUILD_ID, name: 'Théâtre', description: 'Club de théâtre', leaderId: USER_ID, roleId: null, maxMembers: 10, _count: { members: 0 } };
const schoolProfileRow = { id: 1, guildId: GUILD_ID, userId: USER_ID, role: 'STUDENT', firstName: 'Jean', lastName: 'Dupont', classId: null, houseId: 1, points: 12, bio: null, createdAt: new Date(), updatedAt: new Date(), class: null, house: houseRow, clubs: [] };
const applicationRow = { id: 3, guildId: GUILD_ID, userId: USER_ID, role: 'TEACHER', answers: [{ question: 'Motivation', answer: 'Enseigner la magie' }], status: 'PENDING', reviewedById: null, reviewedAt: null, note: null, createdAt: new Date() };
const categoryRow = { id: 1, guildId: GUILD_ID, name: 'Packs', description: null, emoji: '📦', order: 0 };
const productRow = { id: 1, guildId: GUILD_ID, categoryId: 1, name: 'Pack VIP', description: 'Accès VIP 30 jours', price: new Prisma.Decimal('9.99'), currency: 'EUR', imageUrl: null, tebexPackageId: '5581234', tebexUrl: 'https://shop.example.com/package/1', stock: null, enabled: true, createdAt: new Date(), updatedAt: new Date(), category: categoryRow };
const orderRow = { id: 7, guildId: GUILD_ID, userId: USER_ID, productId: 1, quantity: 1, total: new Prisma.Decimal('9.99'), currency: 'EUR', status: 'PENDING', tebexTransactionId: null, ticketId: null, note: null, createdAt: new Date(), updatedAt: new Date(), product: productRow };

function primeMocks(): void {
  currentSession = sessionData(true);
  primeBaseMocks(prisma, MODELS, () => currentSession, (data) => (currentSession = data));
  // FiveM
  prisma.fiveMServer.findMany.mockResolvedValue([serverRow]);
  prisma.fiveMServer.findUnique.mockResolvedValue(serverRow);
  prisma.fiveMServer.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...serverRow, id: 2, ...args.data }));
  prisma.fiveMServer.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...serverRow, ...args.data }));
  prisma.fiveMServer.delete.mockResolvedValue(serverRow);
  // Whitelist
  prisma.whitelist.findMany.mockResolvedValue([whitelistRow]);
  prisma.whitelist.findUnique.mockResolvedValue(whitelistRow);
  prisma.whitelist.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...whitelistRow, ...args.data }));
  prisma.whitelist.groupBy.mockResolvedValue([{ status: 'PENDING', _count: { _all: 1 } }, { status: 'ACCEPTED', _count: { _all: 2 } }]);
  prisma.whitelistConfig.findUnique.mockResolvedValue(null);
  prisma.whitelistConfig.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({ ...args.create, createdAt: new Date(), updatedAt: new Date() }));
  // Battle Royale
  prisma.battleRoyaleProfile.count.mockResolvedValue(1);
  prisma.battleRoyaleProfile.findMany.mockResolvedValue([{ ...brProfile, stats: [brStats] }]);
  prisma.battleRoyaleProfile.findUnique.mockResolvedValue({ ...brProfile, stats: [brStats] });
  prisma.battleRoyaleProfile.findFirst.mockImplementation(async (args: { where: { NOT?: unknown } }) => (args.where.NOT ? null : brProfile));
  prisma.battleRoyaleProfile.upsert.mockResolvedValue(brProfile);
  prisma.battleRoyaleProfile.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...brProfile, ...args.data }));
  prisma.battleRoyaleStats.findMany.mockResolvedValue([{ ...brStats, profile: brProfile }]);
  prisma.battleRoyaleStats.aggregate.mockResolvedValue({ _max: { season: 1 } });
  prisma.battlePass.findMany.mockResolvedValue([battlePassRow]);
  prisma.battlePass.findFirst.mockResolvedValue(battlePassRow);
  prisma.battlePass.findUnique.mockResolvedValue(battlePassRow);
  prisma.battlePass.aggregate.mockResolvedValue({ _max: { season: 1 } });
  prisma.battlePass.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...battlePassRow, id: 2, ...args.data }));
  prisma.battlePass.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...battlePassRow, ...args.data }));
  // School
  prisma.schoolConfig.findUnique.mockResolvedValue(null);
  prisma.schoolConfig.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({ ...args.create, createdAt: new Date(), updatedAt: new Date() }));
  prisma.schoolProfile.findMany.mockResolvedValue([schoolProfileRow]);
  prisma.schoolProfile.count.mockResolvedValue(1);
  prisma.schoolProfile.groupBy.mockResolvedValue([{ role: 'STUDENT', _count: { _all: 1 } }]);
  prisma.schoolProfile.findUnique.mockImplementation(async (args: { where: { guildId_userId?: { userId: string } } }) => (args.where.guildId_userId?.userId === USER_ID ? schoolProfileRow : null));
  prisma.schoolProfile.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...schoolProfileRow, id: 2, ...args.data, class: null, house: null, clubs: [] }));
  prisma.schoolProfile.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...schoolProfileRow, ...args.data }));
  prisma.schoolClass.findMany.mockResolvedValue([classRow]);
  prisma.schoolClass.findFirst.mockImplementation(async (args: { where: { id?: number } }) => (args.where.id ? classRow : null));
  prisma.schoolClass.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...classRow, id: 2, ...args.data }));
  prisma.schoolClass.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...classRow, ...args.data }));
  prisma.schoolClass.delete.mockResolvedValue(classRow);
  prisma.schoolHouse.findMany.mockResolvedValue([houseRow]);
  prisma.schoolHouse.findFirst.mockImplementation(async (args: { where: { id?: number } }) => (args.where.id ? houseRow : null));
  prisma.schoolHouse.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...houseRow, id: 2, ...args.data }));
  prisma.schoolHouse.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...houseRow, ...args.data }));
  prisma.schoolClub.findMany.mockResolvedValue([clubRow]);
  prisma.schoolClub.findFirst.mockImplementation(async (args: { where: { id?: number } }) => (args.where.id ? clubRow : null));
  prisma.schoolClub.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...clubRow, id: 2, ...args.data }));
  prisma.schoolClubMember.findMany.mockResolvedValue([{ id: 1, clubId: 1, profileId: 1, joinedAt: new Date(), profile: schoolProfileRow }]);
  prisma.schoolApplication.findMany.mockResolvedValue([applicationRow]);
  prisma.schoolApplication.findUnique.mockResolvedValue(applicationRow);
  prisma.schoolApplication.count.mockResolvedValue(1);
  prisma.schoolApplication.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...applicationRow, ...args.data }));
  // Shop
  prisma.shopCategory.findMany.mockResolvedValue([categoryRow]);
  prisma.shopCategory.findFirst.mockResolvedValue(categoryRow);
  prisma.shopCategory.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...categoryRow, id: 2, ...args.data }));
  prisma.shopCategory.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...categoryRow, ...args.data }));
  prisma.shopProduct.findMany.mockResolvedValue([productRow]);
  prisma.shopProduct.findUnique.mockResolvedValue(productRow);
  prisma.shopProduct.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...productRow, id: 2, ...args.data }));
  prisma.shopProduct.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...productRow, ...args.data }));
  prisma.shopOrder.findMany.mockResolvedValue([orderRow]);
  prisma.shopOrder.findUnique.mockResolvedValue(orderRow);
  prisma.shopOrder.count.mockResolvedValue(1);
  prisma.shopOrder.groupBy.mockResolvedValue([{ status: 'PENDING', _count: { _all: 1 }, _sum: { total: new Prisma.Decimal('9.99') } }]);
  prisma.shopOrder.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...orderRow, id: 8, ...args.data, product: productRow }));
  prisma.shopOrder.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...orderRow, ...args.data }));
}

beforeAll(async () => {
  primeMocks();
  guild = fakeGuild();
  const app = createApp(fakeClient(guild), { env: env(), sessionMiddleware: createSessionMiddleware(env()) });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => primeMocks());

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe('Navigation', () => {
  it('chaque entrée de jeu du menu a une page dédiée', async () => {
    expect(NAVIGATION.map((e) => e.key)).toEqual(expect.arrayContaining(['fivem', 'whitelist', 'battleRoyale', 'school', 'shop']));
    for (const entry of NAVIGATION.filter((e) => ['fivem', 'whitelist', 'battleRoyale', 'school', 'shop'].includes(e.key))) {
      const r = await get(`/guilds/${GUILD_ID}/${entry.path}`);
      expect(r.status, entry.key).toBe(200);
      expect(r.text, entry.key).not.toContain("en cours d'intégration");
    }
  });
});

describe('États vides', () => {
  it('les cinq pages se rendent sans aucune donnée', async () => {
    for (const model of ['fiveMServer', 'whitelist', 'battleRoyaleProfile', 'battleRoyaleStats', 'battlePass', 'schoolProfile', 'schoolClass', 'schoolHouse', 'schoolClub', 'schoolApplication', 'shopCategory', 'shopProduct', 'shopOrder']) {
      prisma[model].findMany.mockResolvedValue([]);
      prisma[model].findFirst.mockResolvedValue(null);
      prisma[model].count.mockResolvedValue(0);
      prisma[model].groupBy.mockResolvedValue([]);
    }
    prisma.battleRoyaleStats.aggregate.mockResolvedValue({ _max: { season: null } });
    for (const [p, needle] of [
      ['/fivem', 'Aucun serveur FiveM'],
      ['/whitelist?status=all', 'Aucun dossier'],
      ['/battle-royale?tab=seasons', 'Aucune saison'],
      ['/school?tab=houses', 'Aucune maison'],
      ['/shop?tab=stats', 'Aucune commande enregistrée'],
    ] as const) {
      const r = await get(`/guilds/${GUILD_ID}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.text, p).toContain(needle);
    }
  });
});

describe('FiveM', () => {
  it('GET /fivem liste les serveurs avec statut ; l’onglet Installation donne l’API et rs_bridge', async () => {
    const r = await get(`/guilds/${GUILD_ID}/fivem`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Prison RP');
    expect(r.text).toContain('data-state="online"');
    expect(r.text).toContain('3 / 64');
    expect(r.text).not.toContain('secret-key-1234');
    const install = await get(`/guilds/${GUILD_ID}/fivem?tab=integration`);
    expect(install.status).toBe(200);
    expect(install.text).toContain(`http://localhost:3999/api/fivem/servers/${GUILD_ID}/main/status`);
    expect(install.text).toContain('x-api-key');
    expect(install.text).toContain(`Config.GuildId = &#39;${GUILD_ID}&#39;`);
    expect(install.text).toContain('ensure rs_bridge');
    expect(install.text).not.toContain('secret-key-1234');
  });
  it('GET /fivem?server=main affiche les joueurs, les réglages (clé masquée) et la synchronisation', async () => {
    const r = await get(`/guilds/${GUILD_ID}/fivem?server=main`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Bob');
    expect(r.text).toContain('license:abc');
    expect(r.text).not.toContain('secret-key-1234');
    const settings = await get(`/guilds/${GUILD_ID}/fivem?server=main&stab=settings`);
    expect(settings.text).toContain('Modifier « Prison RP »');
    expect(settings.text).toContain('••••••••1234');
    expect(settings.text).not.toContain('secret-key-1234');
    const sync = await get(`/guilds/${GUILD_ID}/fivem?server=main&stab=sync`);
    expect(sync.status).toBe(200);
    expect(sync.text).toContain('name="nicknameFormat"');
    expect(sync.text).toContain('data-nickname-preview');
    expect(sync.text).toContain('/js/fivem.js');
  });
  it('enregistre la synchronisation via FiveMSyncService.updateSyncSettings', async () => {
    const r = await post(`/guilds/${GUILD_ID}/fivem/servers/main/sync`, { syncBansToDiscord: 'on', syncNicknames: 'on', nicknameFormat: '[{id}] {name}', linkedRoleId: STAFF_ROLE_ID, onlineRoleId: '', playerCountChannelId: '', requireDiscord: 'on', requireRoleId: '' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/fivem?server=main&stab=sync`);
    const upd = prisma.fiveMServer.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(upd.data).toMatchObject({ syncBansToDiscord: true, syncBansToGame: false, syncKicks: false, syncNicknames: true, nicknameFormat: '[{id}] {name}', linkedRoleId: STAFF_ROLE_ID, onlineRoleId: null, requireDiscord: true, requireWhitelist: false });
    const bad = await post(`/guilds/${GUILD_ID}/fivem/servers/main/sync`, { nicknameFormat: 'Joueur' });
    const page = await follow(bad);
    expect(page.text).toContain('{name}');
  });
  it('liste les joueurs connus et lie un compte manuellement', async () => {
    prisma.fiveMPlayer.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, discordId: USER_ID, license: 'license:abc', steam: null, fivemId: null, name: 'Bob', serverKey: 'main', lastSeenAt: new Date(), sessionStartedAt: null, playtimeMinutes: 125, online: true, createdAt: new Date(), updatedAt: new Date() }]);
    prisma.fiveMPlayer.count.mockResolvedValue(1);
    const r = await get(`/guilds/${GUILD_ID}/fivem?tab=players&filter=linked&q=bob`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Bob');
    expect(r.text).toContain('2 h 5 min');
    expect(r.text).toContain(`/members/${USER_ID}`);
    prisma.fiveMPlayer.upsert.mockResolvedValue({ id: 2, guildId: GUILD_ID, discordId: OTHER_USER, license: 'license:0123456789abcdef', name: '—' });
    const link = await post(`/guilds/${GUILD_ID}/fivem/players/link`, { userId: OTHER_USER, license: 'license:0123456789abcdef' });
    expect(link.status).toBe(302);
    expect(prisma.fiveMPlayer.upsert).toHaveBeenCalled();
  });
  it('GET /fivem/new rend le formulaire d’ajout', async () => {
    const r = await get(`/guilds/${GUILD_ID}/fivem/new`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Ajouter un serveur');
    expect(r.text).toContain('name="key"');
  });
  it('ajoute, modifie, passe en maintenance, teste et supprime un serveur', async () => {
    prisma.fiveMServer.findUnique.mockResolvedValueOnce(null);
    const add = await post(`/guilds/${GUILD_ID}/fivem/servers`, { key: 'Dev', name: 'Serveur dev', framework: 'QBCORE', host: 'http://localhost:30120/', apiKey: 'k'.repeat(20), enabled: 'on', statusChannelId: '' });
    expect(add.status).toBe(302);
    expect(add.location).toBe(`/guilds/${GUILD_ID}/fivem?server=dev`);
    const created = prisma.fiveMServer.create.mock.calls[0][0] as { data: { key: string; host: string; apiKey: string } };
    expect(created.data.key).toBe('dev');
    expect(created.data.host).toBe('http://localhost:30120');

    const edit = await post(`/guilds/${GUILD_ID}/fivem/servers/main`, { name: 'Prison RP 2', framework: 'ESX', host: '', apiKey: '', clearApiKey: 'on', statusChannelId: TEXT_CHANNEL_ID, enabled: 'on' });
    expect(edit.status).toBe(302);
    const upd = prisma.fiveMServer.update.mock.calls.find((c) => (c[0] as { data: { name?: string } }).data.name === 'Prison RP 2')![0] as { data: { apiKey: unknown; host: unknown } };
    expect(upd.data.apiKey).toBeNull();
    expect(upd.data.host).toBeNull();

    const maint = await post(`/guilds/${GUILD_ID}/fivem/servers/main/maintenance`, { enabled: 'on' });
    const page = await follow(maint);
    expect(page.text).toContain('Maintenance activée');

    const test = await post(`/guilds/${GUILD_ID}/fivem/servers/main/test`, {});
    expect(fivemService.testConnection).toHaveBeenCalled();
    const tested = await follow(test);
    expect(tested.text).toContain('Connexion réussie');
    expect(tested.text).toContain('2.1.0');

    const del = await post(`/guilds/${GUILD_ID}/fivem/servers/main/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.fiveMServer.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
  it('convertit une FiveMError en flash lisible', async () => {
    (fivemService.testConnection as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new FiveMError('unreachable', 'ECONNREFUSED'));
    const r = await post(`/guilds/${GUILD_ID}/fivem/servers/main/test`, {});
    expect(r.status).toBe(302);
    const page = await follow(r);
    expect(page.text).toContain('injoignable');
    expect(page.text).toContain('ECONNREFUSED');
  });
  it('refuse une clé invalide avec un 400 lisible', async () => {
    const r = await post(`/guilds/${GUILD_ID}/fivem/servers`, { key: 'A', name: 'x', framework: 'ESX', host: '' });
    expect(r.status).toBe(400);
    expect(r.text).toContain('clé');
  });
});

describe('Whitelist', () => {
  it('GET /whitelist rend les dossiers, la fiche et la configuration', async () => {
    const r = await get(`/guilds/${GUILD_ID}/whitelist?status=PENDING&q=jean&id=5`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Dossier #5');
    expect(r.text).toContain('Jean Valjean');
    expect(r.text).toContain('Accepter');
    // Message de review rendu avec WhitelistService.buildReviewEmbed
    expect(r.text).toContain('Candidature whitelist #5');
    const cfg = await get(`/guilds/${GUILD_ID}/whitelist?tab=config`);
    expect(cfg.status).toBe(200);
    expect(cfg.text).toContain('Questions du formulaire');
    expect(cfg.text).toContain('Prénom / Nom de votre personnage');
    expect(cfg.text).toContain('data-modal-live="#wl-questions"');
    expect(cfg.text).toContain('Whitelist acceptée');
  });
  it('enregistre la configuration (questions, salon, rôles)', async () => {
    const r = await post(`/guilds/${GUILD_ID}/whitelist/config`, {
      questionsJson: JSON.stringify([{ label: 'Votre expérience RP', style: 'paragraph', required: true }, { id: 'age', label: 'Votre âge', style: 'short', required: false }]),
      reviewChannelId: TEXT_CHANNEL_ID, acceptedRoleId: STAFF_ROLE_ID, pendingRoleId: '', dmOnDecision: 'on', enabled: 'on',
    });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/whitelist?tab=config`);
    const call = prisma.whitelistConfig.upsert.mock.calls[0][0] as { create: { questions: { id: string; required: boolean }[]; reviewChannelId: string; acceptedRoleId: string; pendingRoleId: null } };
    expect(call.create.questions.map((q) => q.id)).toEqual(['votre-experience-rp', 'age']);
    expect(call.create.questions[1].required).toBe(false);
    expect(call.create.reviewChannelId).toBe(TEXT_CHANNEL_ID);
    expect(call.create.pendingRoleId).toBeNull();
    const page = await follow(r);
    expect(page.text).toContain('2 question(s)');
  });
  it('accepte un dossier et lie un identifiant', async () => {
    const r = await post(`/guilds/${GUILD_ID}/whitelist/applications/5/review`, { decision: 'ACCEPTED', note: 'Bienvenue' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/whitelist?status=ACCEPTED&id=5`);
    const upd = prisma.whitelist.update.mock.calls[0][0] as { data: { status: string; reviewedById: string; note: string } };
    expect(upd.data.status).toBe('ACCEPTED');
    expect(upd.data.reviewedById).toBe(USER_ID);
    expect(upd.data.note).toBe('Bienvenue');
    const link = await post(`/guilds/${GUILD_ID}/whitelist/applications/5/identifier`, { identifier: 'license:abcdef0123' });
    expect(link.status).toBe(302);
    expect(prisma.whitelist.updateMany).toHaveBeenCalledWith({ where: { guildId: GUILD_ID, userId: USER_ID }, data: { identifier: 'license:abcdef0123' } });
    const bad = await post(`/guilds/${GUILD_ID}/whitelist/applications/5/identifier`, { identifier: 'pas-un-identifiant' });
    expect(bad.status).toBe(400);
  });
  it('convertit une WhitelistError en flash lisible', async () => {
    prisma.whitelist.findUnique.mockResolvedValue({ ...whitelistRow, status: 'ACCEPTED' });
    const r = await post(`/guilds/${GUILD_ID}/whitelist/applications/5/review`, { decision: 'REJECTED' });
    expect(r.status).toBe(302);
    const page = await follow(r);
    expect(page.text).toContain('déjà été traitée');
  });
});

describe('Battle Royale', () => {
  it('GET /battle-royale rend le classement avec pseudos résolus', async () => {
    const r = await get(`/guilds/${GUILD_ID}/battle-royale?metric=kills&season=1`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('🥇');
    expect(r.text).toContain('Tester');
    expect(r.text).toContain('data-pct="100"');
    expect(r.text).toContain('Saison 1');
  });
  it('GET /battle-royale?tab=profiles rend la fiche (niveau, stats, Battle Pass)', async () => {
    const r = await get(`/guilds/${GUILD_ID}/battle-royale?tab=profiles&user=${USER_ID}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Niveau <strong>3</strong>');
    expect(r.text).toContain('license:abc');
    expect(r.text).toContain('Palier <strong>1</strong>');
    expect(r.text).toContain('Statistiques par saison');
    const byIdentifier = await get(`/guilds/${GUILD_ID}/battle-royale?tab=profiles&identifier=license:abc`);
    expect(byIdentifier.status).toBe(200);
    expect(byIdentifier.text).toContain('Actions admin');
  });
  it('modifie une stat, ajoute de l’XP, lie et délie un identifiant', async () => {
    const stat = await post(`/guilds/${GUILD_ID}/battle-royale/profiles/${USER_ID}/stat`, { field: 'kills', value: '42', season: '1' });
    expect(stat.status).toBe(302);
    expect(stat.location).toBe(`/guilds/${GUILD_ID}/battle-royale?tab=profiles&user=${USER_ID}`);
    const up = prisma.battleRoyaleStats.upsert.mock.calls[0][0] as { update: { kills: number }; where: { profileId_season: { season: number } } };
    expect(up.update.kills).toBe(42);
    expect(up.where.profileId_season.season).toBe(1);

    const xp = await post(`/guilds/${GUILD_ID}/battle-royale/profiles/${USER_ID}/xp`, { amount: '250' });
    const page = await follow(xp);
    expect(page.text).toContain('+250 XP');
    const xpUpdate = prisma.battleRoyaleProfile.update.mock.calls[0][0] as { data: { xp: number; level: number } };
    expect(xpUpdate.data.xp).toBe(700);
    expect(xpUpdate.data.level).toBe(3);

    const link = await post(`/guilds/${GUILD_ID}/battle-royale/profiles/${USER_ID}/link`, { identifier: 'license:newid', nickname: 'Neo' });
    expect(link.status).toBe(302);
    expect(prisma.battleRoyaleProfile.upsert).toHaveBeenCalled();

    const unlink = await post(`/guilds/${GUILD_ID}/battle-royale/profiles/${USER_ID}/unlink`, {});
    expect(unlink.status).toBe(302);
    expect(prisma.battleRoyaleProfile.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { identifier: null } });
  });
  it('convertit une BattleRoyaleError en flash lisible', async () => {
    prisma.battleRoyaleProfile.findFirst.mockResolvedValue({ ...brProfile, id: 9, userId: OTHER_USER });
    const r = await post(`/guilds/${GUILD_ID}/battle-royale/profiles/${USER_ID}/link`, { identifier: 'license:abc' });
    const page = await follow(r);
    expect(page.text).toContain('déjà lié à un autre joueur');
  });
  it('crée une saison avec paliers, active une saison et édite les paliers', async () => {
    const r = await post(`/guilds/${GUILD_ID}/battle-royale/seasons`, { name: 'Saison 2', startsAt: '', endsAt: '2099-06-01T12:00', tiersJson: JSON.stringify([{ tier: 1, xpRequired: 500, freeReward: 'Badge' }, { tier: 2, xpRequired: 1500 }]) });
    expect(r.status).toBe(302);
    const created = prisma.battlePass.create.mock.calls[0][0] as { data: { season: number; name: string; tiers: { tier: number; freeReward: string | null }[] } };
    expect(created.data.season).toBe(2);
    expect(created.data.tiers).toHaveLength(2);
    expect(created.data.tiers[0].freeReward).toBe('Badge');
    expect(prisma.battleRoyaleProfile.updateMany).toHaveBeenCalled();
    const page = await follow(r);
    expect(page.text).toContain('Saison 2 « Saison 2 » créée');

    const dup = await post(`/guilds/${GUILD_ID}/battle-royale/seasons`, { name: 'Saison 3', endsAt: '2099-06-01T12:00', tiersJson: JSON.stringify([{ tier: 1, xpRequired: 500 }, { tier: 1, xpRequired: 900 }]) });
    const dupPage = await follow(dup);
    expect(dupPage.text).toContain('Palier 1 en double');

    const act = await post(`/guilds/${GUILD_ID}/battle-royale/seasons/1/activate`, {});
    expect(act.status).toBe(302);
    expect(prisma.battlePass.updateMany).toHaveBeenCalled();

    const edit = await post(`/guilds/${GUILD_ID}/battle-royale/seasons/1`, { name: 'Saison 1 bis', startsAt: '2026-01-01T00:00', endsAt: '2026-12-31T23:00', tiersJson: JSON.stringify([{ tier: 1, xpRequired: 100 }]) });
    expect(edit.location).toBe(`/guilds/${GUILD_ID}/battle-royale?tab=seasons`);
    const upd = prisma.battlePass.update.mock.calls.find((c) => (c[0] as { data: { name?: string } }).data.name === 'Saison 1 bis')![0] as { data: { tiers: unknown[] } };
    expect(upd.data.tiers).toEqual([{ tier: 1, xpRequired: 100, freeReward: null, premiumReward: null }]);
    const editPage = await get(`/guilds/${GUILD_ID}/battle-royale?tab=seasons&pass=1`);
    expect(editPage.text).toContain('Modifier la saison 1');
  });
});

describe('School RP', () => {
  it('GET /school rend configuration, élèves, fiche, maisons, clubs et candidatures', async () => {
    const r = await get(`/guilds/${GUILD_ID}/school?tab=students&user=${USER_ID}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Dupont');
    expect(r.text).toContain('Modifier le profil');
    expect(r.text).toContain('Gryffondor');
    expect(r.text).toContain('Terminale A');
    const config = await get(`/guilds/${GUILD_ID}/school?tab=config`);
    expect(config.text).toContain('Rôle professeur');
    const housesTab = await get(`/guilds/${GUILD_ID}/school?tab=houses`);
    expect(housesTab.text).toContain('data-pct="100"');
    expect(housesTab.text).toContain('Gryffondor');
    const classesTab = await get(`/guilds/${GUILD_ID}/school?tab=classes`);
    expect(classesTab.text).toContain('Terminale A');
    const club = await get(`/guilds/${GUILD_ID}/school?tab=clubs&club=1`);
    expect(club.text).toContain('Club « Théâtre » — membres');
    const app = await get(`/guilds/${GUILD_ID}/school?tab=applications&app=3`);
    expect(app.text).toContain('Candidature #3');
    expect(app.text).toContain('Enseigner la magie');
    const missing = await get(`/guilds/${GUILD_ID}/school?tab=students&user=${OTHER_USER}`);
    expect(missing.text).toContain('Aucun profil School');
  });
  it('enregistre la configuration', async () => {
    const r = await post(`/guilds/${GUILD_ID}/school/config`, { applicationChannelId: TEXT_CHANNEL_ID, announceChannelId: '', studentRoleId: STAFF_ROLE_ID, teacherRoleId: '', staffRoleId: '' });
    expect(r.status).toBe(302);
    const call = prisma.schoolConfig.upsert.mock.calls[0][0] as { update: { applicationChannelId: string; studentRoleId: string; announceChannelId: null } };
    expect(call.update.applicationChannelId).toBe(TEXT_CHANNEL_ID);
    expect(call.update.studentRoleId).toBe(STAFF_ROLE_ID);
    expect(call.update.announceChannelId).toBeNull();
    const bad = await post(`/guilds/${GUILD_ID}/school/config`, { studentRoleId: '400000000000000099' });
    const page = await follow(bad);
    expect(page.text).toContain('rôle inconnu');
  });
  it('crée, modifie et supprime un profil', async () => {
    const create = await post(`/guilds/${GUILD_ID}/school/students`, { userId: OTHER_USER, firstName: 'Hermione', lastName: 'Granger', role: 'STUDENT', classId: '1', houseId: '1', bio: '' });
    expect(create.status).toBe(302);
    expect(create.location).toBe(`/guilds/${GUILD_ID}/school?tab=students&user=${OTHER_USER}`);
    const created = prisma.schoolProfile.create.mock.calls[0][0] as { data: { firstName: string; classId: number } };
    expect(created.data.firstName).toBe('Hermione');
    expect(created.data.classId).toBe(1);

    const edit = await post(`/guilds/${GUILD_ID}/school/students/${USER_ID}`, { firstName: 'Jean', lastName: 'Dupont', role: 'TEACHER', classId: '1', houseId: '1', points: '20', bio: 'Prof' });
    expect(edit.status).toBe(302);
    const updates = prisma.schoolProfile.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(updates[0]).toMatchObject({ role: 'TEACHER', points: 20, bio: 'Prof' });
    expect(updates.some((d) => d.classId === 1)).toBe(true); // assignClass (classe changée : null → 1)

    const del = await post(`/guilds/${GUILD_ID}/school/students/${USER_ID}/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.schoolProfile.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
  it('CRUD classes, maisons (+ points) et clubs (+ membres)', async () => {
    const cls = await post(`/guilds/${GUILD_ID}/school/classes`, { name: 'Seconde B', teacherId: '', roleId: STAFF_ROLE_ID, channelId: TEXT_CHANNEL_ID, capacity: '25' });
    expect(cls.status).toBe(302);
    expect(prisma.schoolClass.create).toHaveBeenCalled();
    const clsEdit = await post(`/guilds/${GUILD_ID}/school/classes/1`, { name: 'Terminale A', teacherId: USER_ID, roleId: '', channelId: '', capacity: '' });
    expect(clsEdit.status).toBe(302);
    expect(prisma.schoolClass.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: 'Terminale A', teacherId: USER_ID, roleId: null, channelId: null, capacity: null } });
    const clsDel = await post(`/guilds/${GUILD_ID}/school/classes/1/delete`, {});
    expect(clsDel.status).toBe(302);
    expect(prisma.schoolClass.delete).toHaveBeenCalledWith({ where: { id: 1 } });

    const house = await post(`/guilds/${GUILD_ID}/school/houses`, { name: 'Serpentard', emoji: '🐍', color: '00ff00', roleId: '' });
    expect(house.status).toBe(302);
    const hc = prisma.schoolHouse.create.mock.calls[0][0] as { data: { color: string } };
    expect(hc.data.color).toBe('#00FF00');
    const pts = await post(`/guilds/${GUILD_ID}/school/houses/1/points`, { delta: '25', reason: 'Quidditch' });
    const ptsPage = await follow(pts);
    expect(ptsPage.text).toContain('+25 pts → 125 pts');
    expect(prisma.schoolHouse.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { points: 125 } });
    const houseDel = await post(`/guilds/${GUILD_ID}/school/houses/1/delete`, {});
    expect(houseDel.status).toBe(302);

    const club = await post(`/guilds/${GUILD_ID}/school/clubs`, { name: 'Échecs', description: 'Club d’échecs', leaderId: USER_ID, roleId: '', maxMembers: '12' });
    expect(club.status).toBe(302);
    expect(prisma.schoolClub.create).toHaveBeenCalled();
    const join = await post(`/guilds/${GUILD_ID}/school/clubs/1/members`, { userId: USER_ID });
    expect(join.location).toBe(`/guilds/${GUILD_ID}/school?tab=clubs&club=1`);
    expect(prisma.schoolClubMember.create).toHaveBeenCalledWith({ data: { clubId: 1, profileId: 1 } });
    const leave = await post(`/guilds/${GUILD_ID}/school/clubs/1/members/${USER_ID}/remove`, {});
    const leavePage = await follow(leave);
    expect(leavePage.text).toContain('pas membre de ce club'); // SchoolError('not_member') → flash
  });
  it('accepte une candidature', async () => {
    const r = await post(`/guilds/${GUILD_ID}/school/applications/3/review`, { decision: 'ACCEPTED', note: 'Bienvenue professeur' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/school?tab=applications&status=ACCEPTED&app=3`);
    const upd = prisma.schoolApplication.update.mock.calls[0][0] as { data: { status: string; note: string } };
    expect(upd.data.status).toBe('ACCEPTED');
    expect(upd.data.note).toBe('Bienvenue professeur');
    expect(prisma.schoolProfile.updateMany).toHaveBeenCalledWith({ where: { guildId: GUILD_ID, userId: USER_ID }, data: { role: 'TEACHER' } });
  });
});

describe('Shop', () => {
  it('GET /shop rend produits, aperçu, commandes, historique, stats et webhook', async () => {
    const r = await get(`/guilds/${GUILD_ID}/shop?tab=products&product=1`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Pack VIP');
    expect(r.text).toContain('9.99 EUR');
    expect(r.text).toContain('Modifier « Pack VIP »');
    expect(r.text).toContain('Commander'); // bouton de l'annonce construite par buildProductAnnouncement
    expect(r.text).toContain('data-live-preview="/guilds/' + GUILD_ID + '/shop/products/preview"');
    const webhook = await get(`/guilds/${GUILD_ID}/shop?tab=webhook`);
    expect(webhook.text).toContain('http://localhost:3999/api/shop/tebex');
    expect(webhook.text).toContain('x-webhook-secret');
    const statsTab = await get(`/guilds/${GUILD_ID}/shop?tab=stats`);
    expect(statsTab.text).toContain('data-pct="100"');
    const preview = await request(base, 'POST', `/guilds/${GUILD_ID}/shop/products/preview`, { cookie: signedCookie(env().SESSION_SECRET), 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': 'csrf-test-token' }, JSON.stringify({ name: 'Pack Or', price: '19,99', currency: 'eur', categoryId: '1', stock: '' }));
    expect(preview.status).toBe(200);
    const html = JSON.parse(preview.text).html as string;
    expect(html).toContain('Pack Or');
    expect(html).toContain('19.99 EUR');
    expect(html).toContain('Stock illimité');
    const order = await get(`/guilds/${GUILD_ID}/shop?tab=orders&status=PENDING&order=7`);
    expect(order.text).toContain('Commande #7');
    const transitionSelect = order.text.match(/<select id="os-status"[\s\S]*?<\/select>/)?.[0] ?? '';
    expect(transitionSelect).toContain('value="PAID"');
    expect(transitionSelect).toContain('value="CANCELLED"');
    expect(transitionSelect).not.toContain('value="REFUNDED"'); // transition interdite depuis PENDING
    const history = await get(`/guilds/${GUILD_ID}/shop?tab=history&historyUser=${USER_ID}`);
    expect(history.text).toContain('Historique de');
    expect(history.text).toContain('1 commande(s)');
  });
  it('crée, modifie et supprime un produit', async () => {
    const r = await post(`/guilds/${GUILD_ID}/shop/products`, { name: 'Pack Or', description: 'Le meilleur', categoryId: '1', price: '19,99', currency: 'eur', imageUrl: '', stock: '10', tebexPackageId: '777', tebexUrl: 'https://shop.example.com/p/777', enabled: 'on' });
    expect(r.status).toBe(302);
    const created = prisma.shopProduct.create.mock.calls[0][0] as { data: { price: Prisma.Decimal; currency: string; stock: number; categoryId: number } };
    expect(created.data.price.toFixed(2)).toBe('19.99');
    expect(created.data.currency).toBe('EUR');
    expect(created.data.stock).toBe(10);
    expect(created.data.categoryId).toBe(1);
    const bad = await post(`/guilds/${GUILD_ID}/shop/products`, { name: 'Mauvais prix', price: 'abc', currency: 'EUR' });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('prix');

    const edit = await post(`/guilds/${GUILD_ID}/shop/products/1`, { name: 'Pack VIP+', categoryId: '', price: '12.50', currency: 'EUR', stock: '', tebexPackageId: '', tebexUrl: '' });
    expect(edit.location).toBe(`/guilds/${GUILD_ID}/shop?tab=products`);
    const upd = prisma.shopProduct.update.mock.calls[0][0] as { data: { enabled: boolean; stock: null; categoryId: null; price: Prisma.Decimal } };
    expect(upd.data.enabled).toBe(false);
    expect(upd.data.stock).toBeNull();
    expect(upd.data.categoryId).toBeNull();
    expect(upd.data.price.toFixed(2)).toBe('12.50');

    const del = await post(`/guilds/${GUILD_ID}/shop/products/1/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.shopProduct.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
  it('CRUD catégories', async () => {
    const r = await post(`/guilds/${GUILD_ID}/shop/categories`, { name: 'VIP', emoji: '👑', description: '', order: '2' });
    expect(r.status).toBe(302);
    expect(prisma.shopCategory.create).toHaveBeenCalledWith({ data: { guildId: GUILD_ID, name: 'VIP', description: null, emoji: '👑', order: 2 } });
    const edit = await post(`/guilds/${GUILD_ID}/shop/categories/1`, { name: 'Packs 2', order: '0' });
    expect(edit.status).toBe(302);
    expect(prisma.shopCategory.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: 'Packs 2', description: null, emoji: null, order: 0 } });
    const del = await post(`/guilds/${GUILD_ID}/shop/categories/1/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.shopCategory.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
  it('crée une commande manuelle et change son statut selon canTransition', async () => {
    const r = await post(`/guilds/${GUILD_ID}/shop/orders`, { userId: USER_ID, productId: '1', quantity: '2', note: 'Paiement en main propre' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/shop?tab=orders&order=8`);
    const created = prisma.shopOrder.create.mock.calls[0][0] as { data: { quantity: number; total: Prisma.Decimal; status: string } };
    expect(created.data.quantity).toBe(2);
    expect(created.data.total.toFixed(2)).toBe('19.98');
    expect(created.data.status).toBe('PENDING');

    const paid = await post(`/guilds/${GUILD_ID}/shop/orders/7/status`, { status: 'PAID', note: '' });
    const page = await follow(paid);
    expect(page.text).toContain('Commande #7 → Payée');
    const upd = prisma.shopOrder.update.mock.calls[0][0] as { data: { status: string; note?: unknown } };
    expect(upd.data.status).toBe('PAID');
    expect('note' in upd.data).toBe(false);

    const refused = await post(`/guilds/${GUILD_ID}/shop/orders/7/status`, { status: 'REFUNDED' });
    const refusedPage = await follow(refused);
    expect(refusedPage.text).toContain('Transition impossible');
  });
  it('convertit une ShopError en flash lisible', async () => {
    prisma.shopProduct.findUnique.mockResolvedValue({ ...productRow, enabled: false });
    const r = await post(`/guilds/${GUILD_ID}/shop/orders`, { userId: USER_ID, productId: '1', quantity: '1' });
    const page = await follow(r);
    expect(page.text).toContain('pas disponible');
  });
});
