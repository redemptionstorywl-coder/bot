/**
 * Gestion des cooldowns en mémoire : clé = `${scope}:${userId}`.
 */
export class CooldownManager {
  private readonly map = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly sweepIntervalMs = 60_000) {
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  /** Retourne le temps restant en ms (0 si aucun cooldown actif). */
  check(scope: string, userId: string): number {
    const key = `${scope}:${userId}`;
    const until = this.map.get(key);
    if (!until) return 0;
    const remaining = until - Date.now();
    if (remaining <= 0) {
      this.map.delete(key);
      return 0;
    }
    return remaining;
  }

  set(scope: string, userId: string, seconds: number): void {
    if (seconds <= 0) return;
    this.map.set(`${scope}:${userId}`, Date.now() + seconds * 1000);
  }

  /** Vérifie et applique : retourne le temps restant (0 = autorisé, cooldown posé). */
  consume(scope: string, userId: string, seconds: number): number {
    const remaining = this.check(scope, userId);
    if (remaining > 0) return remaining;
    this.set(scope, userId, seconds);
    return 0;
  }

  reset(scope: string, userId: string): void {
    this.map.delete(`${scope}:${userId}`);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.map) if (v <= now) this.map.delete(k);
  }

  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.map.clear();
  }
}
