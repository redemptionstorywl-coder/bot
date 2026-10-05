import { LogCategory, Prisma, type BattlePass, type BattleRoyaleProfile, type BattleRoyaleStats } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { loggingService } from './LoggingService';
import { childLogger } from '../utils/logger';
import type { NormalizedStats } from './fivem/schemas';

const log = childLogger('BattleRoyaleService');

// ───────────── Formules (fonctions pures, testées) ─────────────

/** XP → niveau : level = floor(sqrt(xp / 100)) + 1  (0 XP = niv. 1, 100 XP = niv. 2, 400 XP = niv. 3, 900 XP = niv. 4…) */
export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

/** XP total requis pour atteindre `level` : (level - 1)² × 100 */
export function xpForLevel(level: number): number {
  return Math.pow(Math.max(1, level) - 1, 2) * 100;
}

/** Progression dans le niveau courant (0..1) + valeurs brutes. */
export function levelProgress(xp: number): { level: number; current: number; needed: number; ratio: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const current = xp - base;
  const needed = next - base;
  return { level, current, needed, ratio: needed > 0 ? Math.min(1, current / needed) : 1 };
}

/** K/D = kills / max(1, deaths), arrondi à 2 décimales. */
export function computeKd(kills: number, deaths: number): number {
  return Math.round((kills / Math.max(1, deaths)) * 100) / 100;
}

/** Barre de progression textuelle (10 segments). */
export function progressBar(ratio: number, size = 10): string {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}`;
}

export type LeaderboardMetric = 'wins' | 'kills' | 'level' | 'kd';

export interface LeaderboardRow {
  userId: string;
  nickname: string | null;
  wins: number;
  kills: number;
  deaths: number;
  matches: number;
  level: number;
  xp: number;
  kd: number;
}

/** Tri d'un classement (fonction pure) : métrique desc, puis kills, puis wins, puis userId pour la stabilité. */
export function sortLeaderboard(rows: LeaderboardRow[], metric: LeaderboardMetric): LeaderboardRow[] {
  const value = (r: LeaderboardRow): number => (metric === 'level' ? r.xp : metric === 'kd' ? r.kd : r[metric]);
  return [...rows].sort((a, b) => value(b) - value(a) || b.kills - a.kills || b.wins - a.wins || a.userId.localeCompare(b.userId));
}

export const MEDALS = ['🥇', '🥈', '🥉'] as const;
export function rankLabel(index: number): string {
  return MEDALS[index] ?? `**#${index + 1}**`;
}

export const battlePassTierSchema = z.object({
  tier: z.number().int().min(1),
  xpRequired: z.number().int().min(0),
  freeReward: z.string().max(200).optional().nullable(),
  premiumReward: z.string().max(200).optional().nullable(),
});
export type BattlePassTier = z.infer<typeof battlePassTierSchema>;
export const battlePassTiersSchema = z.array(battlePassTierSchema).max(100);

export function parseTiers(raw: unknown): BattlePassTier[] {
  const r = battlePassTiersSchema.safeParse(raw);
  return r.success ? [...r.data].sort((a, b) => a.tier - b.tier) : [];
}

/** Tiers par défaut d'une nouvelle saison : 30 paliers, 1000 XP chacun. */
export function defaultTiers(count = 30, xpPerTier = 1000): BattlePassTier[] {
  return Array.from({ length: count }, (_, i) => ({ tier: i + 1, xpRequired: (i + 1) * xpPerTier, freeReward: null, premiumReward: null }));
}

export interface BattlePassProgress {
  tier: number;
  nextTier: BattlePassTier | null;
  xp: number;
  /** XP accumulé dans le palier en cours */
  current: number;
  /** XP nécessaire pour finir le palier en cours */
  needed: number;
  ratio: number;
  maxed: boolean;
}

/** Progression Battle Pass depuis battlePassXp (fonction pure). */
export function battlePassProgress(xp: number, tiers: BattlePassTier[]): BattlePassProgress {
  const sorted = [...tiers].sort((a, b) => a.tier - b.tier);
  let tier = 0;
  let reached = 0;
  for (const t of sorted) {
    if (xp >= t.xpRequired) {
      tier = t.tier;
      reached = t.xpRequired;
    } else break;
  }
  const nextTier = sorted.find((t) => t.tier > tier) ?? null;
  if (!nextTier) return { tier, nextTier: null, xp, current: xp - reached, needed: 0, ratio: 1, maxed: sorted.length > 0 };
  const needed = nextTier.xpRequired - reached;
  const current = xp - reached;
  return { tier, nextTier, xp, current, needed, ratio: needed > 0 ? Math.min(1, current / needed) : 1, maxed: false };
}

// ───────────── Service ─────────────

export const STAT_FIELDS = ['wins', 'kills', 'deaths', 'matches', 'damage', 'top10'] as const;
export type StatField = (typeof STAT_FIELDS)[number];
export const PROFILE_FIELDS = ['xp', 'playtimeMinutes', 'battlePassXp', 'battlePassTier', 'battlePassPremium'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type ProfileWithStats = BattleRoyaleProfile & { stats: BattleRoyaleStats[] };

export class BattleRoyaleError extends Error {
  constructor(readonly code: 'identifier_taken' | 'profile_not_found' | 'invalid_field' | 'season_exists' | 'no_season') {
    super(code);
    this.name = 'BattleRoyaleError';
  }
}

/** Écouteur appelé après chaque changement de stats / profils / saison d'un serveur (classement en direct). */
export type BattleRoyaleChangeListener = (guildId: string) => void;

/** Joueur trouvé par pseudo (autocomplete de /stat). */
export interface PlayerMatch {
  userId: string;
  name: string;
}

export class BattleRoyaleService {
  private readonly listeners: BattleRoyaleChangeListener[] = [];

  /** Enregistre un écouteur de changement (idempotent par référence). */
  onChange(listener: BattleRoyaleChangeListener): void {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  /** Signale un changement de stats / profils / saison (le message de classement se met à jour, avec anti-rafale). */
  notifyChange(guildId: string): void {
    for (const l of this.listeners) {
      try {
        l(guildId);
      } catch (err) {
        log.warn({ err, guildId }, 'Écouteur Battle Royale en erreur');
      }
    }
  }

  // ───── Profils ─────

  async ensureProfile(guildId: string, userId: string, nickname?: string | null): Promise<BattleRoyaleProfile> {
    return prisma.battleRoyaleProfile.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, nickname: nickname ?? null },
      update: nickname ? { nickname } : {},
    });
  }

  async getProfile(guildId: string, userId: string): Promise<ProfileWithStats | null> {
    return prisma.battleRoyaleProfile.findUnique({ where: { guildId_userId: { guildId, userId } }, include: { stats: { orderBy: { season: 'desc' } } } });
  }

  async findByIdentifier(guildId: string, identifier: string): Promise<BattleRoyaleProfile | null> {
    return prisma.battleRoyaleProfile.findFirst({ where: { guildId, identifier } });
  }

  async linkIdentifier(guildId: string, userId: string, identifier: string, nickname?: string | null): Promise<BattleRoyaleProfile> {
    const taken = await prisma.battleRoyaleProfile.findFirst({ where: { guildId, identifier, NOT: { userId } } });
    if (taken) throw new BattleRoyaleError('identifier_taken');
    const profile = await prisma.battleRoyaleProfile.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, identifier, nickname: nickname ?? null },
      update: { identifier, ...(nickname ? { nickname } : {}) },
    });
    this.notifyChange(guildId);
    return profile;
  }

  /**
   * Joueurs dont le pseudo contient `query` (profil BR : pseudo en jeu ; joueurs FiveM : pseudo du compte puis nom FiveM),
   * dédoublonnés par compte Discord. `query` vide : profils mis à jour récemment. Utilisé par l'autocomplete de /stat.
   */
  async searchPlayers(guildId: string, query: string, limit = 25): Promise<PlayerMatch[]> {
    const q = query.trim().slice(0, 64);
    const [profiles, players] = await Promise.all([
      prisma.battleRoyaleProfile.findMany({ where: { guildId, nickname: q ? { contains: q } : { not: null } }, orderBy: { updatedAt: 'desc' }, take: limit, select: { userId: true, nickname: true } }),
      q
        ? prisma.fiveMPlayer.findMany({ where: { guildId, discordId: { not: null }, OR: [{ gameName: { contains: q } }, { name: { contains: q } }] }, orderBy: { lastSeenAt: 'desc' }, take: limit, select: { discordId: true, gameName: true, name: true } })
        : Promise.resolve([] as { discordId: string | null; gameName: string | null; name: string }[]),
    ]);
    const out = new Map<string, PlayerMatch>();
    for (const p of profiles) if (p.nickname && !out.has(p.userId)) out.set(p.userId, { userId: p.userId, name: p.nickname });
    for (const p of players) {
      if (!p.discordId || out.has(p.discordId)) continue;
      const name = p.gameName ?? p.name;
      if (name && name !== '—') out.set(p.discordId, { userId: p.discordId, name });
    }
    return [...out.values()].slice(0, limit);
  }

  /** Rang d'un joueur au classement des victoires de la saison (1 = premier) et nombre de joueurs classés (≥ 1 partie). */
  async seasonRank(guildId: string, season: number, stats: Pick<BattleRoyaleStats, 'wins' | 'kills'>): Promise<{ rank: number; total: number }> {
    const where = { season, profile: { guildId }, matches: { gt: 0 } };
    const [ahead, total] = await Promise.all([
      prisma.battleRoyaleStats.count({ where: { ...where, OR: [{ wins: { gt: stats.wins } }, { wins: stats.wins, kills: { gt: stats.kills } }] } }),
      prisma.battleRoyaleStats.count({ where }),
    ]);
    return { rank: ahead + 1, total: Math.max(total, ahead + 1) };
  }

  async getStats(profileId: number, season: number): Promise<BattleRoyaleStats | null> {
    return prisma.battleRoyaleStats.findUnique({ where: { profileId_season: { profileId, season } } });
  }

  // ───── Saisons / Battle Pass ─────

  async getActiveBattlePass(guildId: string): Promise<BattlePass | null> {
    return prisma.battlePass.findFirst({ where: { guildId, active: true }, orderBy: { season: 'desc' } });
  }

  /** Saison courante : Battle Pass actif, sinon saison max connue dans les stats, sinon 1. */
  async getCurrentSeason(guildId: string): Promise<number> {
    const pass = await this.getActiveBattlePass(guildId);
    if (pass) return pass.season;
    const agg = await prisma.battleRoyaleStats.aggregate({ where: { profile: { guildId } }, _max: { season: true } });
    return agg._max.season ?? 1;
  }

  async listSeasons(guildId: string): Promise<BattlePass[]> {
    return prisma.battlePass.findMany({ where: { guildId }, orderBy: { season: 'desc' } });
  }

  /** Crée une nouvelle saison (Battle Pass) et désactive les précédentes. */
  async newSeason(guildId: string, input: { name: string; durationDays?: number; startsAt?: Date; endsAt?: Date; tiers?: BattlePassTier[]; actorId?: string }): Promise<BattlePass> {
    const agg = await prisma.battlePass.aggregate({ where: { guildId }, _max: { season: true } });
    const season = (agg._max.season ?? 0) + 1;
    const startsAt = input.startsAt ?? new Date();
    const endsAt = input.endsAt ?? new Date(startsAt.getTime() + Math.max(1, input.durationDays ?? 90) * 86400_000);
    const tiers = input.tiers?.length ? battlePassTiersSchema.parse(input.tiers) : defaultTiers();
    const pass = await prisma.$transaction(async (tx) => {
      await tx.battlePass.updateMany({ where: { guildId, active: true }, data: { active: false } });
      return tx.battlePass.create({ data: { guildId, season, name: input.name.slice(0, 100), startsAt, endsAt, tiers: tiers as Prisma.InputJsonValue, active: true } });
    });
    // Réinitialise la progression Battle Pass des profils pour la nouvelle saison
    await prisma.battleRoyaleProfile.updateMany({ where: { guildId }, data: { battlePassTier: 0, battlePassXp: 0 } });
    await loggingService.log({ guildId, category: LogCategory.BATTLE_ROYALE, action: 'br.season.new', title: `⚔️ Nouvelle saison ${season} — ${pass.name}`, actorId: input.actorId ?? null, data: { season, name: pass.name, endsAt } });
    this.notifyChange(guildId);
    return pass;
  }

  /** Active une saison existante (ou la crée vide) comme saison courante. */
  async setSeason(guildId: string, season: number, actorId?: string): Promise<BattlePass> {
    const existing = await prisma.battlePass.findUnique({ where: { guildId_season: { guildId, season } } });
    const pass = await prisma.$transaction(async (tx) => {
      await tx.battlePass.updateMany({ where: { guildId, active: true }, data: { active: false } });
      if (existing) return tx.battlePass.update({ where: { id: existing.id }, data: { active: true } });
      const startsAt = new Date();
      return tx.battlePass.create({ data: { guildId, season, name: `Season ${season}`, startsAt, endsAt: new Date(startsAt.getTime() + 90 * 86400_000), tiers: defaultTiers() as Prisma.InputJsonValue, active: true } });
    });
    await loggingService.log({ guildId, category: LogCategory.BATTLE_ROYALE, action: 'br.season.set', title: `⚔️ Saison active : ${season}`, actorId: actorId ?? null, data: { season } });
    this.notifyChange(guildId);
    return pass;
  }

  /** Remplace les paliers d'une saison et recalcule le palier atteint des profils si c'est la saison active. */
  async updateTiers(guildId: string, season: number, tiers: BattlePassTier[], actorId?: string): Promise<BattlePass> {
    const existing = await prisma.battlePass.findUnique({ where: { guildId_season: { guildId, season } } });
    if (!existing) throw new BattleRoyaleError('no_season');
    const parsed = battlePassTiersSchema.parse(tiers);
    const pass = await prisma.battlePass.update({ where: { id: existing.id }, data: { tiers: parsed as Prisma.InputJsonValue } });
    if (pass.active) {
      const profiles = await prisma.battleRoyaleProfile.findMany({ where: { guildId }, select: { id: true, battlePassXp: true, battlePassTier: true } });
      for (const p of profiles) {
        const tier = battlePassProgress(p.battlePassXp, parsed).tier;
        if (tier !== p.battlePassTier) await prisma.battleRoyaleProfile.update({ where: { id: p.id }, data: { battlePassTier: tier } });
      }
    }
    await loggingService.log({ guildId, category: LogCategory.BATTLE_ROYALE, action: 'br.season.tiers', title: `⚔️ Battle Pass — saison ${season} : ${parsed.length} paliers`, actorId: actorId ?? null, data: { season, tiers: parsed.length } });
    return pass;
  }

  getBattlePassProgress(profile: BattleRoyaleProfile, pass: BattlePass | null): BattlePassProgress {
    return battlePassProgress(profile.battlePassXp, pass ? parseTiers(pass.tiers) : []);
  }

  // ───── Stats ─────

  /**
   * Applique des stats envoyées par le serveur FiveM.
   * Profil résolu par `identifier` ; si inconnu → `{ applied: false, unlinked: true }` (le joueur doit faire /br-link).
   */
  async applyStats(guildId: string, stats: NormalizedStats): Promise<{ applied: boolean; unlinked?: boolean; profileId?: number; season?: number; level?: number }> {
    const profile = await this.findByIdentifier(guildId, stats.identifier);
    if (!profile) {
      log.info({ guildId, identifier: stats.identifier }, 'Stats reçues pour un identifiant non lié');
      return { applied: false, unlinked: true };
    }
    const season = stats.season ?? (await this.getCurrentSeason(guildId));
    const set = stats.mode === 'set';
    const statData = { wins: stats.wins, kills: stats.kills, deaths: stats.deaths, matches: stats.matches, damage: stats.damage, top10: stats.top10 };
    await prisma.battleRoyaleStats.upsert({
      where: { profileId_season: { profileId: profile.id, season } },
      create: { profileId: profile.id, season, ...statData },
      update: set ? statData : Object.fromEntries(Object.entries(statData).map(([k, v]) => [k, { increment: v }])),
    });
    const xp = set ? stats.xp : profile.xp + stats.xp;
    const playtimeMinutes = set ? stats.playtimeMinutes : profile.playtimeMinutes + stats.playtimeMinutes;
    const battlePassXp = set ? stats.xp : profile.battlePassXp + stats.xp;
    const pass = await this.getActiveBattlePass(guildId);
    const bp = battlePassProgress(battlePassXp, pass ? parseTiers(pass.tiers) : []);
    const level = levelFromXp(xp);
    await prisma.battleRoyaleProfile.update({ where: { id: profile.id }, data: { xp, level, playtimeMinutes, battlePassXp, battlePassTier: bp.tier } });
    this.notifyChange(guildId);
    return { applied: true, profileId: profile.id, season, level };
  }

  async adminSetStat(guildId: string, userId: string, field: StatField | ProfileField, value: number | boolean, season: number | undefined, actorId: string): Promise<void> {
    const profile = await this.ensureProfile(guildId, userId);
    if ((STAT_FIELDS as readonly string[]).includes(field)) {
      const s = season ?? (await this.getCurrentSeason(guildId));
      const v = Math.max(0, Math.floor(Number(value)));
      await prisma.battleRoyaleStats.upsert({ where: { profileId_season: { profileId: profile.id, season: s } }, create: { profileId: profile.id, season: s, [field]: v }, update: { [field]: v } });
    } else if ((PROFILE_FIELDS as readonly string[]).includes(field)) {
      const data: Prisma.BattleRoyaleProfileUpdateInput = {};
      if (field === 'battlePassPremium') data.battlePassPremium = Boolean(value);
      else {
        const v = Math.max(0, Math.floor(Number(value)));
        (data as Record<string, unknown>)[field] = v;
        if (field === 'xp') data.level = levelFromXp(v);
      }
      await prisma.battleRoyaleProfile.update({ where: { id: profile.id }, data });
    } else throw new BattleRoyaleError('invalid_field');
    await loggingService.log({ guildId, category: LogCategory.BATTLE_ROYALE, action: 'br.admin.set', title: `⚔️ Stat modifiée : ${field} = ${String(value)}`, description: `<@${userId}>`, actorId, targetId: userId, data: { field, value, season } });
    this.notifyChange(guildId);
  }

  async addXp(guildId: string, userId: string, amount: number, actorId?: string): Promise<BattleRoyaleProfile> {
    const profile = await this.ensureProfile(guildId, userId);
    const xp = Math.max(0, profile.xp + amount);
    const battlePassXp = Math.max(0, profile.battlePassXp + amount);
    const pass = await this.getActiveBattlePass(guildId);
    const bp = battlePassProgress(battlePassXp, pass ? parseTiers(pass.tiers) : []);
    const updated = await prisma.battleRoyaleProfile.update({ where: { id: profile.id }, data: { xp, level: levelFromXp(xp), battlePassXp, battlePassTier: bp.tier } });
    if (actorId) await loggingService.log({ guildId, category: LogCategory.BATTLE_ROYALE, action: 'br.admin.xp', title: `⚔️ XP ${amount >= 0 ? '+' : ''}${amount}`, description: `<@${userId}> → ${xp} XP (niv. ${updated.level})`, actorId, targetId: userId, data: { amount, xp } });
    this.notifyChange(guildId);
    return updated;
  }

  // ───── Classements ─────

  async leaderboard(guildId: string, metric: LeaderboardMetric, season: number, limit = 100): Promise<LeaderboardRow[]> {
    if (metric === 'level') {
      const profiles = await prisma.battleRoyaleProfile.findMany({ where: { guildId }, orderBy: [{ xp: 'desc' }], take: limit, include: { stats: { where: { season } } } });
      return sortLeaderboard(
        profiles.map((p) => {
          const s = p.stats[0];
          return { userId: p.userId, nickname: p.nickname, wins: s?.wins ?? 0, kills: s?.kills ?? 0, deaths: s?.deaths ?? 0, matches: s?.matches ?? 0, level: p.level, xp: p.xp, kd: computeKd(s?.kills ?? 0, s?.deaths ?? 0) };
        }),
        metric,
      );
    }
    const orderBy: Prisma.BattleRoyaleStatsOrderByWithRelationInput[] = metric === 'kd' ? [{ kills: 'desc' }] : [{ [metric]: 'desc' }, { kills: 'desc' }];
    const stats = await prisma.battleRoyaleStats.findMany({ where: { season, profile: { guildId } }, orderBy, take: metric === 'kd' ? Math.max(limit, 500) : limit, include: { profile: true } });
    const rows = stats.map((s) => ({ userId: s.profile.userId, nickname: s.profile.nickname, wins: s.wins, kills: s.kills, deaths: s.deaths, matches: s.matches, level: s.profile.level, xp: s.profile.xp, kd: computeKd(s.kills, s.deaths) }));
    return sortLeaderboard(rows, metric).slice(0, limit);
  }
}

export const battleRoyaleService = new BattleRoyaleService();
