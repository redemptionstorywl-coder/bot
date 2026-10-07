import { LogCategory, type FiveMServer } from '@prisma/client';
import { prisma } from '../database/client';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { translationService } from './TranslationService';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { collectLicenses, renderGameLog } from './fivem/gameLogs';
import type { GameLogEntry } from './fivem/schemas';

const log = childLogger('GameLogs');

/** Limite par serveur de jeu : 600 entrées / minute (au-delà : 429, rs_bridge garde ses entrées et réessaie). */
export const GAME_LOG_RATE = { windowMs: 60_000, max: 600 } as const;

/** Compteur à fenêtre fixe (fonction pure sur l'état fourni). */
export function consumeRate(state: { count: number; resetAt: number } | undefined, n: number, now: number, limit: { windowMs: number; max: number } = GAME_LOG_RATE): { state: { count: number; resetAt: number }; allowed: boolean; retryAfterSec: number } {
  const s = !state || state.resetAt <= now ? { count: 0, resetAt: now + limit.windowMs } : { ...state };
  if (s.count + n > limit.max) return { state: s, allowed: false, retryAfterSec: Math.max(1, Math.ceil((s.resetAt - now) / 1000)) };
  s.count += n;
  return { state: s, allowed: true, retryAfterSec: 0 };
}

export class GameLogRateError extends Error {
  constructor(readonly retryAfterSec: number) {
    super('rate_limited');
    this.name = 'GameLogRateError';
  }
}

/**
 * Logs en jeu : lot reçu de rs_bridge (POST /servers/:guildId/:serverKey/logs) ou entrée générée par le bot (sanction jeu,
 * pseudo, statut du serveur). Chaque entrée devient un log GAME du serveur Discord du jeu (dashboard, salon local « Jeu »)
 * et part dans la section du serveur de jeu du hub de logs (routes game.*).
 */
export class GameLogService {
  private readonly rates = new Map<number, { count: number; resetAt: number }>();
  private readonly players = new TTLCache<{ discordId: string | null; name: string | null }>(5 * 60_000, 20_000);

  /** Vérifie et consomme le quota du serveur (lance GameLogRateError si dépassé). */
  takeQuota(serverId: number, n: number, now = Date.now()): void {
    const r = consumeRate(this.rates.get(serverId), n, now);
    this.rates.set(serverId, r.state);
    if (this.rates.size > 1000) for (const [k, v] of this.rates) if (v.resetAt <= now) this.rates.delete(k);
    if (!r.allowed) throw new GameLogRateError(r.retryAfterSec);
  }

  /** Licence → ID Discord et pseudo connus des joueurs du lot (FiveMPlayer), en cache 5 min. */
  private async knownPlayers(guildId: string, licenses: string[]): Promise<{ discordByLicense: Map<string, string>; nameByLicense: Map<string, string> }> {
    const discordByLicense = new Map<string, string>();
    const nameByLicense = new Map<string, string>();
    const missing: string[] = [];
    const remember = (license: string, p: { discordId: string | null; name: string | null }) => {
      if (p.discordId) discordByLicense.set(license, p.discordId);
      if (p.name) nameByLicense.set(license, p.name);
    };
    for (const l of licenses) {
      const cached = this.players.get(`${guildId}:${l}`);
      if (cached === undefined) missing.push(l);
      else remember(l, cached);
    }
    if (missing.length) {
      const rows = (await prisma.fiveMPlayer.findMany({ where: { guildId, license: { in: missing } }, select: { license: true, discordId: true, name: true, gameName: true } }).catch(() => [])) ?? [];
      for (const l of missing) {
        const row = rows.find((r) => r.license === l);
        const p = { discordId: row?.discordId ?? null, name: row?.gameName ?? row?.name ?? null };
        this.players.set(`${guildId}:${l}`, p);
        remember(l, p);
      }
    }
    return { discordByLicense, nameByLicense };
  }

  /** Enregistre un lot d'entrées (validées par gameLogBatchSchema). */
  async ingest(server: Pick<FiveMServer, 'id' | 'guildId' | 'key' | 'name'>, entries: GameLogEntry[]): Promise<number> {
    if (!entries.length) return 0;
    const cfg = await guildConfigService.get(server.guildId);
    const lang = translationService.resolveLanguage(cfg?.defaultLanguage);
    const t = translationService.bind(lang, server.guildId);
    const known = await this.knownPlayers(server.guildId, collectLicenses(entries));
    let accepted = 0;
    for (const entry of entries) {
      try {
        const r = renderGameLog(entry, { t, lang, ...known });
        await loggingService.log({
          guildId: server.guildId,
          category: LogCategory.GAME,
          action: r.action,
          title: r.title,
          description: r.description,
          fields: r.fields,
          color: r.color,
          actorId: r.actorId,
          targetId: r.targetId,
          skipDatabase: r.skipDatabase,
          timestamp: entry.ts ? new Date(entry.ts * 1000) : undefined,
          data: { ...r.data, serverKey: server.key },
          game: { serverId: server.id, serverName: server.name, route: r.route },
        });
        accepted++;
      } catch (err) {
        log.warn({ err, server: server.key, type: entry.type }, 'Log en jeu ignoré');
      }
    }
    return accepted;
  }

  /** Entrée générée par le bot (sanction prise en jeu, pseudo, statut du serveur). Ne lance jamais. */
  async record(server: Pick<FiveMServer, 'id' | 'guildId' | 'key' | 'name'>, entry: GameLogEntry): Promise<void> {
    await this.ingest(server, [entry]).catch((err) => log.warn({ err, server: server.key, type: entry.type }, 'Log en jeu non enregistré'));
  }
}

export const gameLogService = new GameLogService();
