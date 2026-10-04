/**
 * Test de bout en bout : l'application Express réelle (layout EJS, middlewares, routes)
 * avec un client Discord factice et Prisma mocké. Vérifie que chaque page transverse se rend.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { ChannelType, Collection } from 'discord.js';
import type { createPrismaMock } from '../helpers/prisma';

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
import type { RedemptionClient } from '../../src/core/Client';

const prisma = mockedPrisma as unknown as ReturnType<typeof createPrismaMock>;
const GUILD_ID = '100000000000000001';
const USER_ID = '200000000000000001';
const SID = 'test-session-id';

function fakeGuild() {
  const category = { id: '300000000000000001', name: 'Général', type: ChannelType.GuildCategory, parent: null, rawPosition: 0 };
  const text = { id: '300000000000000002', name: 'annonces', type: ChannelType.GuildText, parent: category, rawPosition: 1 };
  const voice = { id: '300000000000000003', name: 'Vocal', type: ChannelType.GuildVoice, parent: null, rawPosition: 2 };
  const channels = new Collection<string, unknown>([[category.id, category], [text.id, text], [voice.id, voice]]);
  const roles = new Collection<string, unknown>([
    [GUILD_ID, { id: GUILD_ID, name: '@everyone', hexColor: '#000000', position: 0, managed: false }],
    ['400000000000000001', { id: '400000000000000001', name: 'Staff', hexColor: '#7c3aed', position: 5, managed: false }],
    ['400000000000000002', { id: '400000000000000002', name: 'Bot', hexColor: '#000000', position: 3, managed: true }],
  ]);
  const user = { id: USER_ID, username: 'tester', bot: false, globalName: 'Tester', createdAt: new Date('2020-01-01'), displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
  const member = {
    id: USER_ID,
    user,
    displayName: 'Tester',
    joinedAt: new Date('2024-01-01'),
    joinedTimestamp: Date.parse('2024-01-01'),
    communicationDisabledUntil: null,
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    guild: { id: GUILD_ID },
    roles: { cache: new Collection([['400000000000000001', roles.get('400000000000000001')]]) },
  };
  const members = new Collection<string, unknown>([[USER_ID, member]]);
  return {
    id: GUILD_ID,
    name: 'Serveur Test',
    icon: null,
    iconURL: () => null,
    ownerId: '500000000000000001',
    memberCount: 42,
    createdAt: new Date('2021-01-01'),
    channels: { cache: channels },
    roles: { cache: roles },
    members: {
      cache: members,
      fetch: async (opts?: { user?: string; query?: string; limit?: number }) => {
        if (opts?.user) return opts.user === USER_ID ? member : Promise.reject(new Error('Unknown Member'));
        return members;
      },
    },
  };
}

function fakeClient(): RedemptionClient {
  const guild = fakeGuild();
  const guilds = new Collection<string, unknown>([[GUILD_ID, guild]]);
  const commands = new Collection<string, unknown>([
    ['ping', { data: { name: 'ping', description: 'Latence du bot' }, category: 'admin', permissions: { internal: 'everyone' } }],
    ['ticket', { data: { name: 'ticket', description: 'Gestion des tickets' }, category: 'tickets', module: 'tickets', permissions: { internal: 'staff' } }],
  ]);
  return {
    isReady: () => true,
    guilds: { cache: guilds },
    users: { cache: new Collection(), fetch: async () => null },
    commands,
    user: { id: '123456789012345678', username: 'RedemptionBot', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png' },
    ws: { ping: 42 },
    uptimeSeconds: 3600,
    bus: new EventEmitter(),
  } as unknown as RedemptionClient;
}

const guildRow = {
  id: GUILD_ID,
  name: 'Serveur Test',
  icon: null,
  kind: 'GENERIC',
  ownerId: '500000000000000001',
  joinedAt: new Date(),
  leftAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  settings: { guildId: GUILD_ID, defaultLanguage: 'fr', timezone: 'Europe/Paris', brandColor: '#7C3AED', adminRoleIds: [], staffRoleIds: ['400000000000000001'], modules: { tickets: true, logs: true }, displayName: null, footerText: null, footerIconUrl: null },
  logChannels: [{ id: 1, guildId: GUILD_ID, category: 'TICKET', channelId: '300000000000000002', enabled: true }],
};

function sessionData(user: boolean, owner = false) {
  return {
    cookie: { originalMaxAge: 604800000, maxAge: 604800000, httpOnly: true, path: '/' },
    csrfToken: 'csrf-test-token',
    ...(user
      ? {
          user: { id: owner ? '900000000000000001' : USER_ID, username: 'tester', globalName: 'Tester', avatar: null },
          guilds: [
            { id: GUILD_ID, name: 'Serveur Test', icon: null, owner: false, permissions: String(0x20) },
            { id: '100000000000000002', name: 'Sans bot', icon: null, owner: true, permissions: '0' },
          ],
          accessToken: 'token',
          fetchedAt: Date.now(),
        }
      : {}),
  };
}

let server: http.Server;
let base: string;
let currentSession: Record<string, unknown> | null = null;

function signedCookie(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const signature = require('cookie-signature') as { sign(val: string, secret: string): string };
  return `rss.sid=s%3A${encodeURIComponent(signature.sign(SID, env().SESSION_SECRET)).replace(/%3A/g, ':')}`;
}

interface Reply {
  status: number;
  location: string | null;
  text: string;
  headers: http.IncomingHttpHeaders;
}

/** Requête HTTP brute (node:http) : évite tout proxy système configuré pour fetch. */
function request(method: string, path: string, headers: Record<string, string>, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const url = new URL(base + path);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { ...headers, ...(body ? { 'content-length': String(Buffer.byteLength(body)) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function get(path: string, opts: { auth?: boolean; owner?: boolean; headers?: Record<string, string> } = {}) {
  currentSession = opts.auth ? sessionData(true, opts.owner) : null;
  const r = await request('GET', path, { ...(opts.auth ? { cookie: signedCookie() } : {}), ...(opts.headers ?? {}) });
  if (r.status >= 500 && process.env.DEBUG_DASH) console.log(path, r.status, r.text.slice(0, 600));
  return r;
}

async function post(path: string, body: Record<string, string> | object, opts: { auth?: boolean; json?: boolean; csrf?: string | null } = {}) {
  currentSession = opts.auth === false ? null : sessionData(true);
  const headers: Record<string, string> = { cookie: signedCookie() };
  let payload: string;
  if (opts.json) {
    headers['content-type'] = 'application/json';
    headers.accept = 'application/json';
    if (opts.csrf !== null) headers['x-csrf-token'] = opts.csrf ?? 'csrf-test-token';
    payload = JSON.stringify(body);
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams(body as Record<string, string>);
    if (opts.csrf !== null) params.set('_csrf', opts.csrf ?? 'csrf-test-token');
    payload = params.toString();
  }
  const r = await request('POST', path, headers, payload);
  if (r.status >= 500 && process.env.DEBUG_DASH) console.log(path, r.status, r.text.slice(0, 600));
  return r;
}

const MODELS = ['dashboardSession', 'guild', 'guildSettings', 'logChannel', 'log', 'commandPermission', 'user', 'ticket', 'warning', 'sanction', 'fiveMServer', 'whitelist', 'whitelistConfig'];
const METHODS = ['findUnique', 'findFirst', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'groupBy', 'aggregate'];

/** vitest `restoreMocks` efface les implémentations avant chaque test : on les réarme ici. */
function primeMocks(): void {
  for (const model of MODELS) {
    for (const method of METHODS) {
      prisma[model][method].mockReset().mockResolvedValue(method.startsWith('find') ? (method === 'findMany' ? [] : null) : method === 'count' ? 0 : method === 'groupBy' ? [] : method.endsWith('Many') ? { count: 0 } : {});
    }
  }
  prisma.dashboardSession.findUnique.mockImplementation(async () => (currentSession ? { sid: SID, data: currentSession, expiresAt: new Date(Date.now() + 60_000) } : null));
  prisma.guild.findUnique.mockResolvedValue(guildRow);
  prisma.guild.findMany.mockResolvedValue([guildRow]);
  prisma.log.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, category: 'TICKET', action: 'ticket.open', actorId: USER_ID, targetId: null, data: { title: 'Ticket #1 ouvert' }, createdAt: new Date() }]);
  prisma.log.count.mockResolvedValue(1);
  prisma.warning.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, userId: USER_ID, moderatorId: '1', reason: 'Spam', active: true, createdAt: new Date() }]);
}

beforeAll(async () => {
  primeMocks();
  const app = createApp(fakeClient(), { env: env(), sessionMiddleware: createSessionMiddleware(env()) });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => primeMocks());

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe('Dashboard — pages publiques', () => {
  it('GET / rend la landing avec les en-têtes de sécurité', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Se connecter avec Discord');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  it('GET /auth/login sans DISCORD_CLIENT_SECRET affiche la page de configuration', async () => {
    const r = await get('/auth/login');
    expect(r.status).toBe(200);
    expect(r.text).toContain('DISCORD_CLIENT_SECRET');
    expect(r.text).toContain('http://localhost:3999/auth/callback');
  });
  it('GET /guilds non connecté redirige vers /auth/login', async () => {
    const r = await get('/guilds');
    expect(r.status).toBe(302);
    expect(r.location).toBe('/auth/login');
  });
  it('404 stylée et JSON pour l’API', async () => {
    const page = await get('/nope');
    expect(page.status).toBe(404);
    expect(page.text).toContain('Page introuvable');
    const api = await get('/api/nope', { auth: true });
    expect(api.status).toBe(404);
    expect(JSON.parse(api.text)).toEqual({ error: 'Ressource introuvable.' });
  });
  it('/api/fivem/health est accessible sans session', async () => {
    const r = await get('/api/fivem/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).ok).toBe(true);
  });
  it('fichiers statiques servis', async () => {
    const css = await get('/css/app.css');
    expect(css.status).toBe(200);
    expect(css.text).toContain('--primary: #7c3aed');
    const js = await get('/js/app.js');
    expect(js.status).toBe(200);
  });
});

describe('Dashboard — pages connectées', () => {
  it('GET / connecté redirige vers /guilds', async () => {
    const r = await get('/', { auth: true });
    expect(r.status).toBe(302);
    expect(r.location).toBe('/guilds');
  });
  it('GET /guilds liste les cartes (Gérer / Inviter)', async () => {
    const r = await get('/guilds', { auth: true });
    expect(r.status).toBe(200);
    expect(r.text).toContain('Serveur Test');
    expect(r.text).toContain(`/guilds/${GUILD_ID}`);
    expect(r.text).toContain('Inviter le bot');
    expect(r.text).toContain('guild_id=100000000000000002');
  });
  it('GET /guilds/:id rend le dashboard avec stats et activité', async () => {
    const r = await get(`/guilds/${GUILD_ID}`, { auth: true });
    expect(r.status).toBe(200);
    expect(r.text).toContain('Activité');
    expect(r.text).not.toContain('Membres par langue');
    expect(r.text).toContain('ticket.open');
    expect(r.text).toContain('aria-current="page"');
  });
  it('403 stylé pour un serveur sans accès', async () => {
    const r = await get('/guilds/100000000000000002', { auth: true });
    expect(r.status).toBe(403);
    expect(r.text).toContain('Accès refusé');
  });
  it('400 pour un identifiant de serveur invalide', async () => {
    const r = await get('/guilds/abc', { auth: true });
    expect(r.status).toBe(400);
  });
  it('GET settings / logs / members / fivem / whitelist se rendent', async () => {
    for (const [path, needle] of [
      ['/settings', 'Type de serveur'],
      ['/settings?tab=modules', 'data-module-toggle="tickets"'],
      ['/settings?tab=commands', 'Permissions par commande'],
      ['/logs', 'Historique'],
      ['/logs?tab=channels', 'Catégorie → salon'],
      ['/logs?category=TICKET&q=ticket&from=2024-01-01&to=2030-01-01', 'ticket.open'],
      ['/members', 'Tester'],
      ['/members?q=test', '@tester'],
      [`/members/${USER_ID}`, 'Avertissements'],
      ['/fivem?tab=integration', 'Installer rs_bridge'],
      ['/whitelist?tab=config', 'Questions du formulaire'],
    ] as const) {
      const r = await get(`/guilds/${GUILD_ID}${path}`, { auth: true });
      expect(r.status, path).toBe(200);
      expect(r.text, path).toContain(needle);
    }
  });
  it('400 lisible sur une query invalide', async () => {
    const r = await get(`/guilds/${GUILD_ID}/logs?from=hier`, { auth: true });
    expect(r.status).toBe(400);
    expect(r.text).toContain('Données invalides');
    expect(r.text).not.toContain('at Object.');
  });
  it('la page Traductions n’existe plus', async () => {
    const r = await get(`/guilds/${GUILD_ID}/translations`, { auth: true });
    expect(r.status).toBe(404);
  });
  it('/admin refuse un non-owner et accepte un owner', async () => {
    const denied = await get('/admin', { auth: true });
    expect(denied.status).toBe(403);
    const ok = await get('/admin', { auth: true, owner: true });
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('Administration globale');
    expect(ok.text).toContain('Recharger les locales');
  });
  it('API overview / channels / roles', async () => {
    const overview = await get(`/api/guilds/${GUILD_ID}/overview`, { auth: true });
    expect(overview.status).toBe(200);
    const o = JSON.parse(overview.text);
    expect(o.members).toBe(42);
    expect(o.modules.total).toBe(20);
    const channels = JSON.parse((await get(`/api/guilds/${GUILD_ID}/channels`, { auth: true })).text);
    expect(channels.text.map((c: { name: string }) => c.name)).toEqual(['annonces']);
    const roles = JSON.parse((await get(`/api/guilds/${GUILD_ID}/roles`, { auth: true })).text);
    expect(roles.roles.map((r: { name: string }) => r.name)).toEqual(['Staff', 'Bot']);
  });
});

describe('Dashboard — mutations', () => {
  it('rejette un POST sans jeton CSRF (403)', async () => {
    const r = await post(`/guilds/${GUILD_ID}/modules/tickets`, { enabled: false }, { json: true, csrf: null });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text).error).toContain('CSRF');
  });
  it('bascule un module avec CSRF valide', async () => {
    const r = await post(`/guilds/${GUILD_ID}/modules/tickets`, { enabled: false }, { json: true });
    expect(r.status).toBe(200);
    const json = JSON.parse(r.text);
    expect(json).toMatchObject({ ok: true, module: 'tickets', enabled: false });
    expect(prisma.guildSettings.upsert).toHaveBeenCalled();
  });
  it('refuse un module inconnu (400)', async () => {
    const r = await post(`/guilds/${GUILD_ID}/modules/unknown`, { enabled: true }, { json: true });
    expect(r.status).toBe(400);
  });
  it('enregistre les paramètres puis redirige', async () => {
    const r = await post(`/guilds/${GUILD_ID}/settings`, { kind: 'PRISON', defaultLanguage: 'fr', brandColor: '#123abc', timezone: 'Europe/Paris', displayName: '', footerText: '', footerIconUrl: '' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/settings`);
    expect(prisma.guild.update).toHaveBeenCalledWith({ where: { id: GUILD_ID }, data: { kind: 'PRISON' } });
  });
  it('refuse des paramètres invalides (400 lisible)', async () => {
    const r = await post(`/guilds/${GUILD_ID}/settings`, { kind: 'NOPE', defaultLanguage: 'fr', brandColor: 'rouge' });
    expect(r.status).toBe(400);
    expect(r.text).toContain('kind');
  });
  it('enregistre les salons de logs', async () => {
    const r = await post(`/guilds/${GUILD_ID}/logs/channels`, { 'channels[TICKET]': '300000000000000002', 'channels[SYSTEM]': '' });
    expect(r.status).toBe(302);
    expect(prisma.logChannel.upsert).toHaveBeenCalled();
    expect(prisma.logChannel.deleteMany).toHaveBeenCalled();
  });
  it('enregistre les permissions de commandes', async () => {
    const r = await post(`/guilds/${GUILD_ID}/commands`, { 'perms[ping][enabled]': 'on', 'perms[ticket][roleIds]': '400000000000000001', 'perms[ticket][enabled]': 'on' });
    expect(r.status).toBe(302);
    expect(prisma.commandPermission.deleteMany).toHaveBeenCalledWith({ where: { guildId: GUILD_ID, commandName: 'ping' } });
    expect(prisma.commandPermission.upsert).toHaveBeenCalled();
  });
  it('POST /auth/logout détruit la session', async () => {
    const r = await post('/auth/logout', {});
    expect(r.status).toBe(302);
    expect(r.location).toBe('/');
    expect(prisma.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { sid: SID } });
  });
});
