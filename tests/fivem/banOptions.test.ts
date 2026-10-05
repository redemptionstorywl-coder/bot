import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const servers = [
  { id: 1, key: 'br', enabled: true, syncBansToGame: true, roleGroups: null },
  { id: 2, key: 'test', enabled: true, syncBansToGame: false, roleGroups: null },
  { id: 3, key: 'old', enabled: false, syncBansToGame: true, roleGroups: null },
];

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));
vi.mock('../../src/services/ModerationService', () => ({ moderationService: {} }));
vi.mock('../../src/services/WhitelistService', () => ({ whitelistService: {} }));
vi.mock('../../src/services/GuildConfigService', () => ({ guildConfigService: { get: vi.fn(async () => null), on: vi.fn() } }));
vi.mock('../../src/services/FiveMService', () => ({
  fivemService: { listServers: vi.fn(async () => servers), on: vi.fn() },
  FiveMError: class extends Error {},
  resolveStatus: vi.fn(),
}));

import { FiveMSyncService } from '../../src/services/FiveMSyncService';
import { banGameTargets, banToDiscord, defaultBanInGame } from '../../src/services/fivem/sync';
import { normalizedSanctionSchema } from '../../src/services/fivem/schemas';
import { EsxAdapter, QbCoreAdapter } from '../../src/services/fivem/adapters';
import { prisma as prismaModule } from '../../src/database/client';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;
const USER = '123456789012345678';
const guild = { id: 'g' } as never;

describe('case « en jeu » : serveurs ciblés (fonctions pures)', () => {
  it('non précisée → réglage syncBansToGame de chaque serveur actif', () => {
    expect(banGameTargets(servers, null).map((s) => s.key)).toEqual(['br']);
    expect(banGameTargets(servers, undefined).map((s) => s.key)).toEqual(['br']);
  });
  it('cochée → tous les serveurs actifs ; décochée → aucun', () => {
    expect(banGameTargets(servers, true).map((s) => s.key)).toEqual(['br', 'test']);
    expect(banGameTargets(servers, false)).toEqual([]);
  });
  it('valeur par défaut d’un formulaire : cochée si un serveur actif relaie les bans', () => {
    expect(defaultBanInGame(servers)).toBe(true);
    expect(defaultBanInGame([{ enabled: true, syncBansToGame: false }])).toBe(false);
    expect(defaultBanInGame([{ enabled: false, syncBansToGame: true }])).toBe(false);
    expect(defaultBanInGame([])).toBe(false);
  });
  it('ban venu du jeu : choix explicite de l’appel Lua, sinon syncBansToDiscord', () => {
    expect(banToDiscord(undefined, true)).toBe(true);
    expect(banToDiscord(null, false)).toBe(false);
    expect(banToDiscord(false, true)).toBe(false);
    expect(banToDiscord(true, false)).toBe(true);
  });
  it('le schéma des sanctions et les adaptateurs transmettent syncDiscord', () => {
    const base = { identifier: 'license:abc', type: 'BAN', reason: 'Cheat', staff: 'Bob' };
    expect(normalizedSanctionSchema.parse({ ...base, syncDiscord: false }).syncDiscord).toBe(false);
    expect(normalizedSanctionSchema.parse(base).syncDiscord).toBeUndefined();
    expect(new EsxAdapter().normalizeSanction({ ...base, type: 'ban', syncDiscord: 'true' }).syncDiscord).toBe(true);
    expect(new QbCoreAdapter().normalizeSanction({ license: 'license:abc', action: 'ban', reason: 'x', admin: 'y', syncDiscord: false }).syncDiscord).toBe(false);
  });
});

describe('ban Discord → jeu avec l’option en_jeu (marqueurs anti-écho)', () => {
  let svc: FiveMSyncService;
  let push: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    prisma.fiveMPlayer!.findMany!.mockResolvedValue([]);
    prisma.battleRoyaleProfile!.findUnique!.mockResolvedValue(null);
    svc = new FiveMSyncService();
    push = vi.fn(async () => ({ delivered: false, id: 1 }));
    (svc as unknown as { pushAction: typeof push }).pushAction = push;
  });

  it('sans option : seulement les serveurs dont syncBansToGame est actif', async () => {
    svc.prepareDiscordBan('unban', 'g', USER, null);
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(1);
    expect(push.mock.calls.map((c) => (c[0] as { key: string }).key)).toEqual(['br']);
  });

  it('en_jeu:true : tous les serveurs actifs, marqueur consommé', async () => {
    svc.prepareDiscordBan('unban', 'g', USER, true);
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(2);
    expect(push.mock.calls.map((c) => (c[0] as { key: string }).key)).toEqual(['br', 'test']);
    push.mockClear();
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(1);
  });

  it('en_jeu:false : rien n’est relayé', async () => {
    svc.prepareDiscordBan('unban', 'g', USER, false);
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('action Discord échouée : marqueurs retirés (un ban suivant suit le réglage normal)', async () => {
    svc.prepareDiscordBan('unban', 'g', USER, false);
    svc.abortDiscordBan('unban', 'g', USER);
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(1);
  });

  it('ban venu du jeu : jamais renvoyé vers le jeu (anti-écho), même avec en_jeu:true', async () => {
    svc.markFromGame('ban', 'g', USER);
    svc.prepareDiscordBan('ban', 'g', USER, true);
    expect(await svc.onDiscordBan(guild, USER, 'ban')).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('unban en jeu seulement (membre non banni de Discord)', async () => {
    expect(await svc.pushBanToGame(guild, USER, 'unban', true)).toBe(2);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ key: 'test' }), 'UNBAN', expect.objectContaining({ discordId: USER }));
    push.mockClear();
    expect(await svc.pushBanToGame(guild, USER, 'unban', false)).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });
});
