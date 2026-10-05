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
vi.mock('../../src/services/FiveMSyncService', () => ({ fivemSyncService: { attach: vi.fn(), handleJoin: vi.fn(), handleLeave: vi.fn() } }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));

import { prisma } from '../../src/database/client';
import { fivemSyncService } from '../../src/services/FiveMSyncService';
import { createFiveMRouter } from '../../src/api/fivem';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const GUILD = '123456789012345678';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ligne FiveMServer « en base », modifiée par prisma.fiveMServer.update. */
let row: Record<string, unknown>;
let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/fivem', createFiveMRouter({ uptimeSeconds: 1 } as never));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/fivem/servers/${GUILD}/main`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  row = { id: 1, guildId: GUILD, key: 'main', name: 'Main', framework: 'CUSTOM', enabled: true, apiKey: null, host: null, maintenance: false, lastStatus: { online: true, players: 0, maxPlayers: 64, playerList: [] }, lastSeenAt: new Date(), statusChannelId: null, statusMessageId: null };
  db.fiveMServer.findUnique.mockImplementation(async () => ({ ...row }));
  db.fiveMServer.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    row = { ...row, ...data };
    return { ...row };
  });
  // Arrivée lente (liaison, rôles, surnom) : c'est pendant cette attente que les requêtes simultanées se chevauchaient.
  vi.mocked(fivemSyncService.handleJoin).mockImplementation(async () => {
    await sleep(30);
    return { discordId: null, linked: false, member: false, nickname: null };
  });
  vi.mocked(fivemSyncService.handleLeave).mockResolvedValue({ minutes: 0, discordId: null });
});

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'global-api-key' }, body: JSON.stringify(body) });
const player = (id: number) => ({ id, name: `Joueur ${id}`, identifiers: [`license:${'a'.repeat(39)}${id}`] });

describe('API FiveM : arrivées / départs simultanés', () => {
  it('deux arrivées simultanées : les deux joueurs restent dans la liste', async () => {
    const [a, b] = await Promise.all([post('/players/join', player(1)), post('/players/join', player(2))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const list = (row.lastStatus as { playerList: { id: number }[] }).playerList.map((p) => p.id).sort();
    expect(list).toEqual([1, 2]);
    expect((row.lastStatus as { players: number }).players).toBe(2);
  });

  it('arrivée et départ simultanés : seul le joueur parti est retiré', async () => {
    row.lastStatus = { online: true, players: 1, maxPlayers: 64, playerList: [player(1)] };
    await Promise.all([post('/players/join', player(2)), post('/players/leave', { id: 1 })]);
    expect((row.lastStatus as { playerList: { id: number }[] }).playerList.map((p) => p.id)).toEqual([2]);
  });

  it('une arrivée ne recopie pas la maintenance du panneau dans le statut du jeu (levée = immédiate)', async () => {
    row = { ...row, maintenance: true };
    expect((await post('/players/join', player(7))).status).toBe(200);
    const stored = row.lastStatus as Record<string, unknown>;
    expect('maintenance' in stored).toBe(false);
    expect('stale' in stored).toBe(false);
    expect('lastSeenAt' in stored).toBe(false);
    // Maintenance levée depuis le panneau, puis nouvelle arrivée : elle n'est pas réactivée.
    row = { ...row, maintenance: false };
    expect((await post('/players/join', player(8))).status).toBe(200);
    expect(row.maintenance).toBe(false);
  });

  it('la maintenance signalée par le jeu (convar) reste prise en compte', async () => {
    expect((await post('/status', { online: true, players: 0, maxPlayers: 64, maintenance: true })).status).toBe(200);
    expect(row.maintenance).toBe(true);
  });

  it('auth : clé API requise', async () => {
    const r = await fetch(`${base}/players/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(player(1)) });
    expect(r.status).toBe(401);
  });
});
