import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));
vi.mock('../../src/services/GuildConfigService', () => ({
  CHANNELS_REMAPPED_EVENT: 'channels:remapped',
  guildConfigService: { get: vi.fn(), on: vi.fn(), emit: vi.fn(), invalidate: vi.fn() },
}));
vi.mock('../../src/services/WelcomeService', () => ({ welcomeService: { handleJoin: vi.fn(), invalidate: vi.fn() } }));
vi.mock('../../src/services/RoleService', () => ({ roleService: { applyAutoRoles: vi.fn().mockResolvedValue({ added: [], removed: [], blocked: [] }), invalidate: vi.fn() } }));

import { prisma as prismaModule } from '../../src/database/client';
import { guildConfigService } from '../../src/services/GuildConfigService';
import { welcomeService } from '../../src/services/WelcomeService';
import { roleService } from '../../src/services/RoleService';
import { moderationService, DEFAULT_ANTI_RAID } from '../../src/services/ModerationService';
import { antiRaidService } from '../../src/services/AntiRaidService';
import { honeypotService } from '../../src/services/HoneypotService';
import antiraidMessage from '../../src/events/messageCreate.antiraid';
import welcomeJoin from '../../src/events/guildMemberAdd.welcome';
import antiraidJoin from '../../src/events/guildMemberAdd.antiraid';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;
const GUILD = '900000000000000001';
const TRAP = '200000000000000009';

function config(modules: Record<string, boolean>) {
  return { guildId: GUILD, adminRoleIds: [], staffRoleIds: [], modules, defaultLanguage: 'fr' };
}

describe('messageCreate : salon piège ⇄ anti-raid', () => {
  beforeEach(async () => {
    prisma.honeypotChannel.findMany.mockResolvedValue([{ guildId: GUILD, channelId: TRAP, deleteWindowMinutes: 60, enabled: true }]);
    await honeypotService.attach({} as never);
  });

  it('un message dans le salon piège n’est pas analysé par l’anti-raid (pas de double sanction)', async () => {
    const spy = vi.spyOn(antiRaidService, 'handleMessage').mockResolvedValue();
    const message = { inGuild: () => true, author: { bot: false }, guildId: GUILD, channelId: TRAP };
    await antiraidMessage.execute({} as never, message as never);
    expect(spy).not.toHaveBeenCalled();
    await antiraidMessage.execute({} as never, { ...message, channelId: '200000000000000001' } as never);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('guildMemberAdd : anti-raid avant bienvenue / autoroles', () => {
  const member = (id: string) =>
    ({
      id,
      pending: false,
      guild: { id: GUILD, ownerId: '1' },
      user: { bot: false, tag: 'raider#0', createdTimestamp: Date.now() - 3_600_000, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
      client: { user: { id: '999' } },
      kickable: true,
    }) as never;

  beforeEach(() => {
    vi.mocked(guildConfigService.get).mockResolvedValue(config({ antiraid: true, autorole: true, welcome: true }) as never);
    vi.mocked(welcomeService.handleJoin).mockReset().mockResolvedValue(undefined);
    vi.mocked(roleService.applyAutoRoles).mockReset().mockResolvedValue({ added: [], removed: [], blocked: [] });
  });

  it('un compte trop récent expulsé ne reçoit ni autorole ni message de bienvenue ; le contrôle n’est fait qu’une fois', async () => {
    vi.spyOn(moderationService, 'getAntiRaidConfig').mockResolvedValue({ ...DEFAULT_ANTI_RAID, antiMassJoin: { ...DEFAULT_ANTI_RAID.antiMassJoin, enabled: false }, antiNewAccount: { ...DEFAULT_ANTI_RAID.antiNewAccount, enabled: true, minAgeDays: 7, action: 'KICK' } });
    vi.spyOn(moderationService, 'guildTranslator').mockResolvedValue({ t: (k: string) => k, lang: 'fr' });
    const kick = vi.spyOn(moderationService, 'kick').mockResolvedValue({ sanction: { caseNumber: 1 }, dmSent: false } as never);
    const m = member('300000000000000001');
    await Promise.all([antiraidJoin.execute({} as never, m), welcomeJoin.execute({} as never, m)]);
    expect(kick).toHaveBeenCalledTimes(1);
    expect(roleService.applyAutoRoles).not.toHaveBeenCalled();
    expect(welcomeService.handleJoin).not.toHaveBeenCalled();
  });

  it('un membre accepté est accueilli normalement', async () => {
    vi.spyOn(moderationService, 'getAntiRaidConfig').mockResolvedValue({ ...DEFAULT_ANTI_RAID, antiMassJoin: { ...DEFAULT_ANTI_RAID.antiMassJoin, enabled: false } });
    vi.spyOn(moderationService, 'guildTranslator').mockResolvedValue({ t: (k: string) => k, lang: 'fr' });
    const m = member('300000000000000002');
    await Promise.all([antiraidJoin.execute({} as never, m), welcomeJoin.execute({} as never, m)]);
    expect(roleService.applyAutoRoles).toHaveBeenCalledTimes(1);
    expect(welcomeService.handleJoin).toHaveBeenCalledTimes(1);
  });
});

describe('salon piège recréé (/clear salon|serveur)', () => {
  it('republie et épingle l’avertissement quand le message a disparu', async () => {
    const pin = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ id: '400000000000000001', pin });
    const channel = { type: 0, send };
    prisma.honeypotChannel.findMany.mockResolvedValue([]);
    await honeypotService.attach({ channels: { fetch: vi.fn().mockResolvedValue(channel) } } as never);
    prisma.honeypotChannel.findUnique.mockResolvedValue({ guildId: GUILD, channelId: TRAP, messageId: null, enabled: true, deleteWindowMinutes: 60 });
    await honeypotService.reloadGuild(GUILD);
    expect(send).toHaveBeenCalledTimes(1);
    expect(pin).toHaveBeenCalled();
    expect(prisma.honeypotChannel.update).toHaveBeenCalledWith({ where: { guildId: GUILD }, data: { messageId: '400000000000000001' } });
    expect(honeypotService.channelFor(GUILD)).toBe(TRAP);
  });
});
