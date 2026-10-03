import { describe, expect, it, vi } from 'vitest';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { AntiNukeService, antiNukeConfigSchema, DEFAULT_ANTI_NUKE, dangerousRoles, isExemptExecutor, ANTI_NUKE_ACTIONS } from '../../src/services/AntiNukeService';
import { antiRaidConfigSchema } from '../../src/services/ModerationService';

const role = (id: string, perms: bigint[], managed = false) => ({ id, permissions: new PermissionsBitField(perms), managed });

describe('antiNukeConfigSchema', () => {
  it('fournit la configuration par défaut complète depuis {}', () => {
    const cfg = antiNukeConfigSchema.parse({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.thresholds).toEqual({
      ban: { max: 3, intervalSeconds: 10 },
      kick: { max: 3, intervalSeconds: 10 },
      channelDelete: { max: 2, intervalSeconds: 10 },
      channelCreate: { max: 5, intervalSeconds: 10 },
      roleDelete: { max: 2, intervalSeconds: 10 },
      roleCreate: { max: 5, intervalSeconds: 10 },
      webhookCreate: { max: 2, intervalSeconds: 10 },
      memberRoleUpdate: { max: 3, intervalSeconds: 10 },
      pruneMembers: { max: 1, intervalSeconds: 60 },
    });
    expect(cfg.botAddProtection).toBe(true);
    expect(cfg.punishment).toBe('STRIP_ROLES');
    expect(cfg.lockdownOnTrigger).toBe(false);
    expect(cfg.whitelistUserIds).toEqual([]);
    expect(cfg.exemptTeamRoles).toBe(false);
    expect(cfg.dmExecutor).toBe(true);
    expect(cfg.restoreBans).toBe(true);
    expect(DEFAULT_ANTI_NUKE).toEqual(cfg);
    expect(Object.keys(cfg.thresholds).sort()).toEqual([...ANTI_NUKE_ACTIONS].sort());
  });

  it('est inclus dans antiRaidConfigSchema et complète un seuil partiel', () => {
    const cfg = antiRaidConfigSchema.parse({ antiNuke: { thresholds: { ban: { max: 5 } }, punishment: 'BAN' } });
    expect(cfg.antiNuke.thresholds.ban).toEqual({ max: 5, intervalSeconds: 10 });
    expect(cfg.antiNuke.thresholds.kick).toEqual({ max: 3, intervalSeconds: 10 });
    expect(cfg.antiNuke.punishment).toBe('BAN');
    expect(antiRaidConfigSchema.parse({}).antiNuke).toEqual(DEFAULT_ANTI_NUKE);
  });

  it('rejette les valeurs invalides', () => {
    expect(antiNukeConfigSchema.safeParse({ punishment: 'TIMEOUT' }).success).toBe(false);
    expect(antiNukeConfigSchema.safeParse({ thresholds: { ban: { max: 0 } } }).success).toBe(false);
    expect(antiNukeConfigSchema.safeParse({ thresholds: { ban: { intervalSeconds: 601 } } }).success).toBe(false);
    expect(antiNukeConfigSchema.safeParse({ whitelistUserIds: ['abc'] }).success).toBe(false);
  });
});

describe('AntiNukeService.evaluate', () => {
  it('déclenche au N-ième événement dans la fenêtre puis réinitialise', () => {
    const svc = new AntiNukeService();
    const cfg = antiNukeConfigSchema.parse({ thresholds: { ban: { max: 3, intervalSeconds: 10 } } });
    const t0 = 1_000_000;
    expect(svc.evaluate('g', 'u', 'ban', cfg, t0).triggered).toBe(false);
    expect(svc.evaluate('g', 'u', 'ban', cfg, t0 + 1000).triggered).toBe(false);
    const third = svc.evaluate('g', 'u', 'ban', cfg, t0 + 2000);
    expect(third).toEqual({ action: 'ban', count: 3, max: 3, intervalSeconds: 10, triggered: true });
    // Fenêtre réinitialisée : on repart de 1.
    expect(svc.evaluate('g', 'u', 'ban', cfg, t0 + 2500).count).toBe(1);
  });

  it('oublie les événements hors fenêtre et sépare exécuteurs / actions', () => {
    const svc = new AntiNukeService();
    const cfg = antiNukeConfigSchema.parse({ thresholds: { channelDelete: { max: 2, intervalSeconds: 10 } } });
    const t0 = 5_000_000;
    svc.evaluate('g', 'u', 'channelDelete', cfg, t0);
    expect(svc.evaluate('g', 'u', 'channelDelete', cfg, t0 + 11_000).triggered).toBe(false);
    expect(svc.evaluate('g', 'other', 'channelDelete', cfg, t0 + 11_500).triggered).toBe(false);
    expect(svc.evaluate('g', 'u', 'roleDelete', cfg, t0 + 11_500).triggered).toBe(false);
    expect(svc.evaluate('g', 'u', 'channelDelete', cfg, t0 + 12_000).triggered).toBe(true);
  });

  it('pruneMembers déclenche dès la première action (max 1)', () => {
    const svc = new AntiNukeService();
    expect(svc.evaluate('g', 'u', 'pruneMembers', DEFAULT_ANTI_NUKE, 1).triggered).toBe(true);
  });

  it('invalidate() vide les fenêtres du serveur et markSeen() dédoublonne', () => {
    const svc = new AntiNukeService();
    svc.evaluate('g1', 'u', 'kick', DEFAULT_ANTI_NUKE, 1);
    svc.evaluate('g1', 'u', 'kick', DEFAULT_ANTI_NUKE, 2);
    svc.invalidate('g1');
    expect(svc.evaluate('g1', 'u', 'kick', DEFAULT_ANTI_NUKE, 3).count).toBe(1);
    expect(svc.markSeen('g1', 'entry-1')).toBe(false);
    expect(svc.markSeen('g1', 'entry-1')).toBe(true);
    expect(svc.markSeen('g2', 'entry-1')).toBe(false);
  });
});

describe('isExemptExecutor', () => {
  const base = { guildOwnerId: '100000000000000001', botId: '100000000000000002', ownerIds: ['100000000000000003'] };
  const cfg = antiNukeConfigSchema.parse({ whitelistUserIds: ['100000000000000004'] });

  it('exempte le bot, le propriétaire, OWNER_IDS et la liste blanche', () => {
    expect(isExemptExecutor({ ...base, cfg, executorId: '100000000000000002' })).toBe(true);
    expect(isExemptExecutor({ ...base, cfg, executorId: '100000000000000001' })).toBe(true);
    expect(isExemptExecutor({ ...base, cfg, executorId: '100000000000000003' })).toBe(true);
    expect(isExemptExecutor({ ...base, cfg, executorId: '100000000000000004' })).toBe(true);
    expect(isExemptExecutor({ ...base, cfg, executorId: '100000000000000099' })).toBe(false);
  });

  it("n'exempte les rôles admin configurés que si exemptTeamRoles", () => {
    const member = { roles: { cache: new Collection([['200000000000000001', { id: '200000000000000001', name: 'Admin' }]]) } } as never;
    const gcfg = { adminRoleIds: ['200000000000000001'] } as never;
    expect(isExemptExecutor({ ...base, cfg, executorId: '100000000000000099', member, gcfg })).toBe(false);
    const cfg2 = antiNukeConfigSchema.parse({ exemptTeamRoles: true });
    expect(isExemptExecutor({ ...base, cfg: cfg2, executorId: '100000000000000099', member, gcfg })).toBe(true);
  });
});

describe('dangerousRoles', () => {
  it('retient les rôles portant une permission dangereuse, hors rôles gérés', () => {
    const roles = [
      role('1', [PermissionFlagsBits.SendMessages]),
      role('2', [PermissionFlagsBits.Administrator]),
      role('3', [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel]),
      role('4', [PermissionFlagsBits.BanMembers], true),
      role('5', [PermissionFlagsBits.ManageWebhooks]),
      role('6', [PermissionFlagsBits.ModerateMembers]),
    ];
    expect(dangerousRoles(roles).map((r) => r.id)).toEqual(['2', '3', '5']);
    expect(dangerousRoles([])).toEqual([]);
  });
});
