import { EmbedBuilder, escapeMarkdown, type ColorResolvable } from 'discord.js';
import { BRAND } from '../../config/constants';
import type { Translator } from '../TranslationService';
import { computeKd, rankLabel, type LeaderboardRow } from '../BattleRoyaleService';

/**
 * Message de classement en direct (un seul message par serveur, édité quand les stats changent) : fonctions pures
 * (données → embed, anti-rafale), testées dans tests/battleroyale/leaderboard.test.ts. Le service LeaderboardService orchestre.
 */

export const LEADERBOARD_SIZES = [10, 15] as const;
export type LeaderboardSize = (typeof LEADERBOARD_SIZES)[number];
export const DEFAULT_LEADERBOARD_SIZE: LeaderboardSize = 10;
/** Parties minimum pour figurer au classement K/D (évite qu'un joueur à 1 partie le domine). */
export const KD_MIN_MATCHES = 5;
/** Une édition au plus par minute et par serveur (limites Discord, rafales de stats en fin de partie). */
export const LEADERBOARD_MIN_INTERVAL_MS = 60_000;
const NAME_MAX = 24;

export function isLeaderboardSize(n: unknown): n is LeaderboardSize {
  return (LEADERBOARD_SIZES as readonly unknown[]).includes(n);
}

export interface BoardEntry {
  userId: string;
  name: string;
  /** Valeur affichée (déjà formatée) */
  value: string;
}

export interface Boards {
  wins: BoardEntry[];
  kills: BoardEntry[];
  kd: BoardEntry[];
}

/**
 * Construit les trois classements (victoires, kills, K/D) à partir des lignes de la saison.
 * `names` : userId → pseudo à afficher (pseudo en jeu en priorité) ; à défaut, mention Discord.
 * Les joueurs à 0 (victoire / kill) sont omis ; K/D : au moins `KD_MIN_MATCHES` parties et 1 kill.
 */
export function buildBoards(rows: readonly LeaderboardRow[], size: number, names: ReadonlyMap<string, string> = new Map()): Boards {
  const label = (r: LeaderboardRow): string => {
    const raw = names.get(r.userId) ?? r.nickname;
    if (!raw) return `<@${r.userId}>`;
    const chars = Array.from(raw);
    return `**${escapeMarkdown(chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : raw)}**`;
  };
  const unique = new Map<string, LeaderboardRow>();
  for (const r of rows) if (!unique.has(r.userId)) unique.set(r.userId, r);
  const all = [...unique.values()];
  const tie = (a: LeaderboardRow, b: LeaderboardRow) => b.kills - a.kills || b.wins - a.wins || a.userId.localeCompare(b.userId);
  const wins = all.filter((r) => r.wins > 0).sort((a, b) => b.wins - a.wins || tie(a, b));
  const kills = all.filter((r) => r.kills > 0).sort((a, b) => b.kills - a.kills || b.wins - a.wins || a.userId.localeCompare(b.userId));
  const kd = all
    .filter((r) => r.matches >= KD_MIN_MATCHES && r.kills > 0)
    .map((r) => ({ ...r, kd: computeKd(r.kills, r.deaths) }))
    .sort((a, b) => b.kd - a.kd || tie(a, b));
  return {
    wins: wins.slice(0, size).map((r) => ({ userId: r.userId, name: label(r), value: String(r.wins) })),
    kills: kills.slice(0, size).map((r) => ({ userId: r.userId, name: label(r), value: String(r.kills) })),
    kd: kd.slice(0, size).map((r) => ({ userId: r.userId, name: label(r), value: `${r.kd.toFixed(2)} · ${r.kills}/${r.deaths}` })),
  };
}

/** Lignes d'un classement : 🥇🥈🥉 puis `#4`… (≤ 1024 caractères, champ d'embed). */
export function boardLines(entries: readonly BoardEntry[], unit: string, empty: string): string {
  if (!entries.length) return empty;
  const lines: string[] = [];
  let length = 0;
  for (const [i, e] of entries.entries()) {
    const line = `${rankLabel(i)} ${e.name} — \`${e.value}\`${unit ? ` ${unit}` : ''}`;
    if (length + line.length + 1 > 1024) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n');
}

export interface LeaderboardView {
  guildName: string;
  season: number;
  seasonName: string | null;
  seasonEndsAt: Date | null;
  size: number;
  boards: Boards;
  /** Joueurs classés (≥ 1 partie) */
  players: number;
  updatedAt: Date;
  color?: number;
}

/** Embed du message de classement (clair, médailles, saison, mis à jour il y a…). */
export function renderLeaderboardEmbed(view: LeaderboardView, t: Translator): EmbedBuilder {
  const ts = Math.floor(view.updatedAt.getTime() / 1000);
  const season = view.seasonName ? t('battleroyale.live.season_named', { season: view.season, name: view.seasonName }) : t('battleroyale.live.season', { season: view.season });
  const lines = [season, t('battleroyale.live.updated', { time: `<t:${ts}:R>` })];
  if (view.seasonEndsAt && view.seasonEndsAt.getTime() > view.updatedAt.getTime()) lines.push(t('battleroyale.live.ends', { time: `<t:${Math.floor(view.seasonEndsAt.getTime() / 1000)}:R>` }));
  const empty = t('battleroyale.live.empty');
  return new EmbedBuilder()
    .setColor((view.color ?? BRAND.colors.primary) as ColorResolvable)
    .setTitle(t('battleroyale.live.title', { server: view.guildName }))
    .setDescription(lines.join('\n'))
    .addFields(
      { name: t('battleroyale.live.top_wins', { count: view.size }), value: boardLines(view.boards.wins, '🏆', empty) },
      { name: t('battleroyale.live.top_kills', { count: view.size }), value: boardLines(view.boards.kills, '🔫', empty) },
      { name: t('battleroyale.live.top_kd', { count: view.size, min: KD_MIN_MATCHES }), value: boardLines(view.boards.kd, '', empty) },
    )
    .setFooter({ text: t('battleroyale.live.footer', { players: view.players, brand: BRAND.footer }) })
    .setTimestamp(view.updatedAt);
}

/**
 * Anti-rafale des éditions du message (par serveur) : la première demande passe tout de suite, les suivantes sont
 * regroupées et appliquées au plus une fois par `intervalMs` (la tâche planifiée appelle `due()`). `now` injectable (tests).
 */
export class RefreshGate {
  private readonly state = new Map<string, { lastAt: number; dirty: boolean; running: boolean }>();
  constructor(private readonly intervalMs = LEADERBOARD_MIN_INTERVAL_MS) {}

  private entry(key: string) {
    let s = this.state.get(key);
    if (!s) this.state.set(key, (s = { lastAt: -Infinity, dirty: false, running: false }));
    return s;
  }

  /** Signale un changement ; vrai s'il faut rafraîchir maintenant (l'appelant doit ensuite appeler `finish`). */
  request(key: string, now = Date.now()): boolean {
    const s = this.entry(key);
    s.dirty = true;
    return this.tryStart(s, now);
  }

  private tryStart(s: { lastAt: number; dirty: boolean; running: boolean }, now: number): boolean {
    if (s.running || !s.dirty || now - s.lastAt < this.intervalMs) return false;
    s.running = true;
    s.dirty = false;
    s.lastAt = now;
    return true;
  }

  /** Rafraîchissement forcé (tâche de sécurité, changement de salon) : ignore la fenêtre mais pas un rafraîchissement en cours. */
  force(key: string, now = Date.now()): boolean {
    const s = this.entry(key);
    if (s.running) {
      s.dirty = true;
      return false;
    }
    s.running = true;
    s.dirty = false;
    s.lastAt = now;
    return true;
  }

  finish(key: string): void {
    const s = this.state.get(key);
    if (s) s.running = false;
  }

  /** Clés à rafraîchir maintenant (changements regroupés dont la fenêtre est écoulée) ; elles passent « en cours ». */
  due(now = Date.now()): string[] {
    const out: string[] = [];
    for (const [key, s] of this.state) if (this.tryStart(s, now)) out.push(key);
    return out;
  }

  forget(key: string): void {
    this.state.delete(key);
  }
}
