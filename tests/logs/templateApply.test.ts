import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [] }) }));

import { prisma } from '../../src/database/client';
import { logHubService } from '../../src/services/LogHubService';
import { logTemplateService } from '../../src/services/LogTemplateService';
import { guildConfigService } from '../../src/services/GuildConfigService';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const HUB = '100000000000000009';
const SOURCE = '100000000000000001';
const BOT = '300000000000000001';

type FakeChannel = { id: string; name: string; type: ChannelType; parentId: string | null; topic?: string; isTextBased: () => boolean; messages: { fetch: ReturnType<typeof vi.fn> }; send: ReturnType<typeof vi.fn> };

function makeGuild() {
  const cache = new Map<string, FakeChannel>();
  const pinned: string[] = [];
  let next = 1000;
  const messages = new Map<string, { id: string; pinned: boolean; edit: ReturnType<typeof vi.fn>; pin: () => Promise<void> }>();
  const makeMessage = (id: string) => {
    const m = { id, pinned: false, edit: vi.fn(async () => m), pin: async () => void (pinned.push(id), (m.pinned = true)) };
    messages.set(id, m);
    return m;
  };
  const create = vi.fn(async (opts: { name: string; type: ChannelType; parent?: string; topic?: string; permissionOverwrites?: unknown[] }) => {
    const id = String(next++);
    const ch: FakeChannel = {
      id,
      name: opts.name,
      type: opts.type,
      parentId: opts.parent ?? null,
      topic: opts.topic,
      isTextBased: () => opts.type === ChannelType.GuildText,
      messages: { fetch: vi.fn(async (mid: string) => messages.get(mid) ?? Promise.reject(new Error('Unknown Message'))) },
      send: vi.fn(async () => makeMessage(String(next++))),
    };
    cache.set(id, ch);
    return ch;
  });
  const guild = {
    id: HUB,
    name: 'RS Logs',
    ownerId: '200000000000000004',
    iconURL: () => null,
    channels: { cache, create },
    roles: { everyone: { id: HUB }, cache: new Map([[HUB, { id: HUB, name: '@everyone' }]]) },
    members: { me: { id: BOT, permissions: { has: () => true } }, fetchMe: async () => ({ id: BOT, permissions: { has: () => true } }) },
    client: { guilds: { cache: new Map() } },
  };
  return { guild, cache, create, pinned };
}

const routeStore = new Map<string, { hubGuildId: string; sourceKey: string; routeKey: string; channelId: string }>();

beforeEach(() => {
  routeStore.clear();
  logHubService.invalidate();
  guildConfigService.invalidate(HUB);
  guildConfigService.invalidate(SOURCE);
  db.logHub.findMany.mockResolvedValue([{ guildId: HUB, summaryMessageId: null, createdById: '1', createdAt: new Date(), updatedAt: new Date() }]);
  db.logHub.update.mockResolvedValue({});
  db.logHubSource.findMany.mockResolvedValue([{ id: 1, hubGuildId: HUB, sourceGuildId: SOURCE, label: 'RS Battle Royale', emoji: '🎯', keepLocal: true, linkedById: '1', createdAt: new Date() }]);
  db.logHubGame.findMany.mockResolvedValue([{ id: 1, hubGuildId: HUB, fivemServerId: 7, chat: false, linkedById: '1', createdAt: new Date() }]);
  db.fiveMServer.findMany.mockResolvedValue([{ id: 7, guildId: SOURCE, name: 'RS BR', key: 'br' }]);
  db.fiveMServer.count.mockResolvedValue(1);
  db.guild.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    name: where.id === HUB ? 'RS Logs' : 'RS Battle Royale',
    kind: where.id === HUB ? 'GENERIC' : 'BATTLE_ROYALE',
    settings: { guildId: where.id, defaultLanguage: 'fr', modules: { tickets: true, fivem: true, battleRoyale: true }, adminRoleIds: [], staffRoleIds: [], brandColor: '#2F8BFF', timezone: 'Europe/Paris' },
    logChannels: [],
  }));
  db.logRoute.findMany.mockImplementation(async () => [...routeStore.values()]);
  db.logRoute.upsert.mockImplementation(async ({ create }: { create: { hubGuildId: string; sourceKey: string; routeKey: string; channelId: string } }) => {
    routeStore.set(`${create.sourceKey}|${create.routeKey}`, create);
    return create;
  });
});

describe('logTemplateService.apply', () => {
  it('crée catégories puis salons privés, enregistre chaque route, épingle le sommaire ; second passage : rien de nouveau', async () => {
    const { guild, cache, create, pinned } = makeGuild();
    const progress: number[] = [];
    const r1 = await logTemplateService.apply({ guilds: { cache: new Map() } } as never, guild as never, { pacingMs: 0, onProgress: (p) => void progress.push(p.done) });
    expect(r1.ok).toBe(true);
    expect(r1.created).toBe(r1.plan.toCreate);
    expect(r1.created).toBeGreaterThan(30);
    // Catégories privées : @everyone sans ViewChannel, le bot garde l'accès
    const firstCall = create.mock.calls[0]![0] as { type: ChannelType; permissionOverwrites: { id: string; deny?: unknown[]; allow?: unknown[] }[] };
    expect(firstCall.type).toBe(ChannelType.GuildCategory);
    expect(firstCall.permissionOverwrites.find((o) => o.id === HUB)?.deny).toBeDefined();
    expect(firstCall.permissionOverwrites.find((o) => o.id === BOT)?.allow).toBeDefined();
    // Chaque salon texte est rangé dans sa catégorie
    const text = [...cache.values()].filter((c) => c.type === ChannelType.GuildText);
    expect(text.every((c) => c.parentId && cache.get(c.parentId)?.type === ChannelType.GuildCategory)).toBe(true);
    expect(routeStore.size).toBe(r1.created);
    expect(routeStore.get('game:7|game.kills')).toBeDefined();
    expect(r1.summaryChannelId).toBe(routeStore.get('global|global.summary')!.channelId);
    expect(pinned).toHaveLength(1);
    expect(progress.at(-1)).toBe(r1.created);

    // Relance : tout est réutilisé
    create.mockClear();
    const r2 = await logTemplateService.apply({ guilds: { cache: new Map() } } as never, guild as never, { pacingMs: 0 });
    expect(r2.created).toBe(0);
    expect(r2.reused).toBe(r1.created);
    expect(create).not.toHaveBeenCalled();

    // Un salon supprimé à la main : seul lui est recréé, dans sa catégorie existante
    const sanctions = routeStore.get(`${SOURCE}|mod.sanctions`)!;
    const parent = cache.get(sanctions.channelId)!.parentId;
    cache.delete(sanctions.channelId);
    const r3 = await logTemplateService.apply({ guilds: { cache: new Map() } } as never, guild as never, { pacingMs: 0 });
    expect(r3.created).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0]![0] as { parent?: string }).parent).toBe(parent);
  });

  it('refuse sans hub, et une seule exécution à la fois', async () => {
    const { guild } = makeGuild();
    db.logHub.findMany.mockResolvedValue([]);
    logHubService.invalidate();
    expect((await logTemplateService.apply({} as never, guild as never, { pacingMs: 0 })).error).toBe('no_hub');
  });

  it('permissions du bot manquantes : rien n’est créé', async () => {
    const { guild, create } = makeGuild();
    guild.members.me = { id: BOT, permissions: { has: () => false } };
    const r = await logTemplateService.apply({} as never, guild as never, { pacingMs: 0 });
    expect(r.error).toBe('missing_permissions');
    expect(create).not.toHaveBeenCalled();
  });
});
