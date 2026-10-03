import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { antiRaidConfigSchema, DEFAULT_ANTI_RAID } from '../../src/services/AntiRaidService';
import { warnThresholdsSchema, DEFAULT_WARN_THRESHOLDS, moderationConfigUpdateSchema } from '../../src/services/ModerationService';

describe('antiRaidConfigSchema', () => {
  it('fournit une configuration complète par défaut depuis {}', () => {
    const cfg = antiRaidConfigSchema.parse({});
    expect(cfg.antiSpam).toEqual({ enabled: true, maxMessages: 6, intervalSeconds: 5, timeoutSeconds: 600 });
    expect(cfg.antiMassMention).toEqual({ enabled: true, maxMentions: 5, timeoutSeconds: 600 });
    expect(cfg.antiLink).toEqual({ enabled: false, blockInvites: true, blockLinks: false, whitelistDomains: [], action: 'DELETE', timeoutSeconds: 300 });
    expect(cfg.antiNewAccount).toEqual({ enabled: false, minAgeDays: 7, action: 'KICK', quarantineRoleId: null });
    expect(cfg.antiBot).toEqual({ enabled: false, allowedBotIds: [] });
    expect(cfg.antiMassJoin).toEqual({ enabled: true, maxJoins: 10, intervalSeconds: 10, lockdown: true });
    expect(cfg.exemptRoleIds).toEqual([]);
    expect(cfg.exemptChannelIds).toEqual([]);
    expect(DEFAULT_ANTI_RAID).toEqual(cfg);
  });

  it('complète une protection partielle avec ses défauts', () => {
    const cfg = antiRaidConfigSchema.parse({ antiSpam: { maxMessages: 10 }, antiLink: { enabled: true, whitelistDomains: ['https://YouTube.com/watch', 'discord.com'] } });
    expect(cfg.antiSpam).toEqual({ enabled: true, maxMessages: 10, intervalSeconds: 5, timeoutSeconds: 600 });
    expect(cfg.antiLink.enabled).toBe(true);
    expect(cfg.antiLink.whitelistDomains).toEqual(['youtube.com', 'discord.com']);
    expect(cfg.antiLink.action).toBe('DELETE');
  });

  it('rejette les valeurs hors bornes et les IDs invalides', () => {
    expect(antiRaidConfigSchema.safeParse({ antiSpam: { maxMessages: 1 } }).success).toBe(false);
    expect(antiRaidConfigSchema.safeParse({ antiSpam: { timeoutSeconds: 10 } }).success).toBe(false);
    expect(antiRaidConfigSchema.safeParse({ antiNewAccount: { minAgeDays: 0 } }).success).toBe(false);
    expect(antiRaidConfigSchema.safeParse({ antiLink: { action: 'KICK' } }).success).toBe(false);
    expect(antiRaidConfigSchema.safeParse({ exemptRoleIds: ['not-an-id'] }).success).toBe(false);
    expect(antiRaidConfigSchema.safeParse({ antiBot: { allowedBotIds: ['123456789012345678'] } }).success).toBe(true);
  });
});

describe('warnThresholdsSchema', () => {
  it('a des défauts 3→timeout 1h, 5→kick, 7→ban', () => {
    expect(DEFAULT_WARN_THRESHOLDS).toEqual([
      { count: 3, action: 'TIMEOUT', duration: 3600 },
      { count: 5, action: 'KICK' },
      { count: 7, action: 'BAN' },
    ]);
    expect(warnThresholdsSchema.parse(DEFAULT_WARN_THRESHOLDS)).toEqual(DEFAULT_WARN_THRESHOLDS);
  });

  it('trie par count et déduplique (le dernier gagne)', () => {
    const out = warnThresholdsSchema.parse([
      { count: 5, action: 'KICK' },
      { count: 2, action: 'TIMEOUT', duration: 600 },
      { count: 5, action: 'BAN' },
    ]);
    expect(out).toEqual([
      { count: 2, action: 'TIMEOUT', duration: 600 },
      { count: 5, action: 'BAN' },
    ]);
  });

  it('rejette une action inconnue ou une durée trop courte', () => {
    expect(warnThresholdsSchema.safeParse([{ count: 3, action: 'MUTE' }]).success).toBe(false);
    expect(warnThresholdsSchema.safeParse([{ count: 3, action: 'TIMEOUT', duration: 5 }]).success).toBe(false);
    expect(warnThresholdsSchema.safeParse([{ count: 0, action: 'KICK' }]).success).toBe(false);
  });

  it('moderationConfigUpdateSchema accepte une mise à jour partielle', () => {
    const r = moderationConfigUpdateSchema.parse({ dmOnSanction: false, muteRoleId: '123456789012345678' });
    expect(r).toEqual({ dmOnSanction: false, muteRoleId: '123456789012345678' });
    expect(moderationConfigUpdateSchema.safeParse({ muteRoleId: 'abc' }).success).toBe(false);
  });
});
