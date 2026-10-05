import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const STAFF = '111111111111111111';
const MOD = '222222222222222222';
const COSMETIC = '999999999999999999';
const USER = '123456789012345678';

const servers = [{ id: 1, key: 'br', guildId: 'g', enabled: true, syncBansToGame: true, roleGroups: [{ roleId: STAFF, group: 'admin' }, { roleId: MOD, group: 'mod' }] }];

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
import { prisma as prismaModule } from '../../src/database/client';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;

const member = (roles: string[]) => ({ id: USER, guild: { id: 'g' }, user: { bot: false }, roles: { cache: new Map(roles.map((r) => [r, { id: r }])) } }) as never;

describe('rôles Discord → groupes en jeu : action SET_GROUPS', () => {
  let svc: FiveMSyncService;
  let push: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    prisma.fiveMPlayer!.count!.mockResolvedValue(1);
    prisma.fiveMPlayer!.findMany!.mockResolvedValue([{ license: 'license:abc' }]);
    prisma.battleRoyaleProfile!.findUnique!.mockResolvedValue(null);
    svc = new FiveMSyncService();
    push = vi.fn(async () => ({ delivered: false, id: 1 }));
    (svc as unknown as { pushAction: typeof push }).pushAction = push;
  });

  it('gain d’un rôle associé → groupes poussés (priorité : admin avant mod) avec la liste des groupes gérés', async () => {
    expect(await svc.onMemberRolesChanged([MOD], member([MOD, STAFF]))).toBe(1);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'br' }),
      'SET_GROUPS',
      expect.objectContaining({ discordId: USER, license: 'license:abc', groups: ['admin', 'mod'], group: 'admin', managedGroups: ['admin', 'mod'] }),
    );
  });

  it('perte du dernier rôle associé → groupes vides (retirés en jeu)', async () => {
    expect(await svc.onMemberRolesChanged([MOD], member([]))).toBe(1);
    expect(push).toHaveBeenCalledWith(expect.anything(), 'SET_GROUPS', expect.objectContaining({ groups: [], group: null, managedGroups: ['admin', 'mod'] }));
  });

  it('rôle sans groupe associé → rien n’est poussé', async () => {
    expect(await svc.onMemberRolesChanged([MOD], member([MOD, COSMETIC]))).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('membre jamais venu en jeu → rien n’est poussé (appliqué à sa première connexion)', async () => {
    prisma.fiveMPlayer!.count!.mockResolvedValue(0);
    expect(await svc.onMemberRolesChanged([], member([STAFF]))).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('anciens rôles inconnus (membre hors cache) → poussé seulement s’il détient un groupe', async () => {
    expect(await svc.onMemberRolesChanged(null, member([COSMETIC]))).toBe(0);
    expect(await svc.onMemberRolesChanged(null, member([MOD]))).toBe(1);
  });

  it('liste modifiée : joueurs en ligne rafraîchis, les groupes retirés de la liste sont retirés en jeu', async () => {
    const guild = { id: 'g', members: { fetch: vi.fn(async () => member([MOD])) } };
    (svc as unknown as { client: unknown }).client = { guilds: { cache: new Map([['g', guild]]) } };
    prisma.fiveMPlayer!.findMany!.mockImplementation(async (args: { select?: Record<string, boolean> }) => (args.select?.discordId ? [{ discordId: USER }, { discordId: USER }] : [{ license: 'license:abc' }]));
    const updated = { ...servers[0], roleGroups: [{ roleId: MOD, group: 'mod' }] };
    expect(await svc.refreshServerGroups(updated as never, ['admin', 'mod', 'vip'])).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(expect.anything(), 'SET_GROUPS', expect.objectContaining({ groups: ['mod'], group: 'mod', managedGroups: ['mod', 'admin', 'vip'] }));
  });

  it('groupes d’un membre pour /check et /players/join', () => {
    expect(svc.groupsFor(servers[0] as never, member([MOD]))).toEqual({ groups: ['mod'], primary: 'mod', managed: ['admin', 'mod'] });
    expect(svc.groupsFor(servers[0] as never, null)).toEqual({ groups: [], primary: null, managed: ['admin', 'mod'] });
  });
});
