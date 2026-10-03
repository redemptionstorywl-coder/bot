import { prisma } from '../database/client';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';

const log = childLogger('ActivityService');

interface PendingEntry {
  guildId: string;
  userId: string;
  count: number;
  lastAt: Date;
}

/**
 * Compteur de messages par utilisateur / serveur.
 *  - `increment()` est appelé à chaque message : purement en mémoire (aucune requête SQL).
 *  - `flush()` est appelé par le scheduler (tâche `activity:flush`, 60 s) : upsert incrémental en base.
 *  - `getCount()` = total en base (mis en cache quelques secondes) + total encore en mémoire.
 */
export class ActivityService {
  private pending = new Map<string, PendingEntry>();
  private readonly dbCache = new TTLCache<number>(30_000, 20_000);
  private flushing = false;

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  /** Enregistre un message (mémoire uniquement). */
  increment(guildId: string, userId: string, at: Date = new Date()): void {
    const key = this.key(guildId, userId);
    const entry = this.pending.get(key);
    if (entry) {
      entry.count += 1;
      entry.lastAt = at;
    } else {
      this.pending.set(key, { guildId, userId, count: 1, lastAt: at });
    }
  }

  /** Nombre de messages pas encore écrits en base. */
  getPending(guildId: string, userId: string): number {
    return this.pending.get(this.key(guildId, userId))?.count ?? 0;
  }

  /** Nombre d'entrées en attente de flush (monitoring / tests). */
  get pendingSize(): number {
    return this.pending.size;
  }

  /** Total de messages connus (base + mémoire). */
  async getCount(guildId: string, userId: string): Promise<number> {
    const key = this.key(guildId, userId);
    const stored = await this.dbCache.getOrSet(key, async () => {
      const row = await prisma.messageActivity.findUnique({ where: { guildId_userId: { guildId, userId } } });
      return row?.count ?? 0;
    });
    return stored + this.getPending(guildId, userId);
  }

  /**
   * Écrit les compteurs en attente en base (upsert incrémental).
   * Les incréments reçus pendant le flush sont conservés pour le flush suivant.
   * En cas d'erreur, les compteurs sont réinjectés dans le buffer.
   */
  async flush(): Promise<number> {
    if (this.flushing || this.pending.size === 0) return 0;
    this.flushing = true;
    const batch = this.pending;
    this.pending = new Map();
    try {
      const entries = [...batch.values()];
      const chunkSize = 50;
      for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        await prisma.$transaction(
          chunk.map((e) =>
            prisma.messageActivity.upsert({
              where: { guildId_userId: { guildId: e.guildId, userId: e.userId } },
              create: { guildId: e.guildId, userId: e.userId, count: e.count, lastAt: e.lastAt },
              update: { count: { increment: e.count }, lastAt: e.lastAt },
            }),
          ),
        );
        for (const e of chunk) this.dbCache.delete(this.key(e.guildId, e.userId));
      }
      log.debug({ entries: entries.length }, 'Activité écrite en base');
      return entries.length;
    } catch (err) {
      // Réinjecte les compteurs non écrits pour ne rien perdre.
      for (const [key, e] of batch) {
        const current = this.pending.get(key);
        if (current) {
          current.count += e.count;
          if (e.lastAt > current.lastAt) current.lastAt = e.lastAt;
        } else this.pending.set(key, e);
      }
      log.error({ err }, 'Flush de l’activité en erreur');
      throw err;
    } finally {
      this.flushing = false;
    }
  }

  /** Classement des membres les plus actifs (dashboard / stats). */
  async top(guildId: string, limit = 10): Promise<{ userId: string; count: number; lastAt: Date }[]> {
    const rows = await prisma.messageActivity.findMany({ where: { guildId }, orderBy: { count: 'desc' }, take: limit });
    return rows.map((r) => ({ userId: r.userId, count: r.count, lastAt: r.lastAt }));
  }

  /** Vide le buffer mémoire (tests). */
  reset(): void {
    this.pending.clear();
    this.dbCache.clear();
  }
}

export const activityService = new ActivityService();
