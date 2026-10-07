import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [] }) }));

import { prisma } from '../../src/database/client';
import { loggingService } from '../../src/services/LoggingService';
import { logDispatchService } from '../../src/services/LogDispatchService';
import { logHubService } from '../../src/services/LogHubService';
import { guildConfigService } from '../../src/services/GuildConfigService';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const SRC = '100000000000000001';
const HUB = '100000000000000009';

const client = {
  guilds: { cache: new Map([[SRC, { id: SRC, name: 'RS Battle Royale', iconURL: () => 'https://cdn/br.png' }]]) },
  channels: { fetch: vi.fn() },
};

function guildRow(id: string) {
  return {
    id,
    name: 'RS Battle Royale',
    kind: 'BATTLE_ROYALE',
    settings: { guildId: id, defaultLanguage: 'fr', modules: { logs: true }, adminRoleIds: [], staffRoleIds: [] },
    logChannels: [
      { id: 1, guildId: id, category: 'MODERATION', channelId: 'local-mod', enabled: true },
      { id: 2, guildId: id, category: 'SYSTEM', channelId: 'local-sys', enabled: true },
    ],
  };
}

let enqueue: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logHubService.invalidate();
  guildConfigService.invalidate(SRC);
  db.guild.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => guildRow(where.id));
  db.logHub.findMany.mockResolvedValue([{ guildId: HUB }]);
  db.logHubSource.findFirst.mockResolvedValue({ hubGuildId: HUB, sourceGuildId: SRC, label: 'RS Battle Royale', emoji: '🎯', keepLocal: true });
  db.logHubGame.findFirst.mockResolvedValue({ hubGuildId: HUB, fivemServerId: 7, chat: false });
  db.logRoute.findMany.mockResolvedValue([
    { hubGuildId: HUB, sourceKey: SRC, routeKey: 'mod.sanctions', channelId: 'hub-sanctions' },
    { hubGuildId: HUB, sourceKey: 'global', routeKey: 'global.sanctions', channelId: 'hub-global-sanctions' },
    { hubGuildId: HUB, sourceKey: 'game:7', routeKey: 'game.kills', channelId: 'hub-kills' },
  ]);
  db.log.create.mockResolvedValue({});
  enqueue = vi.spyOn(logDispatchService, 'enqueue').mockImplementation(() => undefined);
  loggingService.attach(client as never);
});

const targets = () => enqueue.mock.calls.map((c) => c[0] as string);

describe('loggingService → salons locaux + hub (file groupée)', () => {
  it('sanction : salon local, salon sanctions du hub (auteur = serveur source) et sanctions globales', async () => {
    await loggingService.log({ guildId: SRC, category: 'MODERATION', action: 'mod.ban', title: 'Ban', color: 0xef4444 });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(3));
    expect(targets()).toEqual(['local-mod', 'hub-sanctions', 'hub-global-sanctions']);
    const local = enqueue.mock.calls[0]![1] as { author?: unknown; footer?: { text: string } };
    const hub = enqueue.mock.calls[1]![1] as { author?: { name: string; icon_url?: string }; color?: number; footer?: { text: string } };
    expect(local.author).toBeUndefined();
    expect(hub.author).toEqual({ name: '🎯 RS Battle Royale', icon_url: 'https://cdn/br.png' });
    expect(hub.color).toBe(0xef4444);
    expect(hub.footer?.text).toBe('MODERATION • mod.ban');
    expect(db.log.create).toHaveBeenCalledTimes(1);
  });

  it('keepLocal = false : plus rien dans le salon local (la base garde la trace)', async () => {
    db.logHubSource.findFirst.mockResolvedValue({ hubGuildId: HUB, sourceGuildId: SRC, label: 'RS Battle Royale', emoji: '🎯', keepLocal: false });
    await loggingService.log({ guildId: SRC, category: 'MODERATION', action: 'mod.ban', title: 'Ban' });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    expect(targets()).toEqual(['hub-sanctions', 'hub-global-sanctions']);
    expect(db.log.create).toHaveBeenCalledTimes(1);
  });

  it('log en jeu : section du jeu (auteur = serveur de jeu), jamais le salon Système local', async () => {
    await loggingService.log({ guildId: SRC, category: 'GAME', action: 'game.kill', title: 'Kill', skipDatabase: true, game: { serverId: 7, serverName: 'RS BR', route: 'game.kills' } });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(targets()).toEqual(['hub-kills']);
    expect((enqueue.mock.calls[0]![1] as { author: { name: string } }).author.name).toBe('🎮 RS BR');
    expect(db.log.create).not.toHaveBeenCalled();
  });

  it('serveur non relié : comportement historique', async () => {
    db.logHubSource.findFirst.mockResolvedValue(null);
    db.logHub.findMany.mockResolvedValue([]);
    await loggingService.log({ guildId: SRC, category: 'TICKET', action: 'ticket.open', title: 'Ticket' });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(targets()).toEqual(['local-sys']);
  });
});
