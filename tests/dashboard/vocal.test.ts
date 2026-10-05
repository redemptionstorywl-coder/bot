/**
 * Page « Salons vocaux » du dashboard : rendu (lobbies, règles, aperçu, salons actifs), enregistrement validé (Zod + serveur),
 * erreurs converties en messages flash, CSRF obligatoire.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { createPrismaMock } from '../helpers/prisma';
import { CATEGORY_ID, GUILD_ID, STAFF_ROLE_ID, USER_ID, fakeClient, fakeGuild, primeBaseMocks, request, sessionData, setTestEnv, signedCookie } from '../helpers/dashboard';

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
import { NAVIGATION } from '../../dashboard/lib/navigation';
import { MODULE_INFO } from '../../dashboard/lib/modules';

setTestEnv();
const prisma = mockedPrisma as unknown as ReturnType<typeof createPrismaMock>;
const VOICE_ID = '300000000000000003';
const MODELS = ['dashboardSession', 'guild', 'guildSettings', 'logChannel', 'log', 'commandPermission', 'user', 'tempVoiceConfig', 'tempVoiceChannel'];

let server: http.Server;
let base: string;
let currentSession: Record<string, unknown> | null = null;

async function get(p: string) {
  return request(base, 'GET', p, { cookie: signedCookie(env().SESSION_SECRET) });
}

async function post(p: string, body: Record<string, string | string[]>, csrf = true) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const item of Array.isArray(v) ? v : [v]) params.append(k, item);
  if (csrf) params.set('_csrf', 'csrf-test-token');
  return request(base, 'POST', p, { cookie: signedCookie(env().SESSION_SECRET), 'content-type': 'application/x-www-form-urlencoded' }, params.toString());
}

function primeMocks(): void {
  currentSession = sessionData(true);
  primeBaseMocks(prisma, MODELS, () => currentSession, (data) => (currentSession = data));
  prisma.tempVoiceConfig.findUnique.mockResolvedValue({
    guildId: GUILD_ID,
    lobbyIds: [VOICE_ID],
    categoryId: null,
    userLimit: null,
    rules: [{ roleId: STAFF_ROLE_ID, preset: 'fr', emoji: '🇫🇷', template: 'Salon de {name}' }],
    fallback: null,
    ownerPermissions: true,
    transferOwnership: true,
    updatedAt: new Date(),
  });
  prisma.tempVoiceChannel.findMany.mockResolvedValue([{ channelId: VOICE_ID, guildId: GUILD_ID, ownerId: USER_ID, lobbyId: VOICE_ID, createdAt: new Date() }]);
}

beforeAll(async () => {
  primeMocks();
  const guild = fakeGuild();
  // Le salon vocal du faux serveur doit exposer isVoiceBased / members pour la liste des salons actifs
  const voice = (guild.channels as { cache: Map<string, Record<string, unknown>> }).cache.get(VOICE_ID)!;
  voice.isVoiceBased = () => true;
  voice.members = new Map([[USER_ID, { id: USER_ID, user: { bot: false } }]]);
  const app = createApp(fakeClient(guild), { env: env(), sessionMiddleware: createSessionMiddleware(env()) });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

beforeEach(() => {
  primeMocks();
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe('Salons vocaux — navigation et module', () => {
  it('entrée « Salons vocaux » dans Communauté, module vocal décrit', () => {
    expect(NAVIGATION.find((e) => e.key === 'vocal')).toMatchObject({ path: 'vocal', group: 'community', module: 'vocal' });
    expect(MODULE_INFO.vocal).toMatchObject({ group: 'community', path: 'vocal' });
  });
});

describe('GET /vocal', () => {
  it('affiche lobbies, règles avec aperçu, repli et salons actifs', async () => {
    const r = await get(`/guilds/${GUILD_ID}/vocal`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Salons vocaux');
    expect(r.text).toMatch(new RegExp(`<option value="${VOICE_ID}"[^>]*selected`));
    expect(r.text).toContain('data-voice-rule');
    expect(r.text).toContain('Salon de {name}');
    expect(r.text).toContain('name="fallbackTemplate"');
    expect(r.text).toContain('{name}&#39;s lobby');
    expect(r.text).toContain('Salons temporaires actifs');
    expect(r.text).toContain('/js/vocal.js');
    expect(r.text).toContain('id="vocal-data"');
  });
});

describe('POST /vocal/config', () => {
  const valid = () => ({
    lobbyIds: [VOICE_ID],
    categoryId: CATEGORY_ID,
    userLimit: '4',
    rulesJson: JSON.stringify([{ roleId: STAFF_ROLE_ID, preset: 'es', emoji: '🇪🇸', template: 'Sala de {name}' }]),
    fallbackPreset: 'en',
    fallbackEmoji: '🇬🇧',
    fallbackTemplate: "{name}'s lobby",
    ownerPermissions: 'on',
  });

  it('enregistre une configuration valide', async () => {
    const r = await post(`/guilds/${GUILD_ID}/vocal/config`, valid());
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/vocal`);
    expect(prisma.tempVoiceConfig.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.tempVoiceConfig.upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(args.update).toMatchObject({ lobbyIds: [VOICE_ID], categoryId: CATEGORY_ID, userLimit: 4, ownerPermissions: true, transferOwnership: false });
    expect(args.update.rules).toEqual([{ roleId: STAFF_ROLE_ID, preset: 'es', emoji: '🇪🇸', template: 'Sala de {name}' }]);
    expect(args.update.fallback).toEqual({ preset: 'en', emoji: '🇬🇧', template: "{name}'s lobby" });
  });

  it('refuse : modèle sans {name}, salon non vocal, rôle inconnu, doublon de rôle, limite hors bornes', async () => {
    const cases: Record<string, string | string[]>[] = [
      { ...valid(), rulesJson: JSON.stringify([{ roleId: STAFF_ROLE_ID, emoji: '🇪🇸', template: 'Sala' }]) },
      { ...valid(), lobbyIds: ['300000000000000002'] },
      { ...valid(), rulesJson: JSON.stringify([{ roleId: '400000000000000077', emoji: '', template: '{name}' }]) },
      { ...valid(), rulesJson: JSON.stringify([{ roleId: STAFF_ROLE_ID, template: '{name}' }, { roleId: STAFF_ROLE_ID, template: 'x {name}' }]) },
      { ...valid(), userLimit: '150' },
      { ...valid(), fallbackTemplate: 'Lobby' },
    ];
    for (const body of cases) {
      const r = await post(`/guilds/${GUILD_ID}/vocal/config`, body);
      expect([302, 400]).toContain(r.status);
      if (r.status === 302) expect(r.location).toBe(`/guilds/${GUILD_ID}/vocal`);
    }
    expect(prisma.tempVoiceConfig.upsert).not.toHaveBeenCalled();
  });

  it('CSRF obligatoire', async () => {
    const r = await post(`/guilds/${GUILD_ID}/vocal/config`, valid(), false);
    expect(r.status).toBe(403);
    expect(prisma.tempVoiceConfig.upsert).not.toHaveBeenCalled();
  });
});
