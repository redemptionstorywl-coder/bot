/** Petit cache TTL en mémoire, typé. */
export class TTLCache<V> {
  private readonly store = new Map<string, { value: V; expires: number }>();

  constructor(private readonly ttlMs: number, private readonly maxSize = 5000) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (this.store.size >= this.maxSize) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Supprime toutes les clés commençant par `prefix`. */
  invalidatePrefix(prefix: string): void {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }

  clear(): void {
    this.store.clear();
  }

  async getOrSet(key: string, loader: () => Promise<V>, ttlMs = this.ttlMs): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  get size(): number {
    return this.store.size;
  }
}
