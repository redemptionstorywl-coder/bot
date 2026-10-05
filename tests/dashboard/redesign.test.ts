/**
 * Refonte du dashboard : modèles de graphiques, navigation par type de serveur, palette de commandes,
 * vue d'ensemble (mise en route + graphiques) et « Débannir tout le monde » (Modération › Protection).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { createPrismaMock } from '../helpers/prisma';
import { GUILD_ID, USER_ID, STAFF_ROLE_ID, fakeClient, fakeGuild, primeBaseMocks, request, sessionData, setTestEnv, signedCookie } from '../helpers/dashboard';

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

vi.mock('../../src/services/MassUnbanService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/MassUnbanService')>();
  const svc = mod.massUnbanService;
  svc.count = vi.fn(async () => 12) as typeof svc.count;
  svc.start = vi.fn(() => ({ guildId: '100000000000000001', actorId: '200000000000000001', total: 0, done: 0, failed: 0, startedAt: new Date(), cancelled: false })) as typeof svc.start;
  svc.status = vi.fn(() => null) as typeof svc.status;
  svc.cancel = vi.fn(() => true) as typeof svc.cancel;
  return mod;
});

import { prisma as mockedPrisma } from '../../src/database/client';
import { massUnbanService } from '../../src/services/MassUnbanService';
import { createApp } from '../../dashboard/app';
import { createSessionMiddleware } from '../../dashboard/auth/session';
import { env } from '../../src/config/env';
import { niceScale, dayAxis, bucketByDay, mirrorChart, lineChart, hbarsChart, xLabels, PLOT_H } from '../../dashboard/lib/charts';
import { buildSidebar, paletteEntries, navGroupLabel, NAVIGATION } from '../../dashboard/lib/navigation';
import { isGuildAdmin } from '../../dashboard/lib/access';

setTestEnv();
const prisma = mockedPrisma as unknown as ReturnType<typeof createPrismaMock>;

describe('lib/charts', () => {
  it('niceScale : graduations rondes et entières, 0 inclus', () => {
    expect(niceScale(0, 4)).toEqual({ max: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(9, 4).ticks).toEqual([0, 3, 6, 9, 12]);
    expect(niceScale(20, 4).ticks).toEqual([0, 5, 10, 15, 20]);
    const s = niceScale(37, 4);
    expect(s.max).toBeGreaterThanOrEqual(37);
    expect(s.ticks.every((t) => Number.isInteger(t))).toBe(true);
    expect(niceScale(3, 2)).toEqual({ max: 4, step: 2, ticks: [0, 2, 4] });
  });
  it('dayAxis : N jours consécutifs, aujourd’hui en dernier, dans le fuseau du serveur', () => {
    const now = new Date('2026-03-29T22:30:00Z'); // 00:30 le 30 mars à Paris (passage à l'heure d'été la veille)
    const axis = dayAxis(30, 'Europe/Paris', now);
    expect(axis.keys).toHaveLength(30);
    expect(axis.keys[29]).toBe('2026-03-30');
    expect(axis.keys[0]).toBe('2026-03-01');
    expect(new Set(axis.keys).size).toBe(30);
  });
  it('bucketByDay ignore les dates hors période', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const axis = dayAxis(7, 'Europe/Paris', now);
    const counts = bucketByDay([new Date('2026-10-05T08:00:00Z'), new Date('2026-10-05T09:00:00Z'), new Date('2026-10-01T10:00:00Z'), new Date('2025-01-01T10:00:00Z'), null], axis, 'Europe/Paris');
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(counts[6]).toBe(2);
  });
  it('mirrorChart : une seule échelle symétrique, colonnes au-dessus et en dessous de la ligne de base', () => {
    const axis = dayAxis(3, 'UTC', new Date('2026-10-05T12:00:00Z'));
    const m = mirrorChart('c', axis, { key: 'up', label: 'Arrivées', slot: 1, values: [3, 0, 1] }, { key: 'down', label: 'Départs', slot: 2, values: [0, 2, 0] });
    expect(m.totals).toEqual({ up: 4, down: 2, net: 2 });
    expect(m.yTicks).toEqual(['4', '2', '0', '2', '4']);
    expect(m.baselineY).toBe(PLOT_H / 2);
    expect(m.bars.filter((b) => b.slot === 1)).toHaveLength(2);
    expect(m.bars.filter((b) => b.slot === 2)).toHaveLength(1);
    expect(m.empty).toBe(false);
  });
  it('lineChart : étiquettes de fin omises si elles se chevauchent', () => {
    const axis = dayAxis(3, 'UTC');
    const apart = lineChart('l', axis, [{ key: 'a', label: 'Ouverts', slot: 1, values: [1, 2, 8] }, { key: 'b', label: 'Fermés', slot: 2, values: [0, 1, 1] }]);
    expect(apart.endLabels).toHaveLength(2);
    const close = lineChart('l', axis, [{ key: 'a', label: 'Ouverts', slot: 1, values: [1, 2, 3] }, { key: 'b', label: 'Fermés', slot: 2, values: [0, 1, 3] }]);
    expect(close.endLabels).toHaveLength(0);
    expect(close.totals).toEqual([6, 4]);
  });
  it('hbarsChart : trié, valeurs nulles retirées, pourcentages sur l’échelle', () => {
    const h = hbarsChart('h', [{ label: 'Ban', value: 2 }, { label: 'Warn', value: 8 }, { label: 'Kick', value: 0 }]);
    expect(h.rows.map((r) => r.label)).toEqual(['Warn', 'Ban']);
    expect(h.total).toBe(10);
    expect(h.rows[0]!.pct).toBeLessThanOrEqual(100);
    expect(hbarsChart('h', []).empty).toBe(true);
  });
  it('xLabels : première et dernière étiquettes alignées sur les bords', () => {
    const labels = xLabels(dayAxis(30, 'UTC'));
    expect(labels[0]!.align).toBe('start');
    expect(labels[labels.length - 1]!.align).toBe('end');
    expect(labels.every((l) => l.left >= 0 && l.left <= 100)).toBe(true);
  });
});

describe('lib/navigation', () => {
  it('range les modules de jeu non pertinents sous « Autres modules »', () => {
    const generic = buildSidebar(GUILD_ID, 'dashboard', { tickets: true }, 'GENERIC');
    expect(generic.groups.some((g) => g.key === 'game')).toBe(false);
    expect(generic.others.map((o) => o.key)).toEqual(expect.arrayContaining(['fivem', 'whitelist', 'school', 'shop', 'battleRoyale']));
    const prison = buildSidebar(GUILD_ID, 'fivem', { fivem: true }, 'PRISON');
    const game = prison.groups.find((g) => g.key === 'game')!;
    expect(game.items.map((i) => i.key)).toEqual(['fivem', 'whitelist']);
    expect(game.items.find((i) => i.key === 'whitelist')!.dimmed).toBe(true);
    expect(prison.others.map((o) => o.key)).toEqual(['battleRoyale', 'school', 'shop']);
  });
  it('un module de jeu activé reste visible même hors type', () => {
    const s = buildSidebar(GUILD_ID, null, { shop: true }, 'GENERIC');
    expect(s.groups.find((g) => g.key === 'game')!.items.map((i) => i.key)).toEqual(['shop']);
  });
  it('palette : toutes les pages + raccourcis profonds ; sur-titres de groupe', () => {
    const entries = paletteEntries(GUILD_ID);
    expect(entries.length).toBeGreaterThan(NAVIGATION.length);
    expect(entries.map((e) => e.href)).toEqual(expect.arrayContaining([`/guilds/${GUILD_ID}/permissions`, `/guilds/${GUILD_ID}/logs?tab=channels`, `/guilds/${GUILD_ID}/settings#equipe`]));
    expect(navGroupLabel('permissions')).toBe('Serveur');
    expect(navGroupLabel('dashboard')).toBe("Vue d'ensemble");
  });
});

describe('lib/access isGuildAdmin', () => {
  const guilds = [{ id: GUILD_ID, name: 'S', icon: null, owner: false, permissions: String(0x20) }, { id: '100000000000000009', name: 'A', icon: null, owner: false, permissions: String(0x8) }];
  it('ManageGuild seul ne suffit pas ; Administrator, propriétaire et owner du bot oui', () => {
    expect(isGuildAdmin(guilds, GUILD_ID, USER_ID, [])).toBe(false);
    expect(isGuildAdmin(guilds, '100000000000000009', USER_ID, [])).toBe(true);
    expect(isGuildAdmin([{ ...guilds[0]!, owner: true }], GUILD_ID, USER_ID, [])).toBe(true);
    expect(isGuildAdmin(guilds, GUILD_ID, '900000000000000001', ['900000000000000001'])).toBe(true);
  });
});

// ───── Bout en bout ─────
let server: http.Server;
let base: string;
let currentSession: Record<string, unknown> | null = null;
const MODELS = ['dashboardSession', 'guild', 'guildSettings', 'logChannel', 'log', 'commandPermission', 'user', 'ticket', 'ticketType', 'ticketPanel', 'warning', 'sanction', 'ban', 'mute', 'moderationConfig', 'honeypotChannel', 'welcomeConfig', 'fiveMServer'];

function adminSession(admin: boolean) {
  const s = sessionData(true) as Record<string, unknown> & { guilds: { permissions: string }[] };
  if (admin) s.guilds[0]!.permissions = String(0x8);
  return s;
}

async function get(p: string) {
  return request(base, 'GET', p, { cookie: signedCookie(env().SESSION_SECRET) });
}
async function post(p: string, body: Record<string, string>, opts: { json?: boolean } = {}) {
  const headers: Record<string, string> = { cookie: signedCookie(env().SESSION_SECRET) };
  let payload: string;
  if (opts.json) {
    headers['content-type'] = 'application/json';
    headers.accept = 'application/json';
    headers['x-csrf-token'] = 'csrf-test-token';
    payload = JSON.stringify(body);
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams(body);
    params.set('_csrf', 'csrf-test-token');
    payload = params.toString();
  }
  return request(base, 'POST', p, headers, payload);
}

function prime(admin = true) {
  currentSession = adminSession(admin);
  primeBaseMocks(prisma, MODELS, () => currentSession, (data) => (currentSession = data));
  prisma.sanction.groupBy.mockResolvedValue([{ type: 'WARN', _count: { _all: 3 } }, { type: 'BAN', _count: { _all: 1 } }]);
  prisma.log.findMany.mockImplementation(async (args: { where?: { category?: string } }) =>
    args?.where?.category === 'MEMBER'
      ? [
          { action: 'member.join', targetId: '1', createdAt: new Date() },
          { action: 'member.join', targetId: '2', createdAt: new Date() },
          { action: 'member.leave', targetId: '3', createdAt: new Date() },
          { action: 'member.leave', targetId: '3', createdAt: new Date() }, // doublon (événement + module Départ)
        ]
      : [],
  );
  prisma.ticket.findMany.mockResolvedValue([{ createdAt: new Date(), closedAt: null }]);
  prisma.ticket.count.mockResolvedValue(1);
  vi.mocked(massUnbanService.count).mockResolvedValue(12);
  vi.mocked(massUnbanService.status).mockReturnValue(null);
  vi.mocked(massUnbanService.cancel).mockReturnValue(true);
  vi.mocked(massUnbanService.start).mockImplementation(() => ({ guildId: GUILD_ID, actorId: USER_ID, total: 0, done: 0, failed: 0, startedAt: new Date(), cancelled: false }));
}

beforeAll(async () => {
  prime();
  const app = createApp(fakeClient(fakeGuild()), { env: env(), sessionMiddleware: createSessionMiddleware(env()) });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(() => prime());
afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe('Vue d’ensemble', () => {
  it('affiche la mise en route cochée d’après la config, les trois graphiques et leur tableau', async () => {
    const r = await get(`/guilds/${GUILD_ID}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Mise en route');
    expect(r.text).toContain('Choisir les salons de logs');
    expect(r.text).toMatch(/class="setup-item is-done">\s*<a href="\/guilds\/100000000000000001\/logs\?tab=channels"/);
    expect(r.text).toContain('id="chart-members"');
    expect(r.text).toContain('id="chart-tickets"');
    expect(r.text).toContain('id="chart-sanctions"');
    expect(r.text).toContain('Voir les données');
    // 2 arrivées, 1 départ (le doublon du même jour est ignoré)
    expect(r.text).toMatch(/Arrivées<\/dt><dd>2<\/dd>/);
    expect(r.text).toMatch(/Départs<\/dt><dd>1<\/dd>/);
  });
  it('palette de commandes et sélecteur de thème présents dans le shell', async () => {
    const r = await get(`/guilds/${GUILD_ID}/members`);
    expect(r.text).toContain('id="palette-data"');
    expect(r.text).toContain('data-theme-set="light"');
    expect(r.text).toContain('/js/theme.js');
    expect(r.text).not.toContain('style="');
  });
});

describe('Modération › Protection : débannir tout le monde', () => {
  it('les anciens onglets ouvrent la page Protection à la bonne section', async () => {
    for (const [tab, anchor] of [['config', 'escalade'], ['antiraid', 'anti-nuke'], ['honeypot', 'salon-piege'], ['lockdown', 'lockdown']] as const) {
      const r = await get(`/guilds/${GUILD_ID}/moderation?tab=${tab}`);
      expect(r.status, tab).toBe(200);
      expect(r.text, tab).toContain(`data-scroll-to="${anchor}"`);
      expect(r.text, tab).toContain('id="danger-zone"');
      expect(r.text, tab).toContain('data-confirm-type="UNBAN ALL"');
    }
  });
  it('GET status : nombre de bannis et job', async () => {
    const r = await get(`/guilds/${GUILD_ID}/moderation/unban-all/status`);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ ok: true, count: 12, job: null });
  });
  it('refuse sans la confirmation exacte', async () => {
    const r = await post(`/guilds/${GUILD_ID}/moderation/unban-all`, { confirm: 'unban all', syncGame: 'on' });
    expect(r.status).toBe(302);
    expect(massUnbanService.start).not.toHaveBeenCalled();
  });
  it('refuse un membre qui a seulement « Gérer le serveur »', async () => {
    currentSession = adminSession(false);
    const r = await post(`/guilds/${GUILD_ID}/moderation/unban-all`, { confirm: 'UNBAN ALL' });
    expect(r.status).toBe(302);
    expect(massUnbanService.start).not.toHaveBeenCalled();
  });
  it('lance le débannissement (raison, relais en jeu) puis permet de l’arrêter', async () => {
    const r = await post(`/guilds/${GUILD_ID}/moderation/unban-all`, { confirm: 'UNBAN ALL', reason: 'Amnistie', syncGame: 'on' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/guilds/${GUILD_ID}/moderation?tab=protection#danger-zone`);
    expect(massUnbanService.start).toHaveBeenCalledWith(expect.objectContaining({ id: GUILD_ID }), expect.objectContaining({ id: USER_ID }), expect.objectContaining({ reason: 'Amnistie', syncGame: true }));
    const cancel = await post(`/guilds/${GUILD_ID}/moderation/unban-all/cancel`, {}, { json: true });
    expect(cancel.status).toBe(200);
    expect(JSON.parse(cancel.text)).toEqual({ ok: true, cancelled: true });
  });
  it('sans relais en jeu si la case est décochée', async () => {
    await post(`/guilds/${GUILD_ID}/moderation/unban-all`, { confirm: ' UNBAN  ALL ' });
    expect(massUnbanService.start).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ syncGame: false }));
  });
});

describe('Permissions : rôle staff en pastille colorée', () => {
  it('la page Permissions liste la catégorie et le rôle', async () => {
    prisma.commandPermission.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, commandName: 'ticket', roleIds: [STAFF_ROLE_ID], enabled: true }]);
    await post(`/guilds/${GUILD_ID}/permissions/reset`, {});
    prisma.commandPermission.findMany.mockResolvedValue([{ id: 1, guildId: GUILD_ID, commandName: 'ticket', roleIds: [STAFF_ROLE_ID], enabled: true }]);
    const r = await get(`/guilds/${GUILD_ID}/permissions`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Staff</span></span>');
  });
});
