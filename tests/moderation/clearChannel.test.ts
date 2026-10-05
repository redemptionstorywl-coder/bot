import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));
vi.mock('../../src/services/GuildConfigService', () => ({
  CHANNELS_REMAPPED_EVENT: 'channels:remapped',
  guildConfigService: { get: vi.fn().mockResolvedValue(null), emit: vi.fn(), invalidate: vi.fn() },
}));
vi.mock('../../src/services/WelcomeService', () => ({ welcomeService: { invalidate: vi.fn() } }));
vi.mock('../../src/services/RoleService', () => ({ roleService: { invalidate: vi.fn(), getRoleMenu: vi.fn(async (id: number) => ({ id, channelId: 'new-1' })), publishRoleMenu: vi.fn() } }));
vi.mock('../../src/services/TicketService', () => ({ ticketService: { republishPanel: vi.fn(), loadOpenChannels: vi.fn() } }));
vi.mock('../../src/services/EventService', () => ({ eventService: { get: vi.fn(async (id: number) => ({ id })), publish: vi.fn() } }));
vi.mock('../../src/services/GiveawayService', () => ({ giveawayService: { get: vi.fn(async (id: number) => ({ id })), publish: vi.fn() } }));
vi.mock('../../src/services/PollService', () => ({ pollService: { get: vi.fn(async (id: number) => ({ id })), publish: vi.fn() } }));

import { ModerationService, remapChannelReferences } from '../../src/services/ModerationService';
import { prisma as prismaModule } from '../../src/database/client';
import { ticketService } from '../../src/services/TicketService';
import { roleService } from '../../src/services/RoleService';
import { guildConfigService } from '../../src/services/GuildConfigService';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;
const MAP = { 'old-1': 'new-1', 'old-2': 'new-2' };

function resetPrisma() {
  for (const model of Object.keys(prisma)) {
    const m = (prisma as Record<string, Record<string, { mockReset?: () => void }>>)[model];
    if (!m || typeof m !== 'object') continue;
    for (const fn of Object.values(m)) fn?.mockReset?.();
  }
  for (const model of ['logChannel', 'ticketPanel', 'roleMenu', 'announcement', 'event', 'giveaway', 'poll', 'schoolClass', 'channelMute', 'honeypotChannel', 'ticket']) {
    prisma[model]!.findMany!.mockResolvedValue([]);
    prisma[model]!.update!.mockResolvedValue({});
  }
  for (const model of ['welcomeConfig', 'leaveConfig', 'schoolConfig', 'whitelistConfig']) {
    prisma[model]!.findUnique!.mockResolvedValue(null);
    prisma[model]!.update!.mockResolvedValue({});
  }
  prisma.reactionRole!.deleteMany!.mockResolvedValue({ count: 0 });
  prisma.fiveMServer!.updateMany!.mockResolvedValue({ count: 0 });
}

describe('remapChannelReferences', () => {
  beforeEach(resetPrisma);

  it('met à jour chaque table qui référence un ancien salon', async () => {
    prisma.logChannel!.findMany!.mockResolvedValue([{ id: 1, channelId: 'old-1' }]);
    prisma.welcomeConfig!.findUnique!.mockResolvedValue({ guildId: 'g', channelId: 'old-1' });
    prisma.leaveConfig!.findUnique!.mockResolvedValue({ guildId: 'g', channelId: 'old-2' });
    prisma.ticketPanel!.findMany!.mockResolvedValue([{ id: 3, channelId: 'old-1' }]);
    prisma.roleMenu!.findMany!.mockResolvedValue([{ id: 4, channelId: 'old-2' }]);
    prisma.reactionRole!.deleteMany!.mockResolvedValue({ count: 2 });
    prisma.announcement!.findMany!.mockResolvedValue([{ id: 5, channelId: 'old-1' }]);
    prisma.event!.findMany!.mockResolvedValue([{ id: 6, channelId: 'old-1' }]);
    prisma.giveaway!.findMany!.mockResolvedValue([{ id: 7, channelId: 'old-2' }]);
    prisma.poll!.findMany!.mockResolvedValue([{ id: 8, channelId: 'old-1' }]);
    prisma.fiveMServer!.updateMany!.mockImplementation(async ({ where }: { where: { statusChannelId: string } }) => ({ count: where.statusChannelId === 'old-2' ? 1 : 0 }));
    prisma.schoolClass!.findMany!.mockResolvedValue([{ id: 9, channelId: 'old-2' }]);
    prisma.schoolConfig!.findUnique!.mockResolvedValue({ guildId: 'g', applicationChannelId: 'old-1', announceChannelId: 'keep' });
    prisma.whitelistConfig!.findUnique!.mockResolvedValue({ guildId: 'g', reviewChannelId: 'old-2' });
    prisma.channelMute!.findMany!.mockResolvedValue([{ id: 10, channelId: 'old-1' }]);

    const r = await remapChannelReferences('g', MAP);

    expect(prisma.logChannel!.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { channelId: 'new-1' } });
    expect(prisma.welcomeConfig!.update).toHaveBeenCalledWith({ where: { guildId: 'g' }, data: { channelId: 'new-1' } });
    expect(prisma.leaveConfig!.update).toHaveBeenCalledWith({ where: { guildId: 'g' }, data: { channelId: 'new-2' } });
    expect(prisma.ticketPanel!.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { channelId: 'new-1', messageId: null } });
    expect(prisma.roleMenu!.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { channelId: 'new-2', messageId: null } });
    expect(prisma.reactionRole!.deleteMany).toHaveBeenCalledWith({ where: { guildId: 'g', channelId: { in: ['old-1', 'old-2'] } } });
    expect(prisma.announcement!.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { channelId: 'new-1', messages: [] } });
    expect(prisma.event!.findMany).toHaveBeenCalledWith({ where: { guildId: 'g', channelId: { in: ['old-1', 'old-2'] }, status: { in: ['SCHEDULED', 'ONGOING'] } } });
    expect(prisma.event!.update).toHaveBeenCalledWith({ where: { id: 6 }, data: { channelId: 'new-1', messageId: null } });
    expect(prisma.giveaway!.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { channelId: 'new-2', messageId: null } });
    expect(prisma.poll!.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { channelId: 'new-1', messageId: null } });
    expect(prisma.fiveMServer!.updateMany).toHaveBeenCalledWith({ where: { guildId: 'g', statusChannelId: 'old-2' }, data: { statusChannelId: 'new-2', statusMessageId: null } });
    expect(prisma.schoolClass!.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { channelId: 'new-2' } });
    expect(prisma.schoolConfig!.update).toHaveBeenCalledWith({ where: { guildId: 'g' }, data: { applicationChannelId: 'new-1', announceChannelId: 'keep' } });
    expect(prisma.whitelistConfig!.update).toHaveBeenCalledWith({ where: { guildId: 'g' }, data: { reviewChannelId: 'new-2' } });
    expect(prisma.channelMute!.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { channelId: 'new-1' } });
    // Tickets non concernés par défaut
    expect(prisma.ticket!.findMany).not.toHaveBeenCalled();

    expect(r.ticketPanelIds).toEqual([3]);
    expect(r.roleMenuIds).toEqual([4]);
    expect(r.eventIds).toEqual([6]);
    expect(r.giveawayIds).toEqual([7]);
    expect(r.pollIds).toEqual([8]);
    expect(r.counts).toMatchObject({ logChannel: 1, welcomeConfig: 1, leaveConfig: 1, reactionRole: 2, fiveMServer: 1, schoolConfig: 1, whitelistConfig: 1, channelMute: 1 });
  });

  it('remappe les tickets seulement avec includeTickets', async () => {
    prisma.ticket!.findMany!.mockResolvedValue([{ id: 11, channelId: 'old-2' }]);
    const r = await remapChannelReferences('g', MAP, { includeTickets: true });
    expect(prisma.ticket!.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { channelId: 'new-2' } });
    expect(r.counts.ticket).toBe(1);
    expect(r.ticketIds).toEqual([11]);
  });

  it('/clear salon sur un salon de ticket : le ticket suit le nouveau salon et ses boutons sont republiés', async () => {
    prisma.ticket!.findMany!.mockResolvedValue([{ id: 12, channelId: 'old-1' }]);
    prisma.sanction!.aggregate!.mockResolvedValue({ _max: { caseNumber: 0 } });
    prisma.sanction!.create!.mockResolvedValue({ id: 1, caseNumber: 1, type: 'PURGE', userId: null, moderatorId: 'admin', reason: null, duration: null, channelId: 'new-1', metadata: null, createdAt: new Date() });
    vi.mocked(ticketService).republishControls = vi.fn() as never;
    const svc = new ModerationService();
    const clone = { id: 'new-1', setPosition: vi.fn(async () => null) };
    const channel = { id: 'old-1', name: 'ticket-12', type: ChannelType.GuildText, position: 3, guild: { id: 'g', rulesChannelId: null, publicUpdatesChannelId: null, safetyAlertsChannelId: null, systemChannelId: null }, clone: vi.fn(async () => clone), delete: vi.fn(async () => null) };
    const r = await svc.nukeChannel({ channel: channel as never, moderator: { id: 'admin' } as never });
    expect(r.channel).toBe(clone);
    expect(prisma.ticket!.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { channelId: 'new-1' } });
    expect(ticketService.loadOpenChannels).toHaveBeenCalled();
    expect((ticketService as unknown as { republishControls: ReturnType<typeof vi.fn> }).republishControls).toHaveBeenCalledWith(12);
  });

  it('ne fait rien sans salon recréé et ignore les configs non concernées', async () => {
    expect(await remapChannelReferences('g', {})).toEqual({ counts: {}, ticketPanelIds: [], roleMenuIds: [], eventIds: [], giveawayIds: [], pollIds: [] });
    expect(prisma.logChannel!.findMany).not.toHaveBeenCalled();
    prisma.welcomeConfig!.findUnique!.mockResolvedValue({ guildId: 'g', channelId: 'other' });
    await remapChannelReferences('g', MAP);
    expect(prisma.welcomeConfig!.update).not.toHaveBeenCalled();
  });
});

describe('remapChannelReferences : configuration de modération', () => {
  beforeEach(resetPrisma);

  it('remappe les salons exemptés de l’anti-raid et les salons d’un lockdown en cours', async () => {
    prisma.moderationConfig!.findUnique!.mockResolvedValue({
      guildId: 'g',
      antiRaid: { exemptChannelIds: ['old-1', 'keep'], antiSpam: { enabled: true } },
      lockdownState: { at: '2026-01-01T00:00:00.000Z', actorId: 'a', reason: null, channels: { 'old-2': 'allow', keep: 'none' } },
    });
    prisma.moderationConfig!.update!.mockResolvedValue({});
    const r = await remapChannelReferences('g', MAP);
    expect(prisma.moderationConfig!.update).toHaveBeenCalledWith({
      where: { guildId: 'g' },
      data: {
        antiRaid: { exemptChannelIds: ['new-1', 'keep'], antiSpam: { enabled: true } },
        lockdownState: { at: '2026-01-01T00:00:00.000Z', actorId: 'a', reason: null, channels: { 'new-2': 'allow', keep: 'none' } },
      },
    });
    expect(r.counts.moderationConfig).toBe(1);
  });

  it('ne touche pas une configuration sans salon recréé', async () => {
    prisma.moderationConfig!.findUnique!.mockResolvedValue({ guildId: 'g', antiRaid: { exemptChannelIds: ['keep'] }, lockdownState: null });
    await remapChannelReferences('g', MAP);
    expect(prisma.moderationConfig!.update).not.toHaveBeenCalled();
  });
});

describe('ModerationService.nukeChannel (/clear salon)', () => {
  beforeEach(() => {
    resetPrisma();
    prisma.sanction!.aggregate!.mockResolvedValue({ _max: { caseNumber: 0 } });
    prisma.sanction!.create!.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, caseNumber: 1, createdAt: new Date(), ...data }));
  });

  function fakeChannel(id: string, guildPatch: Record<string, unknown> = {}) {
    const guild = { id: 'g', rulesChannelId: null, publicUpdatesChannelId: null, safetyAlertsChannelId: null, systemChannelId: null, edit: vi.fn(async () => null), ...guildPatch };
    const clone = { id: `new-${id}`, setPosition: vi.fn(async () => null), delete: vi.fn(async () => null) };
    const channel = { id, name: id, type: ChannelType.GuildText, position: 2, guild, clone: vi.fn(async () => clone), delete: vi.fn(async () => null) };
    return { guild, clone, channel };
  }

  it('recrée le salon, réassigne le salon des règles au clone, remappe et enregistre une case PURGE', async () => {
    const svc = new ModerationService();
    const { guild, clone, channel } = fakeChannel('rules', { rulesChannelId: 'rules' });
    prisma.roleMenu!.findMany!.mockResolvedValue([{ id: 4, channelId: 'rules' }]);
    const r = await svc.nukeChannel({ channel: channel as never, moderator: { id: 'admin', tag: 'admin#0' } as never });
    expect(r.channel).toBe(clone);
    expect(clone.setPosition).toHaveBeenCalledWith(2);
    expect(guild.edit).toHaveBeenCalledWith(expect.objectContaining({ rulesChannel: 'new-rules' }));
    expect(channel.delete).toHaveBeenCalled();
    expect(svc.isNukeDeletion('rules')).toBe(true);
    expect(roleService.publishRoleMenu).toHaveBeenCalledWith(4, 'new-1');
    expect(guildConfigService.emit).toHaveBeenCalledWith('channels:remapped', 'g');
    expect(prisma.sanction!.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'PURGE', channelId: 'new-rules', metadata: expect.objectContaining({ nuke: true, oldChannelId: 'rules' }) }) }));
  });

  it('supprime le clone et relance l’erreur si l’original ne peut pas être supprimé', async () => {
    const svc = new ModerationService();
    const { clone, channel } = fakeChannel('general');
    channel.delete.mockRejectedValueOnce(new Error('Missing Access'));
    await expect(svc.nukeChannel({ channel: channel as never, moderator: { id: 'admin' } as never })).rejects.toThrow('Missing Access');
    expect(clone.delete).toHaveBeenCalled();
    expect(svc.isNukeDeletion('general')).toBe(false);
    expect(prisma.sanction!.create).not.toHaveBeenCalled();
  });

  it('refuse un salon qui n’est ni texte ni annonces', async () => {
    const svc = new ModerationService();
    const { channel } = fakeChannel('vocal');
    await expect(svc.nukeChannel({ channel: { ...channel, type: ChannelType.GuildVoice } as never, moderator: { id: 'admin' } as never })).rejects.toMatchObject({ key: 'moderation.errors.channel_type' });
  });
});
