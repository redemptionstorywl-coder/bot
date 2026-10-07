/**
 * TempVoiceService de bout en bout avec un faux serveur Discord : création au lobby, déplacement vers le salon existant,
 * limite par membre, suppression après le délai de grâce (annulée par un retour), transfert, reprise après redémarrage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection, DiscordAPIError, PermissionFlagsBits, PermissionsBitField, type Client, type VoiceState } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma as prismaClient } from '../../src/database/client';
import { guildConfigService } from '../../src/services/GuildConfigService';
import { loggingService } from '../../src/services/LoggingService';
import { DELETE_GRACE_MS, TempVoiceService, ruleFromPreset } from '../../src/services/TempVoiceService';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;

const GUILD = '100000000000000001';
const LOBBY = '200000000000000001';
const CATEGORY = '200000000000000009';
const FR_ROLE = '300000000000000001';
const BOT = '900000000000000001';

interface FakeMember {
  id: string;
  displayName: string;
  user: { bot: boolean; username: string; tag: string; globalName: string | null };
  roles: { cache: Map<string, unknown> };
  guild: FakeGuild;
  voice: { channelId: string | null; setChannel: ReturnType<typeof vi.fn> };
}
interface FakeChannel {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  userLimit: number;
  bitrate: number;
  rtcRegion: string | null;
  videoQualityMode: number;
  members: Collection<string, FakeMember>;
  permissionOverwrites: { cache: Map<string, unknown>; edit: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  isVoiceBased: () => boolean;
  delete: ReturnType<typeof vi.fn>;
  guild: FakeGuild;
}
interface FakeGuild {
  id: string;
  available: boolean;
  channels: { cache: Map<string, FakeChannel | { id: string; type: ChannelType; isVoiceBased: () => boolean }>; create: ReturnType<typeof vi.fn> };
  members: { me: { id: string; permissions: PermissionsBitField }; fetchMe: () => Promise<unknown> };
  roles: { cache: Map<string, unknown> };
}

let seq = 0;
let guild: FakeGuild;
let client: Client;

function voiceChannel(id: string, name: string, parentId: string | null = CATEGORY): FakeChannel {
  const ch: FakeChannel = {
    id,
    name,
    type: ChannelType.GuildVoice,
    parentId,
    userLimit: 5,
    bitrate: 96_000,
    rtcRegion: null,
    videoQualityMode: 1,
    members: new Collection(),
    permissionOverwrites: { cache: new Map(), edit: vi.fn(async () => null), delete: vi.fn(async () => null) },
    isVoiceBased: () => true,
    delete: vi.fn(async () => {
      guild.channels.cache.delete(id);
      return ch;
    }),
    guild,
  };
  return ch;
}

function makeGuild(perms: bigint = PermissionFlagsBits.Administrator): FakeGuild {
  const g: FakeGuild = {
    id: GUILD,
    available: true,
    channels: {
      cache: new Map(),
      create: vi.fn(async (opts: { name: string; parent?: string }) => {
        const ch = voiceChannel(`2100000000000000${String(++seq).padStart(2, '0')}`, opts.name, opts.parent ?? null);
        g.channels.cache.set(ch.id, ch);
        return ch;
      }),
    },
    members: { me: { id: BOT, permissions: new PermissionsBitField(perms) }, fetchMe: async () => g.members.me },
    roles: { cache: new Map() },
  };
  return g;
}

function member(id: string, name: string, roleIds: string[] = []): FakeMember {
  const m: FakeMember = {
    id,
    displayName: name,
    user: { bot: false, username: name.toLowerCase(), tag: name.toLowerCase(), globalName: name },
    roles: { cache: new Map(roleIds.map((r) => [r, {}])) },
    guild,
    voice: { channelId: null, setChannel: vi.fn() },
  };
  m.voice.setChannel = vi.fn(async (target: FakeChannel) => move(m, target.id));
  return m;
}

function state(m: FakeMember, channelId: string | null): VoiceState {
  const channel = channelId ? (guild.channels.cache.get(channelId) as FakeChannel | undefined) ?? null : null;
  return { channelId, channel, member: m, guild } as unknown as VoiceState;
}

const service = () => svc;
let svc: TempVoiceService;

/** Déplace un membre (met à jour les membres des salons) et transmet l'événement au service. */
async function move(m: FakeMember, to: string | null): Promise<void> {
  const from = m.voice.channelId;
  if (from) (guild.channels.cache.get(from) as FakeChannel | undefined)?.members.delete(m.id);
  if (to) (guild.channels.cache.get(to) as FakeChannel).members.set(m.id, m);
  m.voice.channelId = to;
  await service().handleVoiceStateUpdate(state(m, from), state(m, to));
}

const tempChannels = () => [...guild.channels.cache.values()].filter((c) => c.id !== LOBBY) as FakeChannel[];

function primeConfig(over: Record<string, unknown> = {}): void {
  prisma.tempVoiceConfig.findUnique.mockResolvedValue({ guildId: GUILD, lobbyIds: [LOBBY], categoryId: null, userLimit: null, rules: [ruleFromPreset(FR_ROLE, 'fr')], fallback: null, ownerPermissions: true, transferOwnership: true, updatedAt: new Date(), ...over });
}

beforeEach(async () => {
  seq = 0;
  guild = makeGuild();
  const lobby = voiceChannel(LOBBY, '➕ Créer un salon');
  lobby.permissionOverwrites.cache.set(GUILD, { id: GUILD, type: 0, allow: new PermissionsBitField(PermissionFlagsBits.Connect), deny: new PermissionsBitField(0n) });
  guild.channels.cache.set(LOBBY, lobby);
  client = { guilds: { cache: new Map([[GUILD, guild]]) } } as unknown as Client;
  primeConfig();
  prisma.tempVoiceChannel.findMany.mockResolvedValue([]);
  prisma.tempVoiceChannel.create.mockResolvedValue({});
  prisma.tempVoiceChannel.deleteMany.mockResolvedValue({ count: 1 });
  prisma.tempVoiceChannel.updateMany.mockResolvedValue({ count: 1 });
  prisma.tempVoiceConfig.upsert.mockResolvedValue({});
  vi.spyOn(guildConfigService, 'get').mockResolvedValue({ guildId: GUILD, defaultLanguage: 'fr', modules: { vocal: true } } as never);
  vi.spyOn(loggingService, 'log').mockResolvedValue(undefined);
  svc = new TempVoiceService();
  await svc.attach(client);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('création au lobby', () => {
  it('crée « <pseudo> Lobby », y déplace le membre et l’enregistre', async () => {
    const bob = member('400000000000000001', 'Bob', [FR_ROLE]);
    await move(bob, LOBBY);
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    const opts = guild.channels.create.mock.calls[0]![0] as { name: string; parent: string; userLimit: number; bitrate: number; permissionOverwrites: { id: string; allow: bigint }[] };
    expect(opts).toMatchObject({ name: 'Bob Lobby', parent: CATEGORY, userLimit: 5, bitrate: 96_000 });
    const owner = opts.permissionOverwrites.find((o) => o.id === bob.id)!;
    expect(owner.allow & PermissionFlagsBits.ManageChannels).toBe(PermissionFlagsBits.ManageChannels);
    expect(opts.permissionOverwrites.some((o) => o.id === GUILD)).toBe(true);
    const [created] = tempChannels();
    expect(bob.voice.channelId).toBe(created!.id);
    expect(prisma.tempVoiceChannel.create).toHaveBeenCalledWith({ data: { channelId: created!.id, guildId: GUILD, ownerId: bob.id, lobbyId: LOBBY } });
    expect(svc.isTempChannel(created!.id)).toBe(true);
    expect(svc.ownedChannel(GUILD, bob.id)).toBe(created!.id);
  });

  it('sans rôle de langue → même nom ; catégorie et limite configurées', async () => {
    primeConfig({ categoryId: CATEGORY, userLimit: 0 });
    guild.channels.cache.set(CATEGORY, { id: CATEGORY, type: ChannelType.GuildCategory, isVoiceBased: () => false });
    svc = new TempVoiceService();
    await svc.attach(client);
    await move(member('400000000000000002', 'Ann'), LOBBY);
    expect(guild.channels.create.mock.calls[0]![0]).toMatchObject({ name: 'Ann Lobby', parent: CATEGORY, userLimit: 0 });
  });

  it('possède déjà un salon : déplacé dedans au lieu d’en créer un second', async () => {
    const bob = member('400000000000000001', 'Bob', [FR_ROLE]);
    await move(bob, LOBBY);
    const [created] = tempChannels();
    await move(bob, null); // déconnexion : suppression programmée
    expect(svc.hasPendingDelete(created!.id)).toBe(true);
    await move(bob, LOBBY); // retour par le lobby avant la fin du délai
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(bob.voice.channelId).toBe(created!.id);
    expect(svc.hasPendingDelete(created!.id)).toBe(false);
  });

  it('transfert désactivé : le créateur repassant par le lobby retrouve son salon occupé', async () => {
    primeConfig({ transferOwnership: false });
    svc = new TempVoiceService();
    await svc.attach(client);
    const bob = member('400000000000000001', 'Bob');
    const alice = member('400000000000000003', 'Alice');
    await move(bob, LOBBY);
    const [created] = tempChannels();
    await move(alice, created!.id);
    await move(bob, LOBBY);
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(bob.voice.channelId).toBe(created!.id);
  });

  it('limite par membre : pas de nouvelle création dans les 10 s', async () => {
    const bob = member('400000000000000001', 'Bob');
    await move(bob, LOBBY);
    const [first] = tempChannels();
    await move(bob, null); // salon vide → suppression programmée
    await first!.delete();
    await svc.handleChannelDelete(first!.id);
    await move(bob, LOBBY);
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(bob.voice.channelId).toBe(LOBBY);
  });

  it('module coupé ou salon non lobby : rien', async () => {
    vi.spyOn(guildConfigService, 'get').mockResolvedValue({ guildId: GUILD, defaultLanguage: 'fr', modules: { vocal: false } } as never);
    await move(member('400000000000000001', 'Bob'), LOBBY);
    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  it('permissions du bot manquantes : rien n’est créé, une seule entrée de log (limitée)', async () => {
    guild.members.me.permissions = new PermissionsBitField(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect);
    await move(member('400000000000000001', 'Bob'), LOBBY);
    await move(member('400000000000000002', 'Ann'), LOBBY);
    expect(guild.channels.create).not.toHaveBeenCalled();
    const logs = vi.mocked(loggingService.log).mock.calls.filter(([e]) => e.action === 'vocal.error');
    expect(logs).toHaveLength(1);
    expect(logs[0]![0].description).toContain('ManageChannels');
  });

  it('permissions copiées refusées par Discord (50013) : nouvel essai sans elles', async () => {
    const err = new DiscordAPIError({ code: 50013, message: 'Missing Permissions' }, 50013, 403, 'POST', '/guilds/x/channels', { files: undefined, json: undefined });
    guild.channels.create.mockRejectedValueOnce(err);
    const bob = member('400000000000000001', 'Bob');
    await move(bob, LOBBY);
    expect(guild.channels.create).toHaveBeenCalledTimes(2);
    expect(guild.channels.create.mock.calls[1]![0]).not.toHaveProperty('permissionOverwrites');
    expect(bob.voice.channelId).toBe(tempChannels()[0]!.id);
  });

  it('échec du déplacement : le salon créé est supprimé', async () => {
    const bob = member('400000000000000001', 'Bob');
    bob.voice.setChannel = vi.fn(async (target: FakeChannel) => {
      if (target.id !== LOBBY) throw new Error('cannot move');
      await move(bob, target.id);
    });
    await bob.voice.setChannel(guild.channels.cache.get(LOBBY));
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(tempChannels()).toHaveLength(0);
    expect(prisma.tempVoiceChannel.deleteMany).toHaveBeenCalled();
  });
});

describe('suppression quand le salon se vide', () => {
  it('supprimé après le délai de grâce (5 s), pas avant', async () => {
    vi.useFakeTimers();
    const bob = member('400000000000000001', 'Bob');
    await move(bob, LOBBY);
    const [created] = tempChannels();
    await move(bob, null);
    expect(svc.hasPendingDelete(created!.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(DELETE_GRACE_MS - 100);
    expect(created!.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(created!.delete).toHaveBeenCalledTimes(1);
    expect(svc.isTempChannel(created!.id)).toBe(false);
    expect(prisma.tempVoiceChannel.deleteMany).toHaveBeenCalledWith({ where: { channelId: created!.id } });
  });

  it('reconnexion rapide : la suppression est annulée', async () => {
    vi.useFakeTimers();
    const bob = member('400000000000000001', 'Bob');
    await move(bob, LOBBY);
    const [created] = tempChannels();
    await move(bob, null);
    await vi.advanceTimersByTimeAsync(2000);
    await move(bob, created!.id);
    expect(svc.hasPendingDelete(created!.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(created!.delete).not.toHaveBeenCalled();
  });

  it('le créateur part, un autre reste : salon gardé et transféré au plus ancien', async () => {
    const bob = member('400000000000000001', 'Bob');
    const ann = member('400000000000000002', 'Ann');
    const cid = member('400000000000000003', 'Cid');
    await move(bob, LOBBY);
    const [created] = tempChannels();
    await move(ann, created!.id);
    await move(cid, created!.id);
    await move(bob, null);
    expect(svc.hasPendingDelete(created!.id)).toBe(false);
    expect(svc.ownedChannel(GUILD, ann.id)).toBe(created!.id);
    expect(svc.ownedChannel(GUILD, bob.id)).toBeNull();
    expect(created!.permissionOverwrites.delete).toHaveBeenCalledWith(bob.id, expect.any(String));
    expect(created!.permissionOverwrites.edit).toHaveBeenCalledWith(ann.id, expect.objectContaining({ ManageChannels: true, MoveMembers: true }), expect.any(Object));
    expect(prisma.tempVoiceChannel.updateMany).toHaveBeenCalledWith({ where: { channelId: created!.id }, data: { ownerId: ann.id } });
  });

  it('salon supprimé à la main : oublié (channelDelete)', async () => {
    const bob = member('400000000000000001', 'Bob');
    await move(bob, LOBBY);
    const [created] = tempChannels();
    await svc.handleChannelDelete(created!.id);
    expect(svc.isTempChannel(created!.id)).toBe(false);
    expect(svc.ownedChannel(GUILD, bob.id)).toBeNull();
  });
});

describe('reprise après redémarrage', () => {
  it('supprime les salons restés vides, oublie les disparus, reprend les occupés', async () => {
    const empty = voiceChannel('220000000000000001', '🇫🇷 Salon de Bob');
    const busy = voiceChannel('220000000000000002', "🇬🇧 Ann's lobby");
    busy.members.set('400000000000000002', member('400000000000000002', 'Ann'));
    guild.channels.cache.set(empty.id, empty);
    guild.channels.cache.set(busy.id, busy);
    const row = (channelId: string, guildId = GUILD) => ({ channelId, guildId, ownerId: '400000000000000001', lobbyId: LOBBY, createdAt: new Date() });
    prisma.tempVoiceChannel.findMany.mockResolvedValue([row(empty.id), row(busy.id), row('220000000000000003'), row('220000000000000004', '100000000000000099')]);
    svc = new TempVoiceService();
    const plan = await svc.restore(client);
    expect(plan.remove).toEqual([empty.id]);
    expect(plan.forget).toEqual(['220000000000000003', '220000000000000004']);
    expect(empty.delete).toHaveBeenCalledTimes(1);
    expect(busy.delete).not.toHaveBeenCalled();
    expect(svc.isTempChannel(busy.id)).toBe(true);
    expect(svc.isTempChannel(empty.id)).toBe(false);
    expect(prisma.tempVoiceChannel.deleteMany).toHaveBeenCalledWith({ where: { channelId: { in: ['220000000000000003', '220000000000000004'] } } });
  });

  it('balayage périodique : un salon vide sans suppression programmée est planifié', async () => {
    vi.useFakeTimers();
    const orphan = voiceChannel('220000000000000005', 'Vide');
    guild.channels.cache.set(orphan.id, orphan);
    prisma.tempVoiceChannel.findMany.mockResolvedValue([]);
    const bob = member('400000000000000001', 'Bob');
    await move(bob, LOBBY);
    const [created] = tempChannels().filter((c) => c.id !== orphan.id);
    created!.members.clear();
    bob.voice.channelId = null;
    await svc.sweep();
    expect(svc.hasPendingDelete(created!.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(DELETE_GRACE_MS + 10);
    expect(created!.delete).toHaveBeenCalled();
  });
});

describe('configuration', () => {
  it('updateConfig valide (Zod) et met le cache à jour', async () => {
    const s = await svc.updateConfig(GUILD, { lobbyIds: [LOBBY, LOBBY], userLimit: 4 });
    expect(s.lobbyIds).toEqual([LOBBY]);
    expect(s.userLimit).toBe(4);
    expect(prisma.tempVoiceConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: GUILD } }));
    await expect(svc.updateConfig(GUILD, { userLimit: 150 })).rejects.toThrow();
    await expect(svc.updateConfig(GUILD, { rules: [{ roleId: FR_ROLE, preset: 'fr', emoji: '🇫🇷', template: 'pas de nom' }] })).rejects.toThrow();
    expect((await svc.getConfig(GUILD)).userLimit).toBe(4);
  });
});
