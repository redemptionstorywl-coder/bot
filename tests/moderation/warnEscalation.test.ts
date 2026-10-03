import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { prisma } from '../../src/database/client';
const prismaMock = prisma as unknown as ReturnType<typeof createPrismaMock>;

import { ModerationService, resolveEscalation, DEFAULT_WARN_THRESHOLDS } from '../../src/services/ModerationService';

describe('resolveEscalation', () => {
  it('ne déclenche que sur le seuil atteint exactement', () => {
    expect(resolveEscalation(1, DEFAULT_WARN_THRESHOLDS)).toBeNull();
    expect(resolveEscalation(3, DEFAULT_WARN_THRESHOLDS)).toEqual({ count: 3, action: 'TIMEOUT', duration: 3600 });
    expect(resolveEscalation(4, DEFAULT_WARN_THRESHOLDS)).toBeNull();
    expect(resolveEscalation(5, DEFAULT_WARN_THRESHOLDS)).toEqual({ count: 5, action: 'KICK' });
    expect(resolveEscalation(7, DEFAULT_WARN_THRESHOLDS)).toEqual({ count: 7, action: 'BAN' });
    expect(resolveEscalation(8, DEFAULT_WARN_THRESHOLDS)).toBeNull();
  });
});

/** Fabrique un faux Guild / GuildMember / User minimal pour exercer warn() sans Discord. */
function fakeGuild() {
  const botUser = { id: 'bot', tag: 'Bot#0000', bot: true, send: vi.fn() };
  const targetUser = { id: 'u1', tag: 'Target#0001', bot: false, send: vi.fn().mockResolvedValue(undefined), displayAvatarURL: () => 'https://cdn/avatar.png' };
  const member = {
    id: 'u1',
    user: targetUser,
    moderatable: true,
    kickable: true,
    bannable: true,
    timeout: vi.fn().mockResolvedValue(undefined),
    kick: vi.fn().mockResolvedValue(undefined),
    roles: { cache: new Map(), add: vi.fn(), remove: vi.fn() },
  };
  const guild = {
    id: 'g1',
    name: 'Test Guild',
    ownerId: 'owner',
    client: { user: botUser, users: { fetch: vi.fn() } },
    members: { ban: vi.fn().mockResolvedValue(undefined), me: null, fetch: vi.fn() },
    bans: { remove: vi.fn() },
    roles: { cache: new Map(), everyone: { id: 'g1' } },
    channels: { cache: new Map() },
  };
  const moderator = { id: 'mod', tag: 'Mod#0001', bot: false };
  return { guild, member, moderator, targetUser, botUser };
}

describe('ModerationService.warn — escalade des seuils', () => {
  let caseCounter = 0;
  beforeEach(() => {
    caseCounter = 0;
    prismaMock.moderationConfig.findUnique.mockResolvedValue(null); // défauts
    prismaMock.sanction.aggregate.mockImplementation(async () => ({ _max: { caseNumber: caseCounter } }));
    prismaMock.sanction.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      caseCounter = data.caseNumber as number;
      return { id: caseCounter, ...data, createdAt: new Date() };
    });
    prismaMock.warning.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 10, active: true, createdAt: new Date(), ...data }));
    prismaMock.guild.findUnique.mockResolvedValue(null); // pas de config serveur → pas d'envoi de log Discord
  });

  it('sans seuil atteint : un simple WARN, pas d’escalade', async () => {
    const svc = new ModerationService();
    const { guild, member, moderator } = fakeGuild();
    prismaMock.warning.count.mockResolvedValue(1);
    const r = await svc.warn({ guild: guild as never, target: member as never, moderator: moderator as never, reason: 'Spam' });
    expect(r.sanction.type).toBe('WARN');
    expect(r.sanction.caseNumber).toBe(1);
    expect(r.activeCount).toBe(1);
    expect(r.escalation).toBeNull();
    expect(member.timeout).not.toHaveBeenCalled();
    expect(r.dmSent).toBe(true);
  });

  it('3 warns actifs → TIMEOUT 1h automatique, case distincte, raison d’escalade', async () => {
    const svc = new ModerationService();
    const { guild, member, moderator } = fakeGuild();
    prismaMock.warning.count.mockResolvedValue(3);
    const r = await svc.warn({ guild: guild as never, target: member as never, moderator: moderator as never, reason: 'Insultes' });
    expect(r.escalation?.threshold).toEqual({ count: 3, action: 'TIMEOUT', duration: 3600 });
    expect(r.escalation?.error).toBeNull();
    expect(r.escalation?.sanction?.type).toBe('TIMEOUT');
    expect(r.escalation?.sanction?.caseNumber).toBe(2);
    expect(r.escalation?.sanction?.moderatorId).toBe('bot');
    expect(r.escalation?.sanction?.duration).toBe(3600);
    expect(member.timeout).toHaveBeenCalledTimes(1);
    expect(member.timeout.mock.calls[0]![0]).toBe(3600 * 1000);
  });

  it('5 warns actifs → KICK automatique', async () => {
    const svc = new ModerationService();
    const { guild, member, moderator } = fakeGuild();
    prismaMock.warning.count.mockResolvedValue(5);
    const r = await svc.warn({ guild: guild as never, target: member as never, moderator: moderator as never, reason: 'Encore' });
    expect(r.escalation?.threshold.action).toBe('KICK');
    expect(member.kick).toHaveBeenCalledTimes(1);
    expect(r.escalation?.sanction?.type).toBe('KICK');
  });

  it('7 warns actifs → BAN automatique via guild.members.ban', async () => {
    const svc = new ModerationService();
    const { guild, member, moderator } = fakeGuild();
    prismaMock.warning.count.mockResolvedValue(7);
    const r = await svc.warn({ guild: guild as never, target: member as never, moderator: moderator as never, reason: 'Dernier' });
    expect(r.escalation?.threshold.action).toBe('BAN');
    expect(guild.members.ban).toHaveBeenCalledWith('u1', expect.objectContaining({ reason: expect.stringContaining('bot') }));
    expect(r.escalation?.sanction?.type).toBe('BAN');
    expect(prismaMock.ban.create).toHaveBeenCalled();
  });

  it('seuil atteint mais bot sans hiérarchie → escalade en erreur, warn conservé', async () => {
    const svc = new ModerationService();
    const { guild, member, moderator } = fakeGuild();
    member.moderatable = false;
    prismaMock.warning.count.mockResolvedValue(3);
    const r = await svc.warn({ guild: guild as never, target: member as never, moderator: moderator as never, reason: 'x' });
    expect(r.sanction.type).toBe('WARN');
    expect(r.escalation?.sanction).toBeNull();
    expect(r.escalation?.error).toBe('moderation.errors.bot_hierarchy');
    expect(member.timeout).not.toHaveBeenCalled();
  });

  it('respecte des seuils personnalisés (TEMPBAN avec durée)', async () => {
    const svc = new ModerationService();
    const { guild, member, moderator } = fakeGuild();
    prismaMock.moderationConfig.findUnique.mockResolvedValue({ guildId: 'g1', warnThresholds: [{ count: 2, action: 'TEMPBAN', duration: 7200 }], muteRoleId: null, dmOnSanction: false, antiRaid: {}, lockdownActive: false, lockdownState: null, updatedAt: new Date() });
    prismaMock.warning.count.mockResolvedValue(2);
    const r = await svc.warn({ guild: guild as never, target: member as never, moderator: moderator as never, reason: 'x' });
    expect(r.dmSent).toBe(false); // dmOnSanction désactivé
    expect(r.escalation?.sanction?.type).toBe('TEMPBAN');
    expect(r.escalation?.sanction?.duration).toBe(7200);
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
  });
});
