import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));
vi.mock('../../src/services/GuildConfigService', () => ({ guildConfigService: { get: vi.fn().mockResolvedValue(null), emit: vi.fn() } }));

import { ModerationService } from '../../src/services/ModerationService';
import { prisma as prismaModule } from '../../src/database/client';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;

function fakeChannel() {
  const edit = vi.fn().mockResolvedValue(undefined);
  const everyone = { id: 'g1' };
  return {
    id: 'c1',
    guild: { id: 'g1', roles: { everyone } },
    isThread: () => false,
    permissionOverwrites: { edit, cache: new Map() },
    _edit: edit,
  } as never;
}
const moderator = { id: 'm1', tag: 'mod#0001' } as never;

describe('ModerationService.muteChannel', () => {
  beforeEach(() => {
    prisma.sanction.create.mockResolvedValue({ id: 7, caseNumber: 1, type: 'LOCK', metadata: { previous: 'none' }, reason: null, duration: null, channelId: 'c1', createdAt: new Date() });
    prisma.sanction.aggregate.mockResolvedValue({ _max: { caseNumber: 0 } });
    prisma.channelMute.upsert.mockClear();
    prisma.channelMute.deleteMany.mockClear();
  });

  it('verrouille le salon et programme le déverrouillage quand une durée est donnée', async () => {
    const svc = new ModerationService();
    const channel = fakeChannel();
    const before = Date.now();
    const { sanction, expiresAt } = await svc.muteChannel({ channel, moderator, reason: 'calme', duration: 600 });
    expect(sanction.caseNumber).toBe(1);
    expect(expiresAt).not.toBeNull();
    expect(expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect((channel as { _edit: ReturnType<typeof vi.fn> })._edit).toHaveBeenCalledWith({ id: 'g1' }, { SendMessages: false }, expect.objectContaining({ reason: expect.stringContaining('calme') }));
    expect(prisma.channelMute.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { channelId: 'c1' }, create: expect.objectContaining({ guildId: 'g1', channelId: 'c1', moderatorId: 'm1', reason: 'calme' }) }));
  });

  it('sans durée : verrouillage simple, aucune sourdine programmée', async () => {
    const svc = new ModerationService();
    const { expiresAt } = await svc.muteChannel({ channel: fakeChannel(), moderator, duration: null });
    expect(expiresAt).toBeNull();
    expect(prisma.channelMute.upsert).not.toHaveBeenCalled();
    expect(prisma.channelMute.deleteMany).toHaveBeenCalledWith({ where: { channelId: 'c1' } });
  });

  it('unlockChannel lève la sourdine programmée', async () => {
    const svc = new ModerationService();
    prisma.sanction.findFirst.mockResolvedValue({ metadata: { previous: 'neutral' } });
    await svc.unlockChannel({ channel: fakeChannel(), moderator });
    expect(prisma.channelMute.deleteMany).toHaveBeenCalledWith({ where: { channelId: 'c1' } });
  });

  it('channelUnmuteTick ne fait rien sans client attaché', async () => {
    const svc = new ModerationService();
    expect(await svc.channelUnmuteTick()).toBe(0);
    expect(prisma.channelMute.findMany).not.toHaveBeenCalled();
  });
});
