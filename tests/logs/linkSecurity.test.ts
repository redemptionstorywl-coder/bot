import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: ['900000000000000001'] }) }));

import { prisma } from '../../src/database/client';
import { LogHubError, MAX_HUB_SOURCES, decideLinkPermission, isPreselectedSource, logHubService, sourceEmoji } from '../../src/services/LogHubService';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const HUB = '100000000000000009';
const SOURCE = '100000000000000001';
const ADMIN = '200000000000000001';
const MEMBER = '200000000000000002';
const STRANGER = '200000000000000003';
const OWNER = '200000000000000004';
const BOT_OWNER = '900000000000000001';

/** Faux serveur : membres avec ou sans Administrateur ; fetch compte les appels (membre relu via l'API). */
function fakeGuild(id: string, name: string, members: Record<string, boolean>, ownerId = OWNER) {
  return {
    id,
    name,
    ownerId,
    iconURL: () => null,
    members: {
      fetch: vi.fn(async ({ user }: { user: string; force?: boolean }) => {
        if (!(user in members)) throw new Error('Unknown Member');
        return { id: user, permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.Administrator && members[user] } };
      }),
    },
  };
}

function fakeClient(...guilds: ReturnType<typeof fakeGuild>[]) {
  return { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } } as never;
}

describe('règle de sécurité des liens (decideLinkPermission)', () => {
  it('propriétaire du bot, propriétaire du serveur ou Administrateur sur la SOURCE uniquement', () => {
    const guild = { ownerId: OWNER };
    expect(decideLinkPermission({ userId: BOT_OWNER, ownerIds: [BOT_OWNER], guild, member: null })).toEqual({ allowed: true, via: 'bot_owner' });
    expect(decideLinkPermission({ userId: OWNER, ownerIds: [], guild, member: null })).toEqual({ allowed: true, via: 'guild_owner' });
    expect(decideLinkPermission({ userId: ADMIN, ownerIds: [], guild, member: { administrator: true } })).toEqual({ allowed: true, via: 'administrator' });
    expect(decideLinkPermission({ userId: MEMBER, ownerIds: [], guild, member: { administrator: false } })).toEqual({ allowed: false, reason: 'not_admin' });
    expect(decideLinkPermission({ userId: STRANGER, ownerIds: [], guild, member: null })).toEqual({ allowed: false, reason: 'not_member' });
    expect(decideLinkPermission({ userId: BOT_OWNER, ownerIds: [BOT_OWNER], guild: null, member: null })).toEqual({ allowed: false, reason: 'bot_not_in_guild' });
  });
});

describe('LogHubService : liaison sécurisée', () => {
  const source = fakeGuild(SOURCE, 'RS Battle Royale', { [ADMIN]: true, [MEMBER]: false });
  const hub = fakeGuild(HUB, 'RS Logs', { [ADMIN]: true, [MEMBER]: true, [STRANGER]: true });
  const client = fakeClient(source, hub);

  beforeEach(() => {
    logHubService.invalidate();
    db.logHub.findMany.mockResolvedValue([]);
    db.logHub.upsert.mockResolvedValue({ guildId: HUB, createdById: ADMIN, summaryMessageId: null, createdAt: new Date(), updatedAt: new Date() });
    db.logHubSource.findMany.mockResolvedValue([]);
    db.logHubSource.findFirst.mockResolvedValue(null);
    db.logHubSource.count.mockResolvedValue(0);
    db.logHubSource.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, keepLocal: true, createdAt: new Date(), ...data }));
    db.guild.findUnique.mockResolvedValue({ kind: 'BATTLE_ROYALE' });
  });

  it('relit le membre sur la source (force) : un admin du hub qui n’est que membre de la source est refusé', async () => {
    await expect(logHubService.linkSource(client, HUB, SOURCE, MEMBER)).rejects.toMatchObject({ code: 'not_admin' });
    expect(source.members.fetch).toHaveBeenCalledWith({ user: MEMBER, force: true });
    expect(db.logHubSource.create).not.toHaveBeenCalled();
  });

  it('quelqu’un qui a invité le bot sur son serveur ne peut pas aspirer les logs d’un serveur dont il n’est pas membre', async () => {
    await expect(logHubService.linkSource(client, HUB, SOURCE, STRANGER)).rejects.toMatchObject({ code: 'not_member' });
    expect(db.logHubSource.create).not.toHaveBeenCalled();
  });

  it('administrateur de la source (et du hub) : lien créé, nom et emoji par défaut', async () => {
    const row = await logHubService.linkSource(client, HUB, SOURCE, ADMIN);
    expect(row).toMatchObject({ hubGuildId: HUB, sourceGuildId: SOURCE, label: 'RS Battle Royale', emoji: '🎯', linkedById: ADMIN });
  });

  it('propriétaire du bot : autorisé sans être membre', async () => {
    const row = await logHubService.linkSource(client, HUB, SOURCE, BOT_OWNER);
    expect(row.linkedById).toBe(BOT_OWNER);
  });

  it('doit aussi être administrateur du hub', async () => {
    const strictHub = fakeGuild(HUB, 'RS Logs', { [ADMIN]: false });
    const admin = fakeGuild(SOURCE, 'RS Battle Royale', { [ADMIN]: true });
    await expect(logHubService.linkSource(fakeClient(admin, strictHub), HUB, SOURCE, ADMIN)).rejects.toMatchObject({ code: 'hub_not_admin' });
  });

  it('une source = un seul hub ; pas de hub-source ; pas soi-même ; maximum de sources', async () => {
    await expect(logHubService.linkSource(client, HUB, HUB, ADMIN)).rejects.toMatchObject({ code: 'self' });
    db.logHubSource.findMany.mockResolvedValueOnce([{ hubGuildId: '100000000000000777', sourceGuildId: SOURCE }]);
    await expect(logHubService.linkSource(client, HUB, SOURCE, ADMIN)).rejects.toMatchObject({ code: 'already_linked' });
    db.logHub.findMany.mockResolvedValue([{ guildId: SOURCE }]);
    logHubService.invalidate();
    await expect(logHubService.linkSource(client, HUB, SOURCE, ADMIN)).rejects.toMatchObject({ code: 'is_hub' });
    db.logHub.findMany.mockResolvedValue([]);
    logHubService.invalidate();
    db.logHubSource.count.mockResolvedValueOnce(MAX_HUB_SOURCES);
    await expect(logHubService.linkSource(client, HUB, SOURCE, ADMIN)).rejects.toBeInstanceOf(LogHubError);
  });

  it('déjà relié à ce hub : idempotent', async () => {
    db.logHubSource.findMany.mockResolvedValueOnce([{ id: 3, hubGuildId: HUB, sourceGuildId: SOURCE, label: 'X' }]);
    const row = await logHubService.linkSource(client, HUB, SOURCE, ADMIN);
    expect(row.id).toBe(3);
    expect(db.logHubSource.create).not.toHaveBeenCalled();
  });

  it('un serveur de jeu ne se relie que si son serveur Discord est une source du hub', async () => {
    db.fiveMServer.findUnique.mockResolvedValue({ id: 7, guildId: SOURCE, name: 'RS BR' });
    db.logHubGame.findFirst.mockResolvedValue(null);
    await expect(logHubService.linkGame(HUB, 7, ADMIN)).rejects.toMatchObject({ code: 'game_source_missing' });
    db.logHubSource.findFirst.mockResolvedValue({ hubGuildId: HUB, sourceGuildId: SOURCE });
    db.logHubGame.count.mockResolvedValue(0);
    db.logHubGame.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }));
    await expect(logHubService.linkGame(HUB, 7, ADMIN, true)).resolves.toMatchObject({ fivemServerId: 7, chat: true });
  });

  it('délier une source retire aussi ses serveurs de jeu (salons conservés)', async () => {
    db.logHubSource.deleteMany.mockResolvedValue({ count: 1 });
    db.fiveMServer.findMany.mockResolvedValue([{ id: 7 }]);
    db.logHubGame.deleteMany.mockResolvedValue({ count: 1 });
    expect(await logHubService.unlinkSource(HUB, SOURCE)).toBe(true);
    expect(db.logHubGame.deleteMany).toHaveBeenCalledWith({ where: { hubGuildId: HUB, fivemServerId: { in: [7] } } });
    expect(db.logRoute.deleteMany).not.toHaveBeenCalled();
  });

  it('eligibleSources : droit vérifié sur chaque serveur, état de liaison', async () => {
    db.logHubSource.findMany.mockResolvedValueOnce([]);
    db.guild.findMany.mockResolvedValue([{ id: SOURCE, kind: 'BATTLE_ROYALE' }]);
    const list = await logHubService.eligibleSources(client, HUB, MEMBER);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ guildId: SOURCE, permission: { allowed: false, reason: 'not_admin' }, linkedHubId: null, isHub: false });
  });
});

describe('helpers', () => {
  it('emoji et présélection selon le nom / type', () => {
    expect(sourceEmoji('GENERIC', 'RS Studio')).toBe('🎬');
    expect(sourceEmoji('BATTLE_ROYALE', 'RS BR')).toBe('🎯');
    expect(sourceEmoji('SHOP', 'Boutique')).toBe('🛒');
    expect(isPreselectedSource('RS Battle Royale')).toBe(true);
    expect(isPreselectedSource('Redemption Story Studio')).toBe(true);
    expect(isPreselectedSource('RS Shop')).toBe(false);
  });
});
