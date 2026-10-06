import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
import { prisma } from '../../src/database/client';

const prismaMock = prisma as unknown as ReturnType<typeof createPrismaMock>;
// restoreMocks est actif : l'implémentation doit être passée à vi.fn() pour survivre au restore.
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn(async () => undefined) } }));
vi.mock('../../src/services/GuildConfigService', () => ({
  guildConfigService: {
    get: vi.fn(async () => ({ guildId: 'g', defaultLanguage: 'fr', brandColor: 0x2f8bff })),
  },
}));

import { AnnouncementError, AnnouncementService, isScheduleDue } from '../../src/services/AnnouncementService';
import { loggingService } from '../../src/services/LoggingService';

const now = new Date('2025-06-01T12:00:00Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    guildId: 'g',
    title: 'Hello',
    content: null,
    spec: { title: 'Hello' },
    channelId: 'chan',
    mentionRoleIds: [],
    mentionEveryone: false,
    buttons: [],
    status: 'SCHEDULED',
    messages: [],
    createdById: 'u',
    publishedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeClient(send: ReturnType<typeof vi.fn>) {
  return {
    guilds: { cache: new Map() },
    channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, isDMBased: () => false, send }) },
  } as never;
}

describe('isScheduleDue', () => {
  it('due si PENDING et date passée, sinon non', () => {
    expect(isScheduleDue({ status: 'PENDING', scheduledAt: new Date(now.getTime() - 1000) }, now)).toBe(true);
    expect(isScheduleDue({ status: 'PENDING', scheduledAt: now }, now)).toBe(true);
    expect(isScheduleDue({ status: 'PENDING', scheduledAt: new Date(now.getTime() + 1000) }, now)).toBe(false);
    expect(isScheduleDue({ status: 'SENT', scheduledAt: new Date(now.getTime() - 1000) }, now)).toBe(false);
    expect(isScheduleDue({ status: 'CANCELLED', scheduledAt: new Date(now.getTime() - 1000) }, now)).toBe(false);
  });
});

describe('AnnouncementService.processDue', () => {
  beforeEach(() => {
    prismaMock.scheduledAnnouncement.findMany.mockReset();
    prismaMock.scheduledAnnouncement.update.mockReset().mockResolvedValue({});
    prismaMock.announcement.findUnique.mockReset();
    prismaMock.announcement.update.mockReset();
    prismaMock.announcement.updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(loggingService.log).mockClear();
  });

  it('publie une programmation due et la marque SENT', async () => {
    const service = new AnnouncementService();
    const send = vi.fn().mockResolvedValue({ id: 'msg1' });
    service.attach(fakeClient(send));
    prismaMock.scheduledAnnouncement.findMany.mockResolvedValue([{ id: 1, announcementId: 7, scheduledAt: new Date(now.getTime() - 60_000), status: 'PENDING', announcement: row() }]);
    prismaMock.announcement.findUnique.mockResolvedValue(row());
    prismaMock.announcement.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));

    const r = await service.processDue(now);
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(prismaMock.announcement.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 }, data: expect.objectContaining({ status: 'PUBLISHED', messages: [{ channelId: 'chan', messageId: 'msg1' }] }) }));
    expect(prismaMock.scheduledAnnouncement.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ status: 'SENT' }) }));
    expect(loggingService.log).toHaveBeenCalledWith(expect.objectContaining({ category: 'ANNOUNCEMENT', action: 'announcement.publish_scheduled' }));
  });

  it('ignore une programmation non due', async () => {
    const service = new AnnouncementService();
    const send = vi.fn();
    service.attach(fakeClient(send));
    prismaMock.scheduledAnnouncement.findMany.mockResolvedValue([{ id: 2, announcementId: 7, scheduledAt: new Date(now.getTime() + 60_000), status: 'PENDING', announcement: row() }]);
    const r = await service.processDue(now);
    expect(r).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('marque FAILED avec l’erreur et repasse l’annonce en brouillon en cas d’échec', async () => {
    const service = new AnnouncementService();
    const send = vi.fn().mockRejectedValue(new Error('Missing Permissions'));
    service.attach(fakeClient(send));
    prismaMock.scheduledAnnouncement.findMany.mockResolvedValue([{ id: 3, announcementId: 7, scheduledAt: new Date(now.getTime() - 1000), status: 'PENDING', announcement: row() }]);
    prismaMock.announcement.findUnique.mockResolvedValue(row());

    const r = await service.processDue(now);
    expect(r).toEqual({ sent: 0, failed: 1 });
    expect(prismaMock.scheduledAnnouncement.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('Missing Permissions') }) }));
    expect(prismaMock.announcement.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DRAFT' } }));
    expect(loggingService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'announcement.schedule_failed' }));
  });
});

describe('AnnouncementService.schedule / publish garde-fous', () => {
  beforeEach(() => {
    prismaMock.announcement.findUnique.mockReset();
  });

  it('refuse une date passée et une annonce déjà publiée', async () => {
    const service = new AnnouncementService();
    service.attach(fakeClient(vi.fn()));
    prismaMock.announcement.findUnique.mockResolvedValue(row({ status: 'DRAFT' }));
    await expect(service.schedule(7, new Date(Date.now() - 1000))).rejects.toMatchObject({ code: 'past_date' });
    prismaMock.announcement.findUnique.mockResolvedValue(row({ status: 'PUBLISHED' }));
    await expect(service.publish(7)).rejects.toMatchObject({ code: 'already_published' });
    await expect(service.schedule(7, new Date(Date.now() + 60_000))).rejects.toBeInstanceOf(AnnouncementError);
  });

  it('refuse de publier sans salon', async () => {
    const service = new AnnouncementService();
    service.attach(fakeClient(vi.fn()));
    prismaMock.announcement.findUnique.mockResolvedValue(row({ status: 'DRAFT', channelId: null }));
    await expect(service.publish(7)).rejects.toMatchObject({ code: 'no_channel' });
  });
});
