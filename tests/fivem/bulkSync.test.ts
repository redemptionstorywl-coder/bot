import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));
vi.mock('../../src/services/ModerationService', () => ({ moderationService: {} }));
vi.mock('../../src/services/WhitelistService', () => ({ whitelistService: {} }));
vi.mock('../../src/services/GuildConfigService', () => ({ guildConfigService: { get: vi.fn(async () => null), on: vi.fn() } }));
vi.mock('../../src/services/FiveMService', () => ({
  fivemService: { listServers: vi.fn(async () => [{ id: 1, key: 'main', enabled: true, syncBansToGame: true }]), on: vi.fn() },
  FiveMError: class extends Error {},
  resolveStatus: vi.fn(),
}));

import { FiveMSyncService } from '../../src/services/FiveMSyncService';
import { loggingService } from '../../src/services/LoggingService';
import { fivemService } from '../../src/services/FiveMService';
import { bulkKey } from '../../src/services/fivem/sync';
import { prisma as prismaModule } from '../../src/database/client';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;

const USER = '123456789012345678';
const guild = { id: 'g' } as never;

describe('unban de masse → FiveM (markBulk)', () => {
  let svc: FiveMSyncService;
  let push: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    prisma.fiveMPlayer!.findMany!.mockResolvedValue([]);
    prisma.battleRoyaleProfile!.findUnique!.mockResolvedValue(null);
    svc = new FiveMSyncService();
    push = vi.fn(async () => ({ delivered: true, id: 1 }));
    (svc as unknown as { pushAction: typeof push }).pushAction = push;
  });

  it('sans marqueur : relayé en jeu + log', async () => {
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(1);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ key: 'main' }), 'UNBAN', expect.objectContaining({ discordId: USER }));
    expect(loggingService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'fivem.sync.unban' }));
  });

  it('`skip` (inclure_jeu:false) : rien n’est relayé, marqueur consommé', async () => {
    svc.markBulk('unban', 'g', USER, 'skip');
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(0);
    expect(fivemService.listServers).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    // Un unban ultérieur (hors opération de masse) est de nouveau relayé
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(1);
  });

  it('`quiet` (inclure_jeu:true) : relayé en jeu, sans log par membre', async () => {
    svc.markBulk('unban', 'g', USER, 'quiet');
    expect(await svc.onDiscordBan(guild, USER, 'unban')).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(loggingService.log).not.toHaveBeenCalled();
  });

  it('marqueur limité au serveur, au membre et au type d’action', () => {
    expect(bulkKey('skip', 'unban', 'g', USER)).not.toBe(bulkKey('skip', 'ban', 'g', USER));
    expect(bulkKey('skip', 'unban', 'g', USER)).not.toBe(bulkKey('quiet', 'unban', 'g', USER));
    expect(bulkKey('skip', 'unban', 'g', USER)).not.toBe(bulkKey('skip', 'unban', 'h', USER));
  });
});
