import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { levelFromXp, xpForLevel, levelProgress, computeKd, sortLeaderboard, battlePassProgress, defaultTiers, parseTiers, progressBar, rankLabel, type LeaderboardRow } from '../../src/services/BattleRoyaleService';

const row = (userId: string, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({ userId, nickname: null, wins: 0, kills: 0, deaths: 0, matches: 0, level: 1, xp: 0, kd: 0, ...over });

describe('formule niveau / XP', () => {
  it('level = floor(sqrt(xp/100)) + 1', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(400)).toBe(3);
    expect(levelFromXp(899)).toBe(3);
    expect(levelFromXp(900)).toBe(4);
    expect(levelFromXp(-50)).toBe(1);
  });
  it('xpForLevel est l’inverse', () => {
    for (const lvl of [1, 2, 5, 10, 42]) expect(levelFromXp(xpForLevel(lvl))).toBe(lvl);
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(4)).toBe(900);
  });
  it('progression dans le niveau', () => {
    const p = levelProgress(250);
    expect(p.level).toBe(2);
    expect(p.current).toBe(150);
    expect(p.needed).toBe(300);
    expect(p.ratio).toBeCloseTo(0.5);
  });
});

describe('K/D', () => {
  it('kills / max(1, deaths)', () => {
    expect(computeKd(10, 0)).toBe(10);
    expect(computeKd(10, 4)).toBe(2.5);
    expect(computeKd(1, 3)).toBe(0.33);
    expect(computeKd(0, 0)).toBe(0);
  });
});

describe('tri des classements', () => {
  const rows = [row('a', { wins: 3, kills: 10, xp: 500, level: 3, kd: 2 }), row('b', { wins: 5, kills: 4, xp: 900, level: 4, kd: 0.5 }), row('c', { wins: 3, kills: 12, xp: 100, level: 2, kd: 12 })];
  it('par victoires puis kills', () => {
    expect(sortLeaderboard(rows, 'wins').map((r) => r.userId)).toEqual(['b', 'c', 'a']);
  });
  it('par kills', () => {
    expect(sortLeaderboard(rows, 'kills').map((r) => r.userId)).toEqual(['c', 'a', 'b']);
  });
  it('par niveau (XP)', () => {
    expect(sortLeaderboard(rows, 'level').map((r) => r.userId)).toEqual(['b', 'a', 'c']);
  });
  it('par K/D, sans muter l’entrée, stable sur égalité', () => {
    const copy = [...rows];
    expect(sortLeaderboard(rows, 'kd').map((r) => r.userId)).toEqual(['c', 'a', 'b']);
    expect(rows).toEqual(copy);
    expect(sortLeaderboard([row('z'), row('y')], 'wins').map((r) => r.userId)).toEqual(['y', 'z']);
  });
  it('médailles', () => {
    expect(rankLabel(0)).toBe('🥇');
    expect(rankLabel(2)).toBe('🥉');
    expect(rankLabel(3)).toBe('**#4**');
  });
});

describe('Battle Pass', () => {
  const tiers = defaultTiers(5, 1000);
  it('calcule le palier et la progression', () => {
    const p = battlePassProgress(2500, tiers);
    expect(p.tier).toBe(2);
    expect(p.nextTier?.tier).toBe(3);
    expect(p.current).toBe(500);
    expect(p.needed).toBe(1000);
    expect(p.ratio).toBeCloseTo(0.5);
    expect(p.maxed).toBe(false);
  });
  it('palier 0 au départ, maxé à la fin', () => {
    expect(battlePassProgress(0, tiers).tier).toBe(0);
    const max = battlePassProgress(99_999, tiers);
    expect(max.tier).toBe(5);
    expect(max.maxed).toBe(true);
    expect(max.nextTier).toBeNull();
    expect(battlePassProgress(10, []).maxed).toBe(false);
  });
  it('parse et trie les tiers stockés', () => {
    expect(parseTiers([{ tier: 2, xpRequired: 200 }, { tier: 1, xpRequired: 100 }]).map((t) => t.tier)).toEqual([1, 2]);
    expect(parseTiers('x')).toEqual([]);
  });
  it('barre de progression', () => {
    expect(progressBar(0.5)).toBe('█████░░░░░');
    expect(progressBar(2)).toBe('██████████');
  });
});
