/**
 * Tests bout-en-bout des pages de modules du dashboard (tickets, embeds, annonces, bienvenue, rôles,
 * reaction roles, modération, giveaways, événements) : GET 200 + au moins une mutation par page.
 * Prisma est mocké ; les services sont mockés via vi.mock (méthodes Discord) tout en gardant leurs schémas.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { createPrismaMock } from '../helpers/prisma';
import { GUILD_ID, USER_ID, TEXT_CHANNEL_ID, CATEGORY_ID, STAFF_ROLE_ID, fakeClient, fakeGuild, primeBaseMocks, request, sessionData, setTestEnv, signedCookie, type FakeGuild } from '../helpers/dashboard';

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

const { transcriptDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeFs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeOs = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require('node:path') as typeof import('node:path');
  return { transcriptDir: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'rss-transcripts-')) };
});

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

vi.mock('../../src/services/TranscriptService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/TranscriptService')>();
  return { ...mod, transcriptService: new mod.TranscriptService(transcriptDir) };
});

vi.mock('../../src/services/TicketService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/TicketService')>();
  const svc = mod.ticketService;
  svc.closeTicket = vi.fn(async (input: { ticketId: number }) => ({ ticket: { id: input.ticketId, number: 7 }, transcript: null })) as never;
  svc.claimTicket = vi.fn(async (input: { ticketId: number }) => ({ id: input.ticketId, number: 7 })) as never;
  svc.deleteTicket = vi.fn(async (input: { ticketId: number }) => ({ id: input.ticketId, number: 7 })) as never;
  svc.createPanel = vi.fn(async (opts: { channel: { id: string }; style: string; typeIds: number[] }) => ({ id: 3, guildId: GUILD_ID, channelId: opts.channel.id, messageId: '600000000000000001', embed: {}, typeIds: opts.typeIds, style: opts.style, createdAt: new Date() })) as never;
  svc.deletePanel = vi.fn(async (_guildId: string, id: number) => ({ id })) as never;
  return mod;
});

vi.mock('../../src/services/AnnouncementService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/AnnouncementService')>();
  const svc = mod.announcementService;
  svc.publish = vi.fn(async (id: number) => ({ id, title: 'Annonce', status: 'PUBLISHED', messages: [] })) as never;
  svc.delete = vi.fn(async () => undefined) as never;
  return mod;
});

vi.mock('../../src/services/RoleService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/RoleService')>();
  const svc = mod.roleService;
  svc.publishRoleMenu = vi.fn(async (id: number, channelId: string) => ({ id, channelId, messageId: '600000000000000001' })) as never;
  svc.refreshRoleMenu = vi.fn(async () => true) as never;
  svc.publishNotificationPanel = vi.fn(async () => ({ id: '600000000000000001' })) as never;
  svc.setupDefaults = vi.fn(async () => ({ created: ['400000000000000009'], linked: [] })) as never;
  return mod;
});

vi.mock('../../src/services/ModerationService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/ModerationService')>();
  const svc = mod.moderationService;
  svc.setLockdown = vi.fn(async (_g: string, enabled: boolean) => ({ changed: true, channels: enabled ? 3 : 3, failed: 0 })) as never;
  svc.removeWarning = vi.fn(async (id: number) => ({ warning: { id, userId: USER_ID }, sanction: { caseNumber: 12 } })) as never;
  svc.clearWarnings = vi.fn(async () => ({ cleared: 2, sanction: { caseNumber: 13 } })) as never;
  return mod;
});

vi.mock('../../src/services/GiveawayService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/GiveawayService')>();
  const svc = mod.giveawayService;
  svc.publish = vi.fn(async (g: unknown) => g) as never;
  svc.end = vi.fn(async (id: number) => ({ ok: true, winners: [USER_ID], giveaway: { id, prize: 'Nitro', entries: [] } })) as never;
  svc.reroll = vi.fn(async (id: number) => ({ ok: true, winners: [USER_ID], giveaway: { id, prize: 'Nitro', entries: [] } })) as never;
  svc.cancel = vi.fn(async (id: number) => ({ id, prize: 'Nitro', ended: true, entries: [] })) as never;
  return mod;
});

vi.mock('../../src/services/EventService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/EventService')>();
  const svc = mod.eventService;
  svc.publish = vi.fn(async (e: unknown) => e) as never;
  svc.refreshMessage = vi.fn(async () => undefined) as never;
  svc.cancel = vi.fn(async (id: number) => ({ id, name: 'Soirée', status: 'CANCELLED', participants: [] })) as never;
  svc.remind = vi.fn(async () => true) as never;
  return mod;
});

vi.mock('../../src/services/PollService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/PollService')>();
  const svc = mod.pollService;
  svc.publish = vi.fn(async (p: unknown) => p) as never;
  svc.end = vi.fn(async (id: number) => ({ id, question: 'Q ?', ended: true, votes: [] })) as never;
  return mod;
});

vi.mock('../../src/services/WelcomeService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/WelcomeService')>();
  const svc = mod.welcomeService;
  svc.preview = vi.fn(async () => ({ content: 'Bienvenue !', embeds: [], files: [], components: [] })) as never;
  svc.previewLeave = vi.fn(async () => ({ content: 'Au revoir', embeds: [], files: [], components: [] })) as never;
  return mod;
});

import { prisma as mockedPrisma } from '../../src/database/client';
import { createApp } from '../../dashboard/app';
import { createSessionMiddleware } from '../../dashboard/auth/session';
import { env } from '../../src/config/env';
import { ticketService } from '../../src/services/TicketService';
import { announcementService } from '../../src/services/AnnouncementService';
import { roleService } from '../../src/services/RoleService';
import { moderationService } from '../../src/services/ModerationService';
import { giveawayService } from '../../src/services/GiveawayService';
import { eventService } from '../../src/services/EventService';
import { pollService } from '../../src/services/PollService';
import { welcomeService } from '../../src/services/WelcomeService';
import { parseLocalDateTime, toLocalInputValue } from '../../dashboard/lib/dates';
import { PENDING_MODULE_PAGES } from '../../dashboard/lib/navigation';

setTestEnv();
const prisma = mockedPrisma as unknown as ReturnType<typeof createPrismaMock>;
let server: http.Server;
let base: string;
let guild: FakeGuild;
let currentSession: Record<string, unknown> | null = null;

async function get(p: string) {
  const r = await request(base, 'GET', p, { cookie: signedCookie(env().SESSION_SECRET) });
  if (r.status >= 400 && process.env.DEBUG_DASH) console.log(p, r.status, r.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2000));
  return r;
}

async function post(p: string, body: Record<string, string | string[]>, opts: { json?: boolean } = {}) {
  const headers: Record<string, string> = { cookie: signedCookie(env().SESSION_SECRET) };
  let payload: string;
  if (opts.json) {
    headers['content-type'] = 'application/json';
    headers.accept = 'application/json';
    headers['x-csrf-token'] = 'csrf-test-token';
    payload = JSON.stringify(body);
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) for (const item of Array.isArray(v) ? v : [v]) params.append(k, item);
    params.set('_csrf', 'csrf-test-token');
    payload = params.toString();
  }
  const r = await request(base, 'POST', p, headers, payload);
  if (r.status >= 400 && process.env.DEBUG_DASH) console.log(p, r.status, r.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2000));
  return r;
}

/** Suit la redirection d'un POST et renvoie la page (avec ses messages flash). */
async function follow(r: { location: string | null }) {
  expect(r.location).toBeTruthy();
  return get(r.location!);
}

const MODELS = [
  'dashboardSession', 'guild', 'guildSettings', 'logChannel', 'log', 'commandPermission', 'user',
  'ticket', 'ticketType', 'ticketPanel', 'ticketTranscript', 'ticketMessage', 'warning', 'sanction', 'ban', 'mute', 'moderationConfig',
  'embedTemplate', 'announcement', 'scheduledAnnouncement', 'welcomeConfig', 'leaveConfig', 'autoRole', 'roleMenu', 'reactionRole',
  'notificationRole', 'giveaway', 'giveawayEntry', 'event', 'eventParticipant', 'poll', 'pollVote',
];

const ticketType = { id: 1, guildId: GUILD_ID, key: 'support', label: 'Support', emoji: '🎫', description: 'Aide', categoryId: CATEGORY_ID, archiveCategoryId: null, staffRoleIds: [STAFF_ROLE_ID], questions: [{ id: 'details', label: 'Détails', style: 'paragraph', required: true }], embed: null, welcomeMessage: null, language: 'fr', nameFormat: 'ticket-{number}', maxPerUser: 1, enabled: true, order: 0, createdAt: new Date(), updatedAt: new Date() };
const ticketRow = { id: 10, guildId: GUILD_ID, number: 7, channelId: TEXT_CHANNEL_ID, typeId: 1, userId: USER_ID, status: 'OPEN', claimedById: null, closedById: null, closeReason: null, closedAt: null, formAnswers: [{ question: 'Détails', answer: 'Mon souci' }], participants: [], language: 'fr', createdAt: new Date(), updatedAt: new Date(), type: ticketType, transcript: null };
const embedTemplate = { id: 5, guildId: GUILD_ID, name: 'Maintenance', description: 'Annonce de maintenance', spec: { title: '🛠️ Maintenance', description: 'Le serveur sera indisponible.', color: '#7C3AED' }, buttons: [{ label: 'Statut', style: 'link', url: 'https://example.com' }], createdById: USER_ID, createdAt: new Date(), updatedAt: new Date() };
const announcementRow = { id: 4, guildId: GUILD_ID, title: 'Nouvelle saison', content: 'Hello', spec: { title: 'Saison 2', description: 'C’est parti !' }, channelId: TEXT_CHANNEL_ID, mentionRoleIds: [], mentionEveryone: false, buttons: [], status: 'DRAFT', messages: [], createdById: USER_ID, publishedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date() };
const welcomeRow = { guildId: GUILD_ID, enabled: true, channelId: TEXT_CHANNEL_ID, message: { fr: 'Bienvenue {user}', en: 'Welcome {user}' }, embed: null, imageEnabled: false, imageBackgroundUrl: null, imageTitle: 'BIENVENUE', imageSubtitle: '{username}', dmEnabled: false, dmMessage: null, dmEmbed: null, buttons: [], updatedAt: new Date() };
const roleMenuRow = { id: 2, guildId: GUILD_ID, name: 'Couleurs', channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', style: 'BUTTONS', embed: { title: 'Choisis ta couleur' }, options: [{ roleId: STAFF_ROLE_ID, label: 'Staff' }], minValues: 0, maxValues: 25, exclusive: false, placeholder: null, createdAt: new Date(), updatedAt: new Date() };
const sanctionRow = { id: 1, guildId: GUILD_ID, caseNumber: 12, type: 'WARN', userId: USER_ID, moderatorId: USER_ID, reason: 'Spam', duration: null, channelId: null, metadata: null, createdAt: new Date() };
const giveawayRow = { id: 8, guildId: GUILD_ID, channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', prize: 'Nitro', description: null, winnersCount: 1, endsAt: new Date(Date.now() + 3600_000), requiredRoleId: null, minMessages: 0, language: null, hostId: USER_ID, ended: false, winners: [], createdAt: new Date(), entries: [{ id: 1, giveawayId: 8, userId: USER_ID, createdAt: new Date() }] };
const eventRow = { id: 9, guildId: GUILD_ID, name: 'Soirée RP', description: 'Grande soirée', startsAt: new Date(Date.now() + 86400_000), endsAt: null, location: 'Prison', imageUrl: null, mentionRoleId: null, maxParticipants: 20, channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', language: null, status: 'SCHEDULED', remindersSent: [], reminderOffsets: [60, 10], createdById: USER_ID, createdAt: new Date(), updatedAt: new Date(), participants: [{ id: 1, eventId: 9, userId: USER_ID, joinedAt: new Date() }] };
const pollRow = { id: 3, guildId: GUILD_ID, channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', question: 'Quelle map ?', options: [{ label: 'Désert' }, { label: 'Ville' }], type: 'MULTIPLE', anonymous: false, multiSelect: false, endsAt: null, ended: false, results: null, createdById: USER_ID, createdAt: new Date(), votes: [{ id: 1, pollId: 3, userId: USER_ID, optionIndex: 0, createdAt: new Date() }] };

function primeMocks(): void {
  currentSession = sessionData(true);
  primeBaseMocks(prisma, MODELS, () => currentSession, (data) => (currentSession = data));
  prisma.ticketType.findMany.mockResolvedValue([ticketType]);
  prisma.ticketType.findUnique.mockResolvedValue(ticketType);
  prisma.ticketType.upsert.mockResolvedValue(ticketType);
  prisma.ticketType.update.mockResolvedValue(ticketType);
  prisma.ticket.findMany.mockResolvedValue([ticketRow]);
  prisma.ticket.findUnique.mockResolvedValue(ticketRow);
  prisma.ticket.count.mockResolvedValue(1);
  prisma.ticket.groupBy.mockResolvedValue([{ typeId: 1, _count: { _all: 1 } }]);
  prisma.ticketTranscript.aggregate.mockResolvedValue({ _avg: { durationSeconds: 120, messageCount: 4 } });
  prisma.ticketPanel.findMany.mockResolvedValue([{ id: 3, guildId: GUILD_ID, channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', embed: {}, typeIds: [1], style: 'BUTTONS', createdAt: new Date() }]);
  prisma.embedTemplate.findMany.mockResolvedValue([embedTemplate]);
  prisma.embedTemplate.findUnique.mockImplementation(async (args: { where: { id?: number } }) => (args.where.id === 5 ? embedTemplate : null));
  prisma.embedTemplate.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...embedTemplate, id: 6, ...args.data }));
  prisma.embedTemplate.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...embedTemplate, ...args.data }));
  prisma.announcement.findMany.mockResolvedValue([announcementRow]);
  prisma.announcement.findUnique.mockResolvedValue(announcementRow);
  prisma.announcement.count.mockResolvedValue(1);
  prisma.announcement.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...announcementRow, id: 11, ...args.data }));
  prisma.announcement.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...announcementRow, ...args.data }));
  prisma.scheduledAnnouncement.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 1, status: 'PENDING', ...args.data }));
  prisma.welcomeConfig.findUnique.mockResolvedValue(welcomeRow);
  prisma.welcomeConfig.upsert.mockImplementation(async (args: { update: Record<string, unknown> }) => ({ ...welcomeRow, ...args.update }));
  prisma.leaveConfig.findUnique.mockResolvedValue(null);
  prisma.leaveConfig.upsert.mockImplementation(async (args: { update: Record<string, unknown> }) => ({ guildId: GUILD_ID, enabled: false, channelId: null, message: null, embed: null, imageEnabled: false, imageBackgroundUrl: null, logEnabled: true, updatedAt: new Date(), ...args.update }));
  prisma.autoRole.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, roleId: STAFF_ROLE_ID, type: 'JOIN', delaySeconds: 0, enabled: true, createdAt: new Date() }]);
  prisma.autoRole.upsert.mockResolvedValue({ id: 2, guildId: GUILD_ID, roleId: STAFF_ROLE_ID, type: 'VERIFIED', delaySeconds: 60, enabled: true, createdAt: new Date() });
  prisma.autoRole.deleteMany.mockResolvedValue({ count: 1 });
  prisma.roleMenu.findMany.mockResolvedValue([roleMenuRow]);
  prisma.roleMenu.findUnique.mockResolvedValue(roleMenuRow);
  prisma.roleMenu.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...roleMenuRow, id: 12, ...args.data }));
  prisma.roleMenu.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...roleMenuRow, ...args.data }));
  prisma.notificationRole.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, key: 'announcements', roleId: STAFF_ROLE_ID, label: 'Annonces', emoji: '🔔', description: null, enabled: true, order: 0 }]);
  prisma.notificationRole.upsert.mockResolvedValue({ id: 2, guildId: GUILD_ID, key: 'events', roleId: STAFF_ROLE_ID, label: 'Événements', emoji: '🎉', description: null, enabled: true, order: 1 });
  prisma.notificationRole.deleteMany.mockResolvedValue({ count: 1 });
  prisma.reactionRole.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', emoji: '🎮', roleId: STAFF_ROLE_ID, createdAt: new Date() }]);
  prisma.reactionRole.findUnique.mockResolvedValue({ id: 1, guildId: GUILD_ID, channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', emoji: '🎮', roleId: STAFF_ROLE_ID, createdAt: new Date() });
  prisma.reactionRole.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({ id: 2, createdAt: new Date(), ...args.create }));
  prisma.moderationConfig.findUnique.mockResolvedValue(null);
  prisma.sanction.findMany.mockResolvedValue([sanctionRow]);
  prisma.sanction.findUnique.mockResolvedValue(sanctionRow);
  prisma.sanction.count.mockResolvedValue(1);
  prisma.sanction.groupBy.mockResolvedValue([{ type: 'WARN', _count: { _all: 3 } }, { type: 'BAN', _count: { _all: 1 } }]);
  prisma.warning.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, userId: USER_ID, moderatorId: USER_ID, reason: 'Spam', active: true, createdAt: new Date() }]);
  prisma.warning.count.mockResolvedValue(1);
  prisma.giveaway.findMany.mockResolvedValue([giveawayRow]);
  prisma.giveaway.findUnique.mockResolvedValue(giveawayRow);
  prisma.giveaway.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...giveawayRow, id: 20, entries: [], ...args.data }));
  prisma.event.findMany.mockResolvedValue([eventRow]);
  prisma.event.findUnique.mockResolvedValue(eventRow);
  prisma.event.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...eventRow, id: 21, participants: [], ...args.data }));
  prisma.event.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...eventRow, ...args.data }));
  prisma.poll.findMany.mockResolvedValue([pollRow]);
  prisma.poll.findUnique.mockResolvedValue(pollRow);
  prisma.poll.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...pollRow, id: 22, votes: [], ...args.data }));
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
  fs.rmSync(transcriptDir, { recursive: true, force: true });
});

describe('Pages génériques restantes', () => {
  it('aucune page de module ne reste « en cours d’intégration » (FiveM / Whitelist / Battle Royale / School / Shop : voir modules2.test.ts)', async () => {
    expect(PENDING_MODULE_PAGES).toEqual([]);
    const tickets = await get(`/guilds/${GUILD_ID}/tickets`);
    expect(tickets.status).toBe(200);
    expect(tickets.text).not.toContain("en cours d'intégration");
  });
});

describe('Tickets', () => {
  it('GET /tickets rend liste, types, panneaux et statistiques', async () => {
    const r = await get(`/guilds/${GUILD_ID}/tickets?tab=tickets&status=open&type=1&q=7`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('#7');
    expect(r.text).toContain('Support');
    expect(r.text).toContain('Panneaux publiés');
    expect(r.text).toContain('Répartition par type');
    expect(r.text).toContain('data-pct="100"');
  });
  it('GET /tickets/:id rend la fiche avec les réponses', async () => {
    const r = await get(`/guilds/${GUILD_ID}/tickets/10`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Mon souci');
    expect(r.text).toContain('Fermer le ticket');
  });
  it('crée un type avec questions et embed JSON', async () => {
    prisma.ticketType.findUnique.mockResolvedValue(null);
    const r = await post(`/guilds/${GUILD_ID}/tickets/types`, {
      key: 'bug', label: 'Bug', emoji: '🐛', description: '', categoryId: CATEGORY_ID, archiveCategoryId: '', staffRoleIds: STAFF_ROLE_ID,
      questionsJson: JSON.stringify([{ label: 'Décrivez le bug', style: 'paragraph', required: true, maxLength: 500 }]),
      embedJson: '{"title":"🐛 Bug","color":"#EF4444"}', welcomeMessage: 'Merci {user}', language: 'fr', nameFormat: 'bug-{number}', maxPerUser: '2', enabled: 'on', order: '1',
    });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/tickets?tab=types`);
    expect(prisma.ticketType.upsert).toHaveBeenCalled();
    const call = prisma.ticketType.upsert.mock.calls[0][0] as { create: { questions: { id: string; label: string }[]; embed: { title: string } } };
    expect(call.create.questions[0].id).toBe('decrivez-le-bug');
    expect(call.create.embed.title).toBe('🐛 Bug');
  });
  it('refuse un type invalide avec un flash lisible', async () => {
    const r = await post(`/guilds/${GUILD_ID}/tickets/types`, { key: 'BUG!', label: '', questionsJson: '[]', embedJson: '', nameFormat: 'x', maxPerUser: '1', order: '0' });
    expect(r.status).toBe(400);
    expect(r.text).toContain('clé');
  });
  it('met à jour et supprime un type', async () => {
    const upd = await post(`/guilds/${GUILD_ID}/tickets/types/1`, { key: 'support', label: 'Support+', questionsJson: '[]', embedJson: '', nameFormat: 'ticket-{number}', maxPerUser: '3', order: '0', enabled: 'on', language: '' });
    expect(upd.status).toBe(302);
    expect(prisma.ticketType.update).toHaveBeenCalled();
    const del = await post(`/guilds/${GUILD_ID}/tickets/types/1/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.ticketType.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
  it('publie et supprime un panneau', async () => {
    const r = await post(`/guilds/${GUILD_ID}/tickets/panels`, { channelId: TEXT_CHANNEL_ID, style: 'SELECT', typeIds: '1', embedJson: '' });
    expect(r.status).toBe(302);
    expect(ticketService.createPanel).toHaveBeenCalledWith(expect.objectContaining({ style: 'SELECT', typeIds: [1] }));
    const page = await follow(r);
    expect(page.text).toContain('Panneau publié');
    const del = await post(`/guilds/${GUILD_ID}/tickets/panels/3/delete`, {});
    expect(del.status).toBe(302);
    expect(ticketService.deletePanel).toHaveBeenCalledWith(GUILD_ID, 3);
  });
  it('ferme, prend en charge et supprime un ticket', async () => {
    const close = await post(`/guilds/${GUILD_ID}/tickets/10/close`, { reason: 'Résolu' });
    expect(close.status).toBe(302);
    expect(ticketService.closeTicket).toHaveBeenCalledWith({ ticketId: 10, closedById: USER_ID, reason: 'Résolu' });
    const claim = await post(`/guilds/${GUILD_ID}/tickets/10/claim`, {});
    expect(claim.status).toBe(302);
    expect(ticketService.claimTicket).toHaveBeenCalledWith({ ticketId: 10, staffId: USER_ID });
    const del = await post(`/guilds/${GUILD_ID}/tickets/10/delete`, {});
    expect(del.location).toBe(`/guilds/${GUILD_ID}/tickets?tab=tickets`);
    expect(ticketService.deleteTicket).toHaveBeenCalledWith({ ticketId: 10, byId: USER_ID });
  });
  it('convertit une TicketError en flash lisible', async () => {
    (ticketService.claimTicket as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new (await import('../../src/services/TicketService')).TicketError('already_closed'));
    const r = await post(`/guilds/${GUILD_ID}/tickets/10/claim`, {});
    expect(r.status).toBe(302);
    const page = await follow(r);
    expect(page.text).toContain('Ce ticket est déjà fermé.');
  });
  it('sert les transcripts depuis uploads/transcripts en vérifiant le chemin', async () => {
    const dir = path.join(transcriptDir, GUILD_ID);
    fs.mkdirSync(dir, { recursive: true });
    const htmlPath = path.join(dir, 'ticket-7.html');
    fs.writeFileSync(htmlPath, '<!doctype html><html><body>Transcript 7</body></html>');
    const transcript = { id: 1, ticketId: 10, htmlPath, txtPath: path.join(dir, 'ticket-7.txt'), pdfPath: path.join(transcriptDir, '100000000000000002', 'ticket-7.pdf'), messageCount: 4, durationSeconds: 120, staffIds: [], closeReason: null, createdAt: new Date() };
    prisma.ticket.findUnique.mockResolvedValue({ ...ticketRow, status: 'CLOSED', transcript });
    const html = await get(`/guilds/${GUILD_ID}/tickets/10/transcript/html`);
    expect(html.status).toBe(200);
    expect(html.text).toContain('Transcript 7');
    expect(html.headers['content-security-policy']).toContain("default-src 'none'");
    const missing = await get(`/guilds/${GUILD_ID}/tickets/10/transcript/txt`);
    expect(missing.status).toBe(404);
    const traversal = await get(`/guilds/${GUILD_ID}/tickets/10/transcript/pdf`);
    expect(traversal.status).toBe(403);
    const bad = await get(`/guilds/${GUILD_ID}/tickets/10/transcript/exe`);
    expect(bad.status).toBe(400);
  });
});

describe('Embeds', () => {
  it('GET /embeds liste les templates avec aperçu', async () => {
    const r = await get(`/guilds/${GUILD_ID}/embeds`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Maintenance');
    expect(r.text).toContain('data-embed-color="#7C3AED"');
    expect(r.text).toContain('dbtn-link');
  });
  it('GET /embeds/:id rend l’éditeur pré-rempli', async () => {
    const r = await get(`/guilds/${GUILD_ID}/embeds/5`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('value="🛠️ Maintenance"');
    expect(r.text).toContain('data-embed-editor');
    expect(r.text).toContain('Envoyer dans un salon');
  });
  it('crée un template depuis l’éditeur', async () => {
    const r = await post(`/guilds/${GUILD_ID}/embeds`, {
      name: 'Patch', description: '', 'embed[title]': 'Patch 1.2', 'embed[description]': 'Nouveautés', 'embed[color]': '#123456', 'embed[timestamp]': 'on', 'embed[footerText]': 'RSS',
      'embed[fieldsJson]': JSON.stringify([{ name: 'Ajouts', value: 'Beaucoup', inline: true }]),
      buttonsJson: JSON.stringify([{ label: 'Site', style: 'link', url: 'https://example.com' }, { label: 'Vide', style: 'secondary', customId: '' }]),
    });
    expect(r.status).toBe(400);
    expect(r.text).toContain('buttonsJson');
  });
  it('crée un template valide, le met à jour, l’exporte et le supprime', async () => {
    const r = await post(`/guilds/${GUILD_ID}/embeds`, { name: 'Patch', 'embed[title]': 'Patch 1.2', 'embed[color]': '123456', 'embed[fieldsJson]': '[]', buttonsJson: JSON.stringify([{ label: 'Site', style: 'link', url: 'https://example.com' }]) });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/embeds`);
    const created = prisma.embedTemplate.create.mock.calls[0][0] as { data: { spec: { color: string; title: string }; buttons: unknown[] } };
    expect(created.data.spec).toEqual({ title: 'Patch 1.2', color: '#123456' });
    expect(created.data.buttons).toHaveLength(1);
    const upd = await post(`/guilds/${GUILD_ID}/embeds/5`, { name: 'Maintenance', 'embed[title]': 'Maintenance 2', 'embed[fieldsJson]': '[]', buttonsJson: '[]' });
    expect(upd.status).toBe(302);
    expect(prisma.embedTemplate.update).toHaveBeenCalled();
    const exp = await get(`/guilds/${GUILD_ID}/embeds/5/export`);
    expect(exp.status).toBe(200);
    expect(JSON.parse(exp.text).embeds[0].title).toBe('🛠️ Maintenance');
    const del = await post(`/guilds/${GUILD_ID}/embeds/5/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.embedTemplate.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });
  it('importe un JSON et envoie un template dans un salon', async () => {
    const imp = await post(`/guilds/${GUILD_ID}/embeds/import`, { name: 'Importé', json: JSON.stringify({ content: 'Salut', embeds: [{ title: 'Hello' }], buttons: [] }) });
    expect(imp.status).toBe(302);
    expect(imp.location).toBe(`/guilds/${GUILD_ID}/embeds/6`);
    const send = await post(`/guilds/${GUILD_ID}/embeds/5/send`, { channelId: TEXT_CHANNEL_ID, content: 'Annonce' });
    expect(send.status).toBe(302);
    expect(guild.sent.length).toBeGreaterThan(0);
    const last = guild.sent[guild.sent.length - 1] as { content?: string; embeds: unknown[] };
    expect(last.content).toBe('Annonce');
    expect(last.embeds).toHaveLength(1);
    const defaults = await post(`/guilds/${GUILD_ID}/embeds/defaults`, {});
    expect(defaults.status).not.toBe(302);
  });
});

describe('Formulaires de création', () => {
  it('les pages « nouveau » se rendent', async () => {
    for (const [p, needle] of [
      ['/tickets/types/new', 'Nouveau type de ticket'],
      ['/embeds/new', 'Nouveau template'],
      ['/announcements/new', 'Nouvelle annonce'],
      ['/roles/menus/new', 'Nouveau role menu'],
      ['/events/new', 'Nouvel événement'],
    ] as const) {
      const r = await get(`/guilds/${GUILD_ID}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.text, p).toContain(needle);
    }
  });
  it('404 lisible sur une ressource d’un autre serveur', async () => {
    prisma.embedTemplate.findUnique.mockResolvedValue({ ...embedTemplate, guildId: '100000000000000002' });
    const r = await get(`/guilds/${GUILD_ID}/embeds/5`);
    expect(r.status).toBe(404);
    expect(r.text).toContain('Template introuvable');
  });
});

describe('Dates locales', () => {
  it('convertit datetime-local ↔ Date dans le fuseau du serveur', () => {
    const d = parseLocalDateTime('2026-07-14T20:30', 'Europe/Paris');
    expect(d?.toISOString()).toBe('2026-07-14T18:30:00.000Z');
    expect(toLocalInputValue(d, 'Europe/Paris')).toBe('2026-07-14T20:30');
    expect(parseLocalDateTime('hier', 'Europe/Paris')).toBeNull();
    const winter = parseLocalDateTime('2026-01-10T09:00', 'Europe/Paris');
    expect(winter?.toISOString()).toBe('2026-01-10T08:00:00.000Z');
  });
});

describe('Annonces', () => {
  it('GET /announcements rend les colonnes par statut', async () => {
    const r = await get(`/guilds/${GUILD_ID}/announcements`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Brouillons');
    expect(r.text).toContain('Nouvelle saison');
  });
  it('GET /announcements/:id rend l’éditeur et l’aperçu', async () => {
    const r = await get(`/guilds/${GUILD_ID}/announcements/4`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Saison 2');
    expect(r.text).toContain('Programmer');
    expect(r.text).not.toContain('Traductions');
    const preview = await get(`/guilds/${GUILD_ID}/announcements/4/preview`);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain('Saison 2');
  });
  it('crée une annonce puis la met à jour', async () => {
    const r = await post(`/guilds/${GUILD_ID}/announcements`, {
      title: 'Maintenance', content: 'Ce soir', channelId: TEXT_CHANNEL_ID, mentionRoleIds: STAFF_ROLE_ID, mentionEveryone: 'on',
      'embed[title]': 'Maintenance', 'embed[description]': 'Serveur fermé', 'embed[fieldsJson]': '[]', buttonsJson: '[]',
    });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/announcements/11`);
    const created = prisma.announcement.create.mock.calls[0][0] as { data: Record<string, unknown> & { mentionEveryone: boolean; channelId: string } };
    expect(created.data).not.toHaveProperty('translations');
    expect(created.data.channelId).toBe(TEXT_CHANNEL_ID);
    expect(created.data.mentionEveryone).toBe(true);
    const upd = await post(`/guilds/${GUILD_ID}/announcements/4`, { title: 'Nouvelle saison 2', 'embed[title]': 'Saison 2', 'embed[fieldsJson]': '[]', buttonsJson: '[]' });
    expect(upd.status).toBe(302);
    expect(prisma.announcement.update).toHaveBeenCalled();
  });
  it('publie, programme, annule la programmation, duplique, archive et supprime', async () => {
    const pub = await post(`/guilds/${GUILD_ID}/announcements/4/publish`, {});
    expect(pub.status).toBe(302);
    expect(announcementService.publish).toHaveBeenCalledWith(4, { actorId: USER_ID });
    const sched = await post(`/guilds/${GUILD_ID}/announcements/4/schedule`, { scheduledAt: '2099-01-01T10:00' });
    expect(sched.status).toBe(302);
    expect(prisma.scheduledAnnouncement.create).toHaveBeenCalled();
    const past = await post(`/guilds/${GUILD_ID}/announcements/4/schedule`, { scheduledAt: '2000-01-01T10:00' });
    const page = await follow(past);
    expect(page.text).toContain('doit être dans le futur');
    const cancel = await post(`/guilds/${GUILD_ID}/announcements/4/cancel-schedule`, {});
    expect(cancel.status).toBe(302);
    const dup = await post(`/guilds/${GUILD_ID}/announcements/4/duplicate`, {});
    expect(dup.location).toBe(`/guilds/${GUILD_ID}/announcements/11`);
    const arch = await post(`/guilds/${GUILD_ID}/announcements/4/archive`, {});
    expect(arch.status).toBe(302);
    const del = await post(`/guilds/${GUILD_ID}/announcements/4/delete`, {});
    expect(del.location).toBe(`/guilds/${GUILD_ID}/announcements`);
    expect(announcementService.delete).toHaveBeenCalledWith(4, USER_ID);
  });
});

describe('Bienvenue', () => {
  it('GET /welcome rend les onglets bienvenue / départ (sans onglet Langues)', async () => {
    const r = await get(`/guilds/${GUILD_ID}/welcome`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Bienvenue {user}');
    expect(r.text).not.toContain('Rôles de langue');
    expect(r.text).toContain('{memberCount}');
  });
  it('enregistre la configuration de bienvenue (message unique + embed formulaire)', async () => {
    const r = await post(`/guilds/${GUILD_ID}/welcome`, {
      enabled: 'on', channelId: TEXT_CHANNEL_ID, message: 'Salut {user}', embedMode: 'form', 'embed[title]': 'Bienvenue', 'embed[fieldsJson]': '[]',
      imageEnabled: 'on', imageTitle: 'BIENVENUE', imageSubtitle: '{username}', dmEnabled: 'on', dmMessage: 'Bienvenue en DM', buttonsJson: JSON.stringify([{ label: 'Règles', style: 'link', url: 'https://example.com' }]),
    });
    expect(r.status).toBe(302);
    const call = prisma.welcomeConfig.upsert.mock.calls[0][0] as { update: Record<string, unknown> & { message: unknown; embed: unknown; dmMessage: unknown; buttons: unknown[] } };
    expect(call.update.message).toBe('Salut {user}');
    expect(call.update).not.toHaveProperty('languagePromptEnabled');
    expect(call.update.embed).toEqual({ title: 'Bienvenue' });
    expect(call.update.dmMessage).toBe('Bienvenue en DM');
    expect(call.update.buttons).toHaveLength(1);
  });
  it('enregistre le départ et envoie un test', async () => {
    const leave = await post(`/guilds/${GUILD_ID}/welcome/leave`, { enabled: 'on', channelId: TEXT_CHANNEL_ID, message: 'Bye {username}', embedJson: '{"title":"Au revoir"}', logEnabled: 'on' });
    expect(leave.status).toBe(302);
    expect(prisma.leaveConfig.upsert).toHaveBeenCalled();
    const before = guild.sent.length;
    const test = await post(`/guilds/${GUILD_ID}/welcome/test`, { kind: 'welcome' });
    expect(test.status).toBe(302);
    expect(welcomeService.preview).toHaveBeenCalled();
    expect(guild.sent.length).toBe(before + 1);
    const page = await follow(test);
    expect(page.text).toContain('test envoyé');
  });
});

describe('Rôles', () => {
  it('GET /roles rend auto-roles, menus et notifications', async () => {
    const r = await get(`/guilds/${GUILD_ID}/roles?tab=menus`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Couleurs');
    expect(r.text).toContain('Annonces');
    expect(r.text).toContain('arrivée');
  });
  it('ajoute et retire un auto-role', async () => {
    const add = await post(`/guilds/${GUILD_ID}/roles/autoroles`, { roleId: STAFF_ROLE_ID, type: 'VERIFIED', delayMinutes: '5' });
    expect(add.status).toBe(302);
    expect(prisma.autoRole.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { guildId: GUILD_ID, roleId: STAFF_ROLE_ID, type: 'VERIFIED', delaySeconds: 300 } }));
    const managed = await post(`/guilds/${GUILD_ID}/roles/autoroles`, { roleId: '400000000000000002', type: 'JOIN', delayMinutes: '0' });
    const page = await follow(managed);
    expect(page.text).toContain('géré par une intégration');
    const del = await post(`/guilds/${GUILD_ID}/roles/autoroles/delete`, { roleId: STAFF_ROLE_ID, type: 'JOIN' });
    expect(del.status).toBe(302);
    expect(prisma.autoRole.deleteMany).toHaveBeenCalled();
  });
  it('crée, édite, publie, rafraîchit et supprime un role menu', async () => {
    const form = await get(`/guilds/${GUILD_ID}/roles/menus/2`);
    expect(form.status).toBe(200);
    expect(form.text).toContain('Choisis ta couleur');
    const create = await post(`/guilds/${GUILD_ID}/roles/menus`, { name: 'Jeux', style: 'SELECT', exclusive: 'on', placeholder: 'Choisis', minValues: '0', maxValues: '3', 'embed[title]': 'Tes jeux', 'embed[fieldsJson]': '[]', optionsJson: JSON.stringify([{ roleId: STAFF_ROLE_ID, label: 'Staff', emoji: '', description: '', style: '' }]) });
    expect(create.location).toBe(`/guilds/${GUILD_ID}/roles/menus/12`);
    const created = prisma.roleMenu.create.mock.calls[0][0] as { data: { options: { roleId: string; label: string }[]; exclusive: boolean } };
    expect(created.data.options).toEqual([{ roleId: STAFF_ROLE_ID, label: 'Staff' }]);
    expect(created.data.exclusive).toBe(true);
    const update = await post(`/guilds/${GUILD_ID}/roles/menus/2`, { name: 'Couleurs 2', style: 'BUTTONS', minValues: '0', maxValues: '25', 'embed[title]': 'Couleurs', 'embed[fieldsJson]': '[]', optionsJson: '[]' });
    expect(update.status).toBe(302);
    expect(roleService.refreshRoleMenu).toHaveBeenCalledWith(2);
    const publish = await post(`/guilds/${GUILD_ID}/roles/menus/2/publish`, { channelId: TEXT_CHANNEL_ID });
    expect(publish.status).toBe(302);
    expect(roleService.publishRoleMenu).toHaveBeenCalledWith(2, TEXT_CHANNEL_ID);
    const refresh = await post(`/guilds/${GUILD_ID}/roles/menus/2/refresh`, {});
    expect(refresh.status).toBe(302);
    const del = await post(`/guilds/${GUILD_ID}/roles/menus/2/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.roleMenu.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });
  it('gère les notifications (setup, upsert, publication, suppression)', async () => {
    const setup = await post(`/guilds/${GUILD_ID}/roles/notifications/setup`, {});
    expect(setup.status).toBe(302);
    expect(roleService.setupDefaults).toHaveBeenCalled();
    const upsert = await post(`/guilds/${GUILD_ID}/roles/notifications`, { key: 'events', roleId: STAFF_ROLE_ID, label: 'Événements', emoji: '🎉', description: '', order: '1', enabled: 'on' });
    expect(upsert.status).toBe(302);
    expect(prisma.notificationRole.upsert).toHaveBeenCalled();
    const publish = await post(`/guilds/${GUILD_ID}/roles/notifications/publish`, { channelId: TEXT_CHANNEL_ID, style: 'BUTTONS' });
    expect(publish.status).toBe(302);
    expect(roleService.publishNotificationPanel).toHaveBeenCalledWith(GUILD_ID, TEXT_CHANNEL_ID, 'BUTTONS');
    const del = await post(`/guilds/${GUILD_ID}/roles/notifications/announcements/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.notificationRole.deleteMany).toHaveBeenCalledWith({ where: { guildId: GUILD_ID, key: 'announcements' } });
  });
});

describe('Reaction Roles', () => {
  it('GET /reaction-roles liste les entrées', async () => {
    const r = await get(`/guilds/${GUILD_ID}/reaction-roles`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('🎮');
    expect(r.text).toContain('Staff');
  });
  it('ajoute (en réagissant au message) puis supprime un reaction role', async () => {
    const add = await post(`/guilds/${GUILD_ID}/reaction-roles`, { channelId: TEXT_CHANNEL_ID, messageId: `https://discord.com/channels/${GUILD_ID}/${TEXT_CHANNEL_ID}/600000000000000001`, emoji: '🔥', roleId: STAFF_ROLE_ID });
    expect(add.status).toBe(302);
    expect(prisma.reactionRole.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { guildId: GUILD_ID, channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', emoji: '🔥', roleId: STAFF_ROLE_ID } }));
    const bad = await post(`/guilds/${GUILD_ID}/reaction-roles`, { channelId: TEXT_CHANNEL_ID, messageId: '600000000000000001', emoji: 'pas un emoji valide', roleId: STAFF_ROLE_ID });
    const page = await follow(bad);
    expect(page.text).toContain('Emoji invalide');
    const del = await post(`/guilds/${GUILD_ID}/reaction-roles/1/delete`, {});
    expect(del.status).toBe(302);
    expect(prisma.reactionRole.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe('Modération', () => {
  it('GET /moderation rend tous les onglets', async () => {
    const r = await get(`/guilds/${GUILD_ID}/moderation?tab=sanctions&case=12&warnUser=${USER_ID}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Cas #12');
    expect(r.text).toContain('Anti-spam');
    expect(r.text).toContain('Serveur ouvert');
    expect(r.text).toContain('Spam');
    expect(r.text).toContain('Avertissement</span>');
  });
  it('enregistre la configuration (seuils en minutes → secondes)', async () => {
    const r = await post(`/guilds/${GUILD_ID}/moderation/config`, { thresholdsJson: JSON.stringify([{ count: 3, action: 'TIMEOUT', durationMinutes: 30 }, { count: 5, action: 'KICK', durationMinutes: '' }]), muteRoleId: STAFF_ROLE_ID, dmOnSanction: 'on' });
    expect(r.status).toBe(302);
    const call = prisma.moderationConfig.upsert.mock.calls[0][0] as { update: { warnThresholds: unknown; muteRoleId: string } };
    expect(call.update.warnThresholds).toEqual([{ count: 3, action: 'TIMEOUT', duration: 1800 }, { count: 5, action: 'KICK' }]);
    expect(call.update.muteRoleId).toBe(STAFF_ROLE_ID);
  });
  it('enregistre l’anti-raid complet', async () => {
    const r = await post(`/guilds/${GUILD_ID}/moderation/antiraid`, {
      exemptRoleIds: STAFF_ROLE_ID, exemptChannelIds: TEXT_CHANNEL_ID, antiSpamEnabled: 'on', antiSpamMaxMessages: '8', antiSpamIntervalSeconds: '5', antiSpamTimeoutMinutes: '15',
      antiMassMentionEnabled: 'on', antiMassMentionMax: '6', antiMassMentionTimeoutMinutes: '10', antiLinkEnabled: 'on', antiLinkBlockInvites: 'on', antiLinkWhitelist: 'youtube.com\nhttps://redemption.fr/x', antiLinkAction: 'TIMEOUT', antiLinkTimeoutMinutes: '5',
      antiNewAccountEnabled: 'on', antiNewAccountMinAgeDays: '3', antiNewAccountAction: 'KICK', antiNewAccountQuarantineRoleId: '', antiBotAllowedIds: '123456789012345678', antiMassJoinEnabled: 'on', antiMassJoinMax: '12', antiMassJoinIntervalSeconds: '10', antiMassJoinLockdown: 'on',
    });
    expect(r.status).toBe(302);
    const call = prisma.moderationConfig.upsert.mock.calls[0][0] as { update: { antiRaid: { antiSpam: { timeoutSeconds: number }; antiLink: { whitelistDomains: string[]; action: string }; exemptRoleIds: string[] } } };
    expect(call.update.antiRaid.antiSpam.timeoutSeconds).toBe(900);
    expect(call.update.antiRaid.antiLink.whitelistDomains).toEqual(['youtube.com', 'redemption.fr']);
    expect(call.update.antiRaid.exemptRoleIds).toEqual([STAFF_ROLE_ID]);
  });
  it('active le lockdown et gère les avertissements', async () => {
    const lock = await post(`/guilds/${GUILD_ID}/moderation/lockdown`, { enabled: 'on', reason: 'Raid' });
    expect(lock.status).toBe(302);
    expect(moderationService.setLockdown).toHaveBeenCalledWith(GUILD_ID, true, USER_ID, 'Raid');
    const remove = await post(`/guilds/${GUILD_ID}/moderation/warnings/1/remove`, { userId: USER_ID, reason: '' });
    expect(remove.location).toBe(`/guilds/${GUILD_ID}/moderation?tab=warnings&warnUser=${USER_ID}`);
    expect(moderationService.removeWarning).toHaveBeenCalledWith(1, USER_ID, null, GUILD_ID);
    const clear = await post(`/guilds/${GUILD_ID}/moderation/warnings/clear`, { userId: USER_ID, reason: 'Amnistie' });
    expect(clear.status).toBe(302);
    expect(moderationService.clearWarnings).toHaveBeenCalledWith(GUILD_ID, USER_ID, USER_ID, 'Amnistie');
  });
});

describe('Giveaways', () => {
  it('GET /giveaways et la fiche se rendent', async () => {
    const r = await get(`/guilds/${GUILD_ID}/giveaways`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Nitro');
    const detail = await get(`/guilds/${GUILD_ID}/giveaways/8`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Participants');
    expect(detail.text).toContain('Tester');
  });
  it('crée un giveaway (durée ou date) puis termine / reroll / annule', async () => {
    const create = await post(`/guilds/${GUILD_ID}/giveaways`, { prize: 'Skin', description: '', endMode: 'duration', duration: '2h', winnersCount: '2', channelId: TEXT_CHANNEL_ID, requiredRoleId: STAFF_ROLE_ID, minMessages: '10', language: 'fr' });
    expect(create.location).toBe(`/guilds/${GUILD_ID}/giveaways/20`);
    const data = (prisma.giveaway.create.mock.calls[0][0] as { data: { endsAt: Date; winnersCount: number; minMessages: number } }).data;
    expect(data.winnersCount).toBe(2);
    expect(data.endsAt.getTime()).toBeGreaterThan(Date.now() + 7000_000);
    const byDate = await post(`/guilds/${GUILD_ID}/giveaways`, { prize: 'Skin 2', endMode: 'date', endsAt: '2099-05-01T18:00', winnersCount: '1', channelId: TEXT_CHANNEL_ID, minMessages: '0', language: '' });
    expect(byDate.status).toBe(302);
    const invalid = await post(`/guilds/${GUILD_ID}/giveaways`, { prize: 'Skin 3', endMode: 'duration', duration: 'bientôt', winnersCount: '1', channelId: TEXT_CHANNEL_ID, minMessages: '0', language: '' });
    const page = await follow(invalid);
    expect(page.text).toContain('Durée invalide');
    const end = await post(`/guilds/${GUILD_ID}/giveaways/8/end`, {});
    expect(end.status).toBe(302);
    expect(giveawayService.end).toHaveBeenCalledWith(8, { force: true, actorId: USER_ID });
    const reroll = await post(`/guilds/${GUILD_ID}/giveaways/8/reroll`, { count: '2' });
    expect(reroll.status).toBe(302);
    expect(giveawayService.reroll).toHaveBeenCalledWith(8, 2, USER_ID);
    const cancel = await post(`/guilds/${GUILD_ID}/giveaways/8/cancel`, {});
    expect(cancel.status).toBe(302);
    expect(giveawayService.cancel).toHaveBeenCalledWith(8, USER_ID);
  });
});

describe('Événements & sondages', () => {
  it('GET /events, la fiche et les résultats de sondage se rendent', async () => {
    const list = await get(`/guilds/${GUILD_ID}/events?status=SCHEDULED`);
    expect(list.status).toBe(200);
    expect(list.text).toContain('Soirée RP');
    expect(list.text).toContain('Quelle map ?');
    const form = await get(`/guilds/${GUILD_ID}/events/9`);
    expect(form.status).toBe(200);
    expect(form.text).toContain('value="Soirée RP"');
    expect(form.text).toContain('60, 10');
    const poll = await get(`/guilds/${GUILD_ID}/events/polls/3`);
    expect(poll.status).toBe(200);
    expect(poll.text).toContain('data-pct="100"');
    expect(poll.text).toContain('Désert');
  });
  it('crée, met à jour, rappelle et annule un événement', async () => {
    const create = await post(`/guilds/${GUILD_ID}/events`, { name: 'Tournoi', description: 'Grand tournoi', startsAt: '2099-03-01T20:00', endsAt: '2099-03-01T22:00', location: 'Arène', imageUrl: '', mentionRoleId: STAFF_ROLE_ID, maxParticipants: '16', channelId: TEXT_CHANNEL_ID, language: '', reminderOffsets: '60, 10, 60' });
    expect(create.location).toBe(`/guilds/${GUILD_ID}/events/21`);
    const data = (prisma.event.create.mock.calls[0][0] as { data: { reminderOffsets: number[]; startsAt: Date; maxParticipants: number } }).data;
    expect(data.reminderOffsets).toEqual([60, 10]);
    expect(data.startsAt.toISOString()).toBe('2099-03-01T19:00:00.000Z');
    expect(data.maxParticipants).toBe(16);
    const bad = await post(`/guilds/${GUILD_ID}/events`, { name: 'X', description: 'Y', startsAt: '2099-03-01T20:00', endsAt: '2099-03-01T19:00', channelId: TEXT_CHANNEL_ID, reminderOffsets: '' });
    const page = await follow(bad);
    expect(page.text).toContain('postérieure au début');
    const update = await post(`/guilds/${GUILD_ID}/events/9`, { name: 'Soirée RP 2', description: 'Encore', startsAt: '2099-04-01T20:00', endsAt: '', location: '', imageUrl: '', mentionRoleId: '', maxParticipants: '', language: 'en', reminderOffsets: '30' });
    expect(update.status).toBe(302);
    expect(prisma.event.update).toHaveBeenCalled();
    const remind = await post(`/guilds/${GUILD_ID}/events/9/remind`, {});
    expect(remind.status).toBe(302);
    expect(eventService.remind).toHaveBeenCalledWith(9);
    const cancel = await post(`/guilds/${GUILD_ID}/events/9/cancel`, {});
    expect(cancel.status).toBe(302);
    expect(eventService.cancel).toHaveBeenCalledWith(9, USER_ID);
  });
  it('crée et termine un sondage', async () => {
    const create = await post(`/guilds/${GUILD_ID}/events/polls`, { question: 'Map ?', type: 'MULTIPLE', optionsJson: JSON.stringify([{ label: 'A', emoji: '' }, { label: 'B', emoji: '🅱️' }]), anonymous: 'on', duration: '1h', channelId: TEXT_CHANNEL_ID });
    expect(create.location).toBe(`/guilds/${GUILD_ID}/events/polls/22`);
    const data = (prisma.poll.create.mock.calls[0][0] as { data: { options: { label: string; emoji?: string }[]; anonymous: boolean; endsAt: Date | null } }).data;
    expect(data.options).toEqual([{ label: 'A' }, { label: 'B', emoji: '🅱️' }]);
    expect(data.anonymous).toBe(true);
    expect(data.endsAt).toBeInstanceOf(Date);
    const tooFew = await post(`/guilds/${GUILD_ID}/events/polls`, { question: 'Map ?', type: 'MULTIPLE', optionsJson: JSON.stringify([{ label: 'A' }]), channelId: TEXT_CHANNEL_ID });
    const page = await follow(tooFew);
    expect(page.text).toContain('au moins 2 options');
    const end = await post(`/guilds/${GUILD_ID}/events/polls/3/end`, {});
    expect(end.status).toBe(302);
    expect(pollService.end).toHaveBeenCalledWith(3, USER_ID);
  });
});
