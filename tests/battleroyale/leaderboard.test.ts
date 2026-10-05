import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { KD_MIN_MATCHES, LEADERBOARD_MIN_INTERVAL_MS, RefreshGate, boardLines, buildBoards, isLeaderboardSize, renderLeaderboardEmbed, type LeaderboardView } from '../../src/services/battleroyale/leaderboard';
import type { LeaderboardRow } from '../../src/services/BattleRoyaleService';
import { translationService } from '../../src/services/TranslationService';

const row = (userId: string, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({ userId, nickname: `P${userId}`, wins: 0, kills: 0, deaths: 0, matches: 10, level: 1, xp: 0, kd: 0, ...over });

describe('classement en direct : données', () => {
  const rows = [
    row('1', { wins: 5, kills: 30, deaths: 10 }),
    row('2', { wins: 9, kills: 12, deaths: 12 }),
    row('3', { wins: 0, kills: 50, deaths: 5 }),
    row('4', { wins: 2, kills: 8, deaths: 0, matches: 2 }), // K/D 8 mais < KD_MIN_MATCHES parties
    row('5', { wins: 5, kills: 31, deaths: 20 }),
  ];

  it('victoires / kills / K/D triés, joueurs à zéro omis, K/D réservé aux joueurs avec assez de parties', () => {
    const b = buildBoards(rows, 10);
    expect(b.wins.map((e) => e.userId)).toEqual(['2', '5', '1', '4']); // égalité de victoires : départage aux kills
    expect(b.kills.map((e) => e.userId)).toEqual(['3', '5', '1', '2', '4']);
    expect(b.kd.map((e) => e.userId)).toEqual(['3', '1', '5', '2']);
    expect(b.kd[0]!.value).toBe('10.00 · 50/5');
    expect(b.kd.some((e) => e.userId === '4')).toBe(false);
    expect(KD_MIN_MATCHES).toBeGreaterThan(2);
  });

  it('taille respectée, doublons de lignes fusionnés', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(String(100 + i), { wins: 30 - i, kills: i + 1 }));
    const b = buildBoards([...many, ...many], 15);
    expect(b.wins).toHaveLength(15);
    expect(new Set(b.wins.map((e) => e.userId)).size).toBe(15);
    expect(isLeaderboardSize(15)).toBe(true);
    expect(isLeaderboardSize(12)).toBe(false);
  });

  it('pseudo : nom fourni > pseudo du profil > mention ; markdown échappé, tronqué', () => {
    const b = buildBoards([row('7', { wins: 1, nickname: null }), row('8', { wins: 2, nickname: '**Viper**' }), row('9', { wins: 3, nickname: 'x'.repeat(40) })], 10, new Map([['7', 'Membre7']]));
    const names = Object.fromEntries(b.wins.map((e) => [e.userId, e.name]));
    expect(names['7']).toBe('**Membre7**');
    expect(names['8']).toBe('**\\*\\*Viper\\*\\***');
    expect(Array.from(names['9']!.replace(/\*/g, '')).length).toBeLessThanOrEqual(24);
    expect(buildBoards([row('6', { wins: 1, nickname: null })], 10).wins[0]!.name).toBe('<@6>');
  });

  it('lignes : médailles pour le podium puis rangs, vide → texte de remplacement, ≤ 1024 caractères', () => {
    const lines = boardLines(buildBoards(rows, 10).wins, '🏆', 'vide').split('\n');
    expect(lines[0]).toMatch(/^🥇 /);
    expect(lines[1]).toMatch(/^🥈 /);
    expect(lines[2]).toMatch(/^🥉 /);
    expect(lines[3]).toMatch(/^\*\*#4\*\* /);
    expect(boardLines([], '🏆', 'vide')).toBe('vide');
    const long = Array.from({ length: 15 }, (_, i) => ({ userId: String(i), name: `**${'N'.repeat(80)}**`, value: '123456' }));
    expect(boardLines(long, '🔫', 'vide').length).toBeLessThanOrEqual(1024);
  });
});

describe('classement en direct : embed', () => {
  const view = (over: Partial<LeaderboardView> = {}): LeaderboardView => ({
    guildName: 'RS Battle Royale',
    season: 3,
    seasonName: 'Saison Neon',
    seasonEndsAt: new Date('2030-01-01T00:00:00Z'),
    size: 10,
    boards: buildBoards([row('1', { wins: 4, kills: 20, deaths: 4 })], 10),
    players: 42,
    updatedAt: new Date('2026-10-05T12:00:00Z'),
    ...over,
  });

  it('titre, saison, mise à jour relative, trois classements, pied de page', () => {
    for (const lang of ['fr', 'en']) {
      const t = translationService.bind(lang);
      const json = renderLeaderboardEmbed(view(), t).toJSON();
      expect(json.title).toContain('RS Battle Royale');
      expect(json.description).toContain('3');
      expect(json.description).toContain('Saison Neon');
      expect(json.description).toContain(`<t:${Math.floor(new Date('2026-10-05T12:00:00Z').getTime() / 1000)}:R>`);
      expect(json.fields).toHaveLength(3);
      expect(json.fields!.every((f) => f.value.length > 0 && f.value.length <= 1024)).toBe(true);
      expect(json.fields![0]!.value).toContain('🥇');
      expect(json.footer?.text).toContain('42');
    }
  });

  it('saison sans nom ni fin connue, classements vides', () => {
    const t = translationService.bind('fr');
    const json = renderLeaderboardEmbed(view({ seasonName: null, seasonEndsAt: null, boards: { wins: [], kills: [], kd: [] } }), t).toJSON();
    expect(json.description).not.toContain('⏳');
    expect(json.fields!.every((f) => f.value === t('battleroyale.live.empty'))).toBe(true);
  });
});

describe('anti-rafale des éditions (au plus une par minute)', () => {
  it('première demande immédiate, suivantes regroupées puis appliquées après la fenêtre', () => {
    const g = new RefreshGate(LEADERBOARD_MIN_INTERVAL_MS);
    expect(g.request('a', 0)).toBe(true);
    g.finish('a');
    expect(g.request('a', 10_000)).toBe(false);
    expect(g.request('a', 20_000)).toBe(false);
    expect(g.due(59_999)).toEqual([]);
    expect(g.due(60_000)).toEqual(['a']);
    g.finish('a');
    expect(g.due(200_000)).toEqual([]); // rien en attente
  });

  it('pas de rafraîchissement concurrent pour un même serveur ; serveurs indépendants', () => {
    const g = new RefreshGate(60_000);
    expect(g.request('a', 0)).toBe(true);
    expect(g.request('a', 70_000)).toBe(false); // encore en cours
    expect(g.request('b', 70_000)).toBe(true);
    g.finish('a');
    expect(g.due(70_000)).toEqual(['a']);
  });

  it('forçage (salon changé, tâche de sécurité) : ignore la fenêtre, pas un rafraîchissement en cours', () => {
    const g = new RefreshGate(60_000);
    expect(g.request('a', 0)).toBe(true);
    expect(g.force('a', 1_000)).toBe(false); // en cours : reste en attente
    g.finish('a');
    expect(g.due(59_999)).toEqual([]);
    expect(g.due(60_000)).toEqual(['a']);
    g.finish('a');
    expect(g.force('a', 61_000)).toBe(true); // fenêtre ignorée
    g.finish('a');
    expect(g.due(200_000)).toEqual([]);
  });
});
