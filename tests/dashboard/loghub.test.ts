/**
 * Dashboard « Hub de logs » : page hub / source / non-hub, liaison sécurisée (administrateur de la SOURCE), Logs d'une source.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { PermissionFlagsBits } from 'discord.js';
import type { createPrismaMock } from '../helpers/prisma';
import { GUILD_ID, USER_ID, fakeClient, fakeGuild, primeBaseMocks, request, sessionData, setTestEnv, signedCookie } from '../helpers/dashboard';

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

import { prisma as mockedPrisma } from '../../src/database/client';
import { createApp } from '../../dashboard/app';
import { createSessionMiddleware } from '../../dashboard/auth/session';
import { env } from '../../src/config/env';
import { logHubService } from '../../src/services/LogHubService';
import { NAVIGATION } from '../../dashboard/lib/navigation';

setTestEnv();
const prisma = mockedPrisma as unknown as ReturnType<typeof createPrismaMock>;
const SOURCE_ID = '100000000000000005';
const MODELS = ['dashboardSession', 'guild', 'guildSettings', 'logChannel', 'log', 'logHub', 'logHubSource', 'logHubGame', 'logRoute', 'fiveMServer', 'autoTranslateSettings'];

/** Serveur source : l'utilisateur y est membre SANS Administrateur. */
const sourceMemberAdmin = { value: false };
const source = {
  id: SOURCE_ID,
  name: 'RS Studio',
  ownerId: '500000000000000009',
  iconURL: () => null,
  members: { fetch: vi.fn(async () => ({ id: USER_ID, permissions: { has: (f: bigint) => f === PermissionFlagsBits.Administrator && sourceMemberAdmin.value } })) },
};

let server: http.Server;
let base: string;
let currentSession: Record<string, unknown> | null = null;

function session(admin: boolean) {
  const s = sessionData(true) as Record<string, unknown> & { guilds: { permissions: string }[] };
  if (admin) s.guilds[0]!.permissions = String(0x8);
  return s;
}
const get = (p: string) => request(base, 'GET', p, { cookie: signedCookie(env().SESSION_SECRET) });
const post = (p: string, body: Record<string, string>) => {
  const params = new URLSearchParams(body);
  params.set('_csrf', 'csrf-test-token');
  return request(base, 'POST', p, { cookie: signedCookie(env().SESSION_SECRET), 'content-type': 'application/x-www-form-urlencoded' }, params.toString());
};

function prime(admin = true) {
  currentSession = session(admin);
  primeBaseMocks(prisma, MODELS, () => currentSession, (data) => (currentSession = data));
  logHubService.invalidate();
  sourceMemberAdmin.value = false;
}

beforeAll(async () => {
  prime();
  const guild = fakeGuild();
  const client = fakeClient(guild);
  (client.guilds.cache as unknown as Map<string, unknown>).set(SOURCE_ID, source);
  (guild.members as { me: Record<string, unknown> }).me = { id: '123456789012345678', roles: { highest: { position: 99 } }, permissions: { has: () => true } };
  // L'utilisateur est Administrateur du hub (relu par LogHubService) ; la session dit la même chose (isGuildAdmin).
  ((guild.members as { cache: Map<string, Record<string, unknown>> }).cache.get(USER_ID)!).permissions = { has: (f: bigint) => f === PermissionFlagsBits.Administrator };
  const app = createApp(client, { env: env(), sessionMiddleware: createSessionMiddleware(env()) });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(() => prime());
afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe('Hub de logs (dashboard)', () => {
  it('entrée du menu dans le groupe Sécurité', () => {
    expect(NAVIGATION.find((n) => n.key === 'logHub')).toMatchObject({ path: 'log-hub', group: 'security' });
  });

  it('serveur ordinaire : explique comment créer un hub', async () => {
    const r = await get(`/guilds/${GUILD_ID}/log-hub`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('pas un hub de logs');
    expect(r.text).toContain('/template logs');
    expect(r.text).not.toContain('style="');
  });

  it('hub : sources, serveurs de jeu, routes et bouton de réparation', async () => {
    prisma.logHub.findMany.mockResolvedValue([{ guildId: GUILD_ID, summaryMessageId: null, createdById: USER_ID, createdAt: new Date(), updatedAt: new Date() }]);
    prisma.logHubSource.findMany.mockResolvedValue([{ id: 1, hubGuildId: GUILD_ID, sourceGuildId: SOURCE_ID, label: 'RS Studio', emoji: '🎬', keepLocal: true, linkedById: USER_ID, createdAt: new Date() }]);
    prisma.logRoute.findMany.mockResolvedValue([{ hubGuildId: GUILD_ID, sourceKey: SOURCE_ID, routeKey: 'mod.sanctions', channelId: '300000000000000002' }]);
    const r = await get(`/guilds/${GUILD_ID}/log-hub`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Serveur de logs central');
    expect(r.text).toContain('RS Studio');
    expect(r.text).toContain('Créer les salons manquants');
    expect(r.text).toContain(`routes[${SOURCE_ID}][mod.sanctions]`);
    expect(r.text).toContain('🔨・sanctions');
    expect(r.text).toContain('manquant');
  });

  it('relier une source exige d’être administrateur de la SOURCE (membre relu sur Discord)', async () => {
    prisma.logHub.findMany.mockResolvedValue([{ guildId: GUILD_ID, summaryMessageId: null, createdById: USER_ID, createdAt: new Date(), updatedAt: new Date() }]);
    const refused = await post(`/guilds/${GUILD_ID}/log-hub/sources`, { sourceGuildId: SOURCE_ID });
    expect(refused.status).toBe(302);
    expect(prisma.logHubSource.create).not.toHaveBeenCalled();
    expect(source.members.fetch).toHaveBeenCalledWith({ user: USER_ID, force: true });
    expect(JSON.stringify(currentSession)).toContain('administrateur');

    sourceMemberAdmin.value = true;
    prisma.logHubSource.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 2, keepLocal: true, createdAt: new Date(), ...data }));
    const ok = await post(`/guilds/${GUILD_ID}/log-hub/sources`, { sourceGuildId: SOURCE_ID });
    expect(ok.status).toBe(302);
    expect(prisma.logHubSource.create).toHaveBeenCalledWith({ data: expect.objectContaining({ hubGuildId: GUILD_ID, sourceGuildId: SOURCE_ID, linkedById: USER_ID }) });
  });

  it('les modifications sont réservées aux administrateurs du hub (Gérer le serveur ne suffit pas)', async () => {
    prime(false);
    prisma.logHub.findMany.mockResolvedValue([{ guildId: GUILD_ID, summaryMessageId: null, createdById: USER_ID, createdAt: new Date(), updatedAt: new Date() }]);
    sourceMemberAdmin.value = true;
    const r = await post(`/guilds/${GUILD_ID}/log-hub/sources`, { sourceGuildId: SOURCE_ID });
    expect(r.status).toBe(302);
    expect(prisma.logHubSource.create).not.toHaveBeenCalled();
    const keep = await post(`/guilds/${GUILD_ID}/log-hub/sources/${SOURCE_ID}/keep-local`, {});
    expect(keep.status).toBe(302);
    expect(prisma.logHubSource.updateMany).not.toHaveBeenCalled();
  });

  it('copie locale : coche / décoche', async () => {
    prisma.logHubSource.updateMany.mockResolvedValue({ count: 1 });
    await post(`/guilds/${GUILD_ID}/log-hub/sources/${SOURCE_ID}/keep-local`, {});
    expect(prisma.logHubSource.updateMany).toHaveBeenCalledWith({ where: { hubGuildId: GUILD_ID, sourceGuildId: SOURCE_ID }, data: { keepLocal: false } });
  });

  it('routes : seuls les salons texte du hub et les clés connues sont acceptés', async () => {
    prisma.logHubSource.findMany.mockResolvedValue([{ id: 1, hubGuildId: GUILD_ID, sourceGuildId: SOURCE_ID, label: 'RS Studio', emoji: '🎬', keepLocal: true, linkedById: USER_ID, createdAt: new Date() }]);
    const r = await post(`/guilds/${GUILD_ID}/log-hub/routes`, { [`routes[${SOURCE_ID}][mod.sanctions]`]: '300000000000000002', [`routes[${SOURCE_ID}][inconnue]`]: '300000000000000002', ['routes[999999999999999999][tickets]']: '300000000000000002' });
    expect(r.status).toBe(302);
    expect(prisma.logRoute.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.logRoute.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { hubGuildId: GUILD_ID, sourceKey: SOURCE_ID, routeKey: 'mod.sanctions', channelId: '300000000000000002' } }));
    const bad = await post(`/guilds/${GUILD_ID}/log-hub/routes`, { [`routes[${SOURCE_ID}][mod.sanctions]`]: '300000000000000003' });
    expect(bad.status).toBe(302);
    expect(prisma.logRoute.upsert).toHaveBeenCalledTimes(1);
  });

  it('page Logs d’une source : lien vers le hub', async () => {
    prisma.logHubSource.findFirst.mockResolvedValue({ hubGuildId: SOURCE_ID, sourceGuildId: GUILD_ID, label: 'Test', emoji: '📁', keepLocal: false });
    const r = await get(`/guilds/${GUILD_ID}/logs`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('hub de logs <strong>RS Studio</strong>');
    expect(r.text).toContain('Jeu');
  });
});
