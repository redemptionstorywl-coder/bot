/**
 * Harnais partagé des tests bout-en-bout du dashboard : client Discord factice, session signée,
 * requêtes HTTP brutes et réarmement du mock Prisma. Les `vi.mock(...)` restent dans chaque fichier de test.
 */
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { ChannelType, Collection } from 'discord.js';
import { vi } from 'vitest';
import type { RedemptionClient } from '../../src/core/Client';
import type { createPrismaMock } from './prisma';

export const GUILD_ID = '100000000000000001';
export const USER_ID = '200000000000000001';
export const SID = 'test-session-id';
export const TEXT_CHANNEL_ID = '300000000000000002';
export const CATEGORY_ID = '300000000000000001';
export const STAFF_ROLE_ID = '400000000000000001';

export function setTestEnv(): void {
  process.env.DISCORD_TOKEN = 'x'.repeat(40);
  process.env.CLIENT_ID = '123456789012345678';
  process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
  process.env.OWNER_IDS = '900000000000000001';
  process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
  process.env.DASHBOARD_URL = 'http://localhost:3999';
  process.env.DISCORD_CLIENT_SECRET = '';
  process.env.LOG_LEVEL = 'error';
  process.env.NODE_ENV = 'test';
}

export interface FakeGuild {
  id: string;
  name: string;
  sent: unknown[];
  [key: string]: unknown;
}

export function fakeGuild(): FakeGuild {
  const sent: unknown[] = [];
  const guildRef: { current: FakeGuild | null } = { current: null };
  const category = { id: CATEGORY_ID, name: 'Général', type: ChannelType.GuildCategory, parent: null, rawPosition: 0 };
  const text = {
    id: TEXT_CHANNEL_ID,
    name: 'annonces',
    type: ChannelType.GuildText,
    parent: category,
    rawPosition: 1,
    isTextBased: () => true,
    isDMBased: () => false,
    isThread: () => false,
    get guild() {
      return guildRef.current;
    },
    send: vi.fn(async (payload: unknown) => {
      sent.push(payload);
      return { id: '600000000000000001', guild: guildRef.current, edit: vi.fn(async () => ({ id: '600000000000000001' })), delete: vi.fn(async () => null) };
    }),
    messages: { fetch: vi.fn(async () => ({ id: '600000000000000001', author: { id: '123456789012345678' }, edit: vi.fn(async () => null), delete: vi.fn(async () => null), react: vi.fn(async () => null), guild: guildRef.current, components: [] })), delete: vi.fn(async () => null) },
    permissionOverwrites: { edit: vi.fn(async () => null) },
    permissionsFor: () => ({ has: () => true }),
    setParent: vi.fn(async () => null),
  };
  const voice = { id: '300000000000000003', name: 'Vocal', type: ChannelType.GuildVoice, parent: null, rawPosition: 2 };
  const channels = new Collection<string, unknown>([[category.id, category], [text.id, text], [voice.id, voice]]);
  const roles = new Collection<string, unknown>([
    [GUILD_ID, { id: GUILD_ID, name: '@everyone', hexColor: '#000000', position: 0, managed: false }],
    [STAFF_ROLE_ID, { id: STAFF_ROLE_ID, name: 'Staff', hexColor: '#7c3aed', position: 5, managed: false }],
    ['400000000000000002', { id: '400000000000000002', name: 'Bot', hexColor: '#000000', position: 3, managed: true }],
  ]);
  const user = { id: USER_ID, username: 'tester', bot: false, globalName: 'Tester', createdAt: new Date('2020-01-01'), displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png', send: vi.fn(async () => null) };
  const member = {
    id: USER_ID,
    user,
    displayName: 'Tester',
    joinedAt: new Date('2024-01-01'),
    joinedTimestamp: Date.parse('2024-01-01'),
    communicationDisabledUntil: null,
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    get guild() {
      return guildRef.current;
    },
    roles: { cache: new Collection([[STAFF_ROLE_ID, roles.get(STAFF_ROLE_ID)]]) },
    send: vi.fn(async () => null),
  };
  const members = new Collection<string, unknown>([[USER_ID, member]]);
  const guild: FakeGuild = {
    id: GUILD_ID,
    name: 'Serveur Test',
    icon: null,
    iconURL: () => null,
    ownerId: '500000000000000001',
    memberCount: 42,
    createdAt: new Date('2021-01-01'),
    sent,
    channels: { cache: channels, fetch: async (id: string) => channels.get(id) ?? null, everyone: roles.get(GUILD_ID) },
    roles: { cache: roles, everyone: roles.get(GUILD_ID), create: vi.fn(async (opts: { name: string }) => ({ id: '400000000000000009', name: opts.name })) },
    members: {
      cache: members,
      me: { id: '123456789012345678', roles: { highest: { position: 99 } } },
      fetchMe: async () => ({ id: '123456789012345678' }),
      fetch: async (opts?: { user?: string; query?: string; limit?: number } | string) => {
        const id = typeof opts === 'string' ? opts : opts?.user;
        if (id) return id === USER_ID ? member : Promise.reject(new Error('Unknown Member'));
        return members;
      },
    },
  };
  guildRef.current = guild;
  return guild;
}

export function fakeClient(guild: FakeGuild = fakeGuild()): RedemptionClient {
  const guilds = new Collection<string, unknown>([[GUILD_ID, guild]]);
  const commands = new Collection<string, unknown>([
    ['ping', { data: { name: 'ping', description: 'Latence du bot' }, category: 'admin', permissions: { internal: 'everyone' } }],
    ['ticket', { data: { name: 'ticket', description: 'Gestion des tickets' }, category: 'tickets', module: 'tickets', permissions: { internal: 'staff' } }],
  ]);
  const channels = guild.channels as { cache: Collection<string, unknown> };
  return {
    isReady: () => true,
    guilds: { cache: guilds, fetch: async () => guild },
    users: { cache: new Collection(), fetch: async () => null },
    channels: { cache: channels.cache, fetch: async (id: string) => channels.cache.get(id) ?? null },
    commands,
    user: { id: '123456789012345678', username: 'RedemptionBot', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png' },
    ws: { ping: 42 },
    uptimeSeconds: 3600,
    bus: new EventEmitter(),
  } as unknown as RedemptionClient;
}

export const guildRow = {
  id: GUILD_ID,
  name: 'Serveur Test',
  icon: null,
  kind: 'GENERIC',
  ownerId: '500000000000000001',
  joinedAt: new Date(),
  leftAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  settings: {
    guildId: GUILD_ID,
    defaultLanguage: 'fr',
    timezone: 'Europe/Paris',
    brandColor: '#7C3AED',
    adminRoleIds: [],
    staffRoleIds: [STAFF_ROLE_ID],
    modules: { tickets: true, logs: true, embeds: true, announcements: true, welcome: true, rolemenu: true, reactionrole: true, moderation: true, giveaways: true, events: true },
    displayName: null,
    footerText: null,
    footerIconUrl: null,
  },
  logChannels: [{ id: 1, guildId: GUILD_ID, category: 'TICKET', channelId: TEXT_CHANNEL_ID, enabled: true }],
};

export function sessionData(user: boolean, owner = false) {
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

export function signedCookie(secret: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const signature = require('cookie-signature') as { sign(val: string, secret: string): string };
  return `rss.sid=s%3A${encodeURIComponent(signature.sign(SID, secret)).replace(/%3A/g, ':')}`;
}

export interface Reply {
  status: number;
  location: string | null;
  text: string;
  headers: http.IncomingHttpHeaders;
}

/** Requête HTTP brute (node:http) : évite tout proxy système configuré pour fetch. */
export function request(base: string, method: string, path: string, headers: Record<string, string>, body?: string): Promise<Reply> {
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

export const PRISMA_METHODS = ['findUnique', 'findFirst', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'groupBy', 'aggregate'];

/** Réarme les mocks Prisma (vitest `restoreMocks` les efface avant chaque test). */
export function primeBaseMocks(prisma: ReturnType<typeof createPrismaMock>, models: string[], getSession: () => Record<string, unknown> | null, setSession?: (data: Record<string, unknown>) => void): void {
  for (const model of models) {
    for (const method of PRISMA_METHODS) {
      prisma[model][method].mockReset().mockResolvedValue(method.startsWith('find') ? (method === 'findMany' ? [] : null) : method === 'count' ? 0 : method === 'groupBy' ? [] : method === 'aggregate' ? { _avg: {} } : method.endsWith('Many') ? { count: 0 } : {});
    }
  }
  prisma.dashboardSession.findUnique.mockImplementation(async () => {
    const session = getSession();
    return session ? { sid: SID, data: session, expiresAt: new Date(Date.now() + 60_000) } : null;
  });
  if (setSession) {
    // Persistance de la session entre deux requêtes (messages flash) : l'upsert fusionne les données écrites.
    prisma.dashboardSession.upsert.mockImplementation(async (args: { update: { data: Record<string, unknown> } }) => {
      const current = getSession();
      if (current) setSession({ ...current, ...args.update.data });
      return {};
    });
  }
  prisma.guild.findUnique.mockResolvedValue(guildRow);
  prisma.guild.findMany.mockResolvedValue([guildRow]);
}
