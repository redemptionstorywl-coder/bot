import crypto from 'node:crypto';
import { prisma } from '../database/client';
import { env } from '../config/env';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import type { EmbedSpec } from './EmbedService';
import { guildConfigService } from './GuildConfigService';
import { scheduler } from './SchedulerService';
import { applyEmbedTexts, collectEmbedTexts, composeContent, composeEmbeds, DEFAULT_AUTO_TRANSLATE, DISCORD_LIMITS, isTranslateLayout, type AutoTranslateConfig, type TranslateLayout } from './autotranslate/bilingual';
import { buildProviderChain, describeProvider, PROVIDER_TIMEOUT_MS, type FetchLike, type ProviderDescription, type ProviderResult, type TranslationProvider } from './autotranslate/providers';
import { detectLanguage, hasTranslatableText, protectText, restoreText } from './autotranslate/text';

const log = childLogger('AutoTranslateService');

/** Messages pouvant porter un choix « Version anglaise » propre. */
export const TRANSLATE_SCOPES = ['announcement', 'welcome', 'ticket_panel'] as const;
export type TranslateScope = (typeof TRANSLATE_SCOPES)[number];

/** Durée maximale d'une traduction de message : au-delà, le message part en français seul. */
export const TRANSLATE_TIMEOUT_MS = 15_000;
const MEMORY_TTL_MS = 24 * 60 * 60_000;
const CACHE_RETENTION_DAYS = 365;
const TARGET = 'en';

/** Tous les fournisseurs ont échoué. */
export class TranslationUnavailableError extends Error {
  constructor(readonly attempts: { provider: string; error: string }[]) {
    super(`translation_unavailable: ${attempts.map((a) => `${a.provider} (${a.error})`).join(' | ') || 'no provider'}`);
    this.name = 'TranslationUnavailableError';
  }
}

export interface MessageParts {
  /** Texte du message (sans la ligne de mentions) */
  content?: string | null;
  embeds?: EmbedSpec[];
}

export interface LocalizeOptions {
  scope?: TranslateScope;
  targetId?: string;
  /** Choix explicite (formulaire, builder) : prioritaire sur l'override enregistré et le réglage du serveur */
  enabled?: boolean | null;
  /** Mise en page forcée (aperçu) ; défaut : réglage du serveur */
  layout?: TranslateLayout;
  /** Longueur maximale du texte composé (défaut 2000 ; moins si une ligne de mentions précède) */
  contentMax?: number;
}

export interface LocalizedMessage {
  content?: string;
  embeds: EmbedSpec[];
  /** Une version anglaise a été ajoutée */
  translated: boolean;
  /** La traduction était demandée mais a échoué (message envoyé en français seul) */
  failed: boolean;
  layout: TranslateLayout;
}

export interface AutoTranslateOptions {
  fetch?: FetchLike;
  providers?: TranslationProvider[];
  /** Cache base de données (désactivable pour les tests) */
  dbCache?: boolean;
  timeoutMs?: number;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readProviderEnv(): { DEEPL_API_KEY: string; GOOGLE_TRANSLATE_API_KEY: string; MYMEMORY_EMAIL: string } {
  try {
    const e = env();
    return { DEEPL_API_KEY: e.DEEPL_API_KEY, GOOGLE_TRANSLATE_API_KEY: e.GOOGLE_TRANSLATE_API_KEY, MYMEMORY_EMAIL: e.MYMEMORY_EMAIL };
  } catch {
    return { DEEPL_API_KEY: process.env.DEEPL_API_KEY ?? '', GOOGLE_TRANSLATE_API_KEY: process.env.GOOGLE_TRANSLATE_API_KEY ?? '', MYMEMORY_EMAIL: process.env.MYMEMORY_EMAIL ?? '' };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Traduction automatique FR → EN des messages publiés par le bot (annonces, embeds, bienvenue, panneaux de tickets).
 *  - réglage serveur (activé + mise en page) + choix propre à chaque message (overrides) ;
 *  - textes protégés (variables, mentions, emojis, URLs, code, Markdown) puis restaurés ;
 *  - cache mémoire (24 h) + base (`TranslationCache`, clé SHA-256 + langue cible) : renvois et éditions gratuits ;
 *  - délai maximal et repli : en cas d'échec, le message part en français seul (avertissement dans les logs).
 */
export class AutoTranslateService {
  private readonly memory = new TTLCache<string>(MEMORY_TTL_MS, 5000);
  private readonly overrides = new TTLCache<boolean | null>(10 * 60_000, 5000);
  private readonly inflight = new Map<string, Promise<(string | null)[]>>();
  private readonly fetchImpl: FetchLike;
  private readonly dbCache: boolean;
  private readonly timeoutMs: number;
  private customProviders: TranslationProvider[] | null;
  private builtProviders: TranslationProvider[] | null = null;
  private schedulerRegistered = false;

  constructor(opts: AutoTranslateOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.dbCache = opts.dbCache ?? true;
    this.timeoutMs = opts.timeoutMs ?? TRANSLATE_TIMEOUT_MS;
    this.customProviders = opts.providers ?? null;
  }

  /** Tâche de purge du cache base (appelée au démarrage du bot). */
  attach(): void {
    if (this.schedulerRegistered) return;
    this.schedulerRegistered = true;
    scheduler.register({
      name: 'translation:cache-prune',
      intervalMs: 24 * 60 * 60_000,
      run: async () => {
        const removed = await this.pruneCache();
        if (removed) log.info({ removed }, 'Cache de traduction purgé');
      },
    });
  }

  async pruneCache(now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - CACHE_RETENTION_DAYS * 24 * 60 * 60_000);
    const r = await prisma.translationCache.deleteMany({ where: { createdAt: { lt: before } } });
    return r.count;
  }

  // ───── Fournisseurs ─────

  /** Remplace la chaîne de fournisseurs (tests). `null` = chaîne déduite des variables d'environnement. */
  setProviders(providers: TranslationProvider[] | null): void {
    this.customProviders = providers;
    this.builtProviders = null;
  }

  get providers(): TranslationProvider[] {
    if (this.customProviders) return this.customProviders;
    if (!this.builtProviders) this.builtProviders = buildProviderChain(readProviderEnv(), this.fetchImpl, Math.min(PROVIDER_TIMEOUT_MS, this.timeoutMs));
    return this.builtProviders;
  }

  describeProvider(): ProviderDescription {
    return describeProvider(readProviderEnv());
  }

  /** Vide les caches mémoire (tests). */
  clearMemory(): void {
    this.memory.clear();
    this.overrides.clear();
  }

  // ───── Réglages ─────

  async getSettings(guildId: string): Promise<AutoTranslateConfig> {
    const cfg = await guildConfigService.get(guildId);
    return cfg?.autoTranslate ?? { ...DEFAULT_AUTO_TRANSLATE };
  }

  async updateSettings(guildId: string, patch: Partial<AutoTranslateConfig>): Promise<AutoTranslateConfig> {
    const current = await this.getSettings(guildId);
    const next: AutoTranslateConfig = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      layout: isTranslateLayout(patch.layout) ? patch.layout : current.layout,
    };
    await prisma.autoTranslateSettings.upsert({ where: { guildId }, create: { guildId, ...next }, update: next });
    guildConfigService.invalidate(guildId);
    return next;
  }

  // ───── Choix propre à un message ─────

  private overrideKey(guildId: string, scope: TranslateScope, targetId: string): string {
    return `${guildId}:${scope}:${targetId}`;
  }

  /** Choix enregistré pour un message (`null` = suit le réglage du serveur). */
  async getOverride(guildId: string, scope: TranslateScope, targetId: string): Promise<boolean | null> {
    const key = this.overrideKey(guildId, scope, targetId);
    const cached = this.overrides.get(key);
    if (cached !== undefined) return cached;
    let value: boolean | null = null;
    try {
      const row = await prisma.autoTranslateOverride.findUnique({ where: { guildId_scope_targetId: { guildId, scope, targetId } } });
      value = row ? row.enabled : null;
    } catch (err) {
      log.debug({ err, guildId, scope }, 'Lecture du choix « Version anglaise » impossible');
    }
    this.overrides.set(key, value);
    return value;
  }

  /** Enregistre (ou retire avec `null`) le choix « Version anglaise » d'un message. */
  async setOverride(guildId: string, scope: TranslateScope, targetId: string, enabled: boolean | null): Promise<void> {
    if (enabled === null) await prisma.autoTranslateOverride.deleteMany({ where: { guildId, scope, targetId } });
    else await prisma.autoTranslateOverride.upsert({ where: { guildId_scope_targetId: { guildId, scope, targetId } }, create: { guildId, scope, targetId, enabled }, update: { enabled } });
    this.overrides.set(this.overrideKey(guildId, scope, targetId), enabled);
  }

  /**
   * Enregistre le choix « Version anglaise » fait dans un formulaire / builder : identique au réglage du serveur → retiré
   * (le message suit alors le serveur), différent → enregistré. `undefined` = aucun changement.
   */
  async setChoice(guildId: string, scope: TranslateScope, targetId: string, enabled: boolean | null | undefined): Promise<void> {
    if (enabled === undefined) return;
    if (enabled === null) return this.setOverride(guildId, scope, targetId, null);
    const settings = await this.getSettings(guildId);
    await this.setOverride(guildId, scope, targetId, enabled === settings.enabled ? null : enabled);
  }

  /** Version anglaise effective : choix explicite → choix enregistré → réglage du serveur. */
  async resolve(guildId: string, opts: Pick<LocalizeOptions, 'scope' | 'targetId' | 'enabled'> = {}): Promise<{ enabled: boolean; layout: TranslateLayout }> {
    const settings = await this.getSettings(guildId);
    if (typeof opts.enabled === 'boolean') return { enabled: opts.enabled, layout: settings.layout };
    if (opts.scope && opts.targetId) {
      const override = await this.getOverride(guildId, opts.scope, opts.targetId);
      if (override !== null) return { enabled: override, layout: settings.layout };
    }
    return settings;
  }

  // ───── Traduction ─────

  private async readDb(hashes: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.dbCache || !hashes.length) return out;
    try {
      const rows = await prisma.translationCache.findMany({ where: { targetLang: TARGET, hash: { in: hashes } }, select: { hash: true, translatedText: true } });
      for (const r of rows ?? []) out.set(r.hash, r.translatedText);
    } catch (err) {
      log.debug({ err }, 'Lecture du cache de traduction impossible');
    }
    return out;
  }

  private async writeDb(rows: { hash: string; translatedText: string; provider: string; sourceLang: string | null }[]): Promise<void> {
    if (!this.dbCache || !rows.length) return;
    try {
      await prisma.translationCache.createMany({ data: rows.map((r) => ({ ...r, targetLang: TARGET })), skipDuplicates: true });
    } catch (err) {
      log.debug({ err }, 'Écriture du cache de traduction impossible');
    }
  }

  /** Interroge les fournisseurs dans l'ordre ; le premier qui répond l'emporte. */
  private async callProviders(texts: string[], source: 'fr' | undefined): Promise<{ results: ProviderResult[]; provider: string }> {
    const attempts: { provider: string; error: string }[] = [];
    for (const provider of this.providers) {
      try {
        const results = await provider.translate(texts, { source, target: TARGET });
        if (results.length === texts.length) return { results, provider: provider.name };
        attempts.push({ provider: provider.name, error: 'invalid response length' });
      } catch (err) {
        const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err);
        attempts.push({ provider: provider.name, error: message });
        log.warn({ provider: provider.name, err: message }, 'Fournisseur de traduction en échec');
      }
    }
    throw new TranslationUnavailableError(attempts);
  }

  /**
   * Traduit des textes en anglais. Résultat aligné : la traduction, ou `null` si inchangé
   * (texte vide, déjà en anglais, rien de traduisible). Lance `TranslationUnavailableError` si tous les fournisseurs échouent.
   */
  async translateTexts(texts: string[]): Promise<(string | null)[]> {
    const key = sha256(texts.join('\u0000'));
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.translateTextsUncached(texts).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async translateTextsUncached(texts: string[]): Promise<(string | null)[]> {
    const resolved = new Map<string, string>();
    const unique = [...new Set(texts.filter((t) => t && t.trim()))];
    const hashes = new Map(unique.map((t) => [t, sha256(t)]));
    const misses: string[] = [];
    for (const text of unique) {
      const hit = this.memory.get(hashes.get(text)!);
      if (hit !== undefined) resolved.set(text, hit);
      else misses.push(text);
    }
    if (misses.length) {
      const db = await this.readDb(misses.map((t) => hashes.get(t)!));
      for (const text of [...misses]) {
        const hit = db.get(hashes.get(text)!);
        if (hit === undefined) continue;
        resolved.set(text, hit);
        this.memory.set(hashes.get(text)!, hit);
        misses.splice(misses.indexOf(text), 1);
      }
    }
    // Textes restant à traduire : déjà anglais ou sans lettre → inchangés. Un seul appel par message : source « FR »
    // dès qu'un texte est reconnu comme français, sinon détection automatique par le fournisseur (texte déjà anglais → inchangé).
    const pending: { text: string; protectedText: ReturnType<typeof protectText> }[] = [];
    let french = false;
    for (const text of misses) {
      const lang = detectLanguage(text);
      const protectedText = protectText(text);
      if (lang === 'en' || !hasTranslatableText(protectedText.text)) {
        resolved.set(text, text);
        this.memory.set(hashes.get(text)!, text);
        continue;
      }
      if (lang === 'fr') french = true;
      pending.push({ text, protectedText });
    }
    const toStore: { hash: string; translatedText: string; provider: string; sourceLang: string | null }[] = [];
    if (pending.length) {
      const { results, provider } = await this.callProviders(
        pending.map((g) => g.protectedText.text),
        french ? 'fr' : undefined,
      );
      pending.forEach((g, i) => {
        const r = results[i]!;
        const detected = r.detected ?? (french ? 'fr' : null);
        const restored = detected?.startsWith('en') ? g.text : restoreText(r.text, g.protectedText.tokens);
        const value = restored.trim() ? restored : g.text;
        resolved.set(g.text, value);
        this.memory.set(hashes.get(g.text)!, value);
        toStore.push({ hash: hashes.get(g.text)!, translatedText: value, provider, sourceLang: detected ? detected.slice(0, 8) : null });
      });
    }
    await this.writeDb(toStore);
    return texts.map((t) => {
      if (!t || !t.trim()) return null;
      const v = resolved.get(t);
      return v === undefined || v.trim() === t.trim() ? null : v;
    });
  }

  /** Traduit un embed (titre, description, champs, footer, auteur). `null` si rien n'a changé. */
  async translateEmbed(spec: EmbedSpec): Promise<EmbedSpec | null> {
    return applyEmbedTexts(spec, await this.translateTexts(collectEmbedTexts(spec)));
  }

  /**
   * Traduit des libellés courts (menus, boutons) sans jamais lancer : en cas d'échec ou de délai dépassé,
   * tableau de `null` (libellés français seuls).
   */
  async translateLabels(texts: string[], timeoutMs = this.timeoutMs): Promise<(string | null)[]> {
    try {
      return await withTimeout(this.translateTexts(texts), timeoutMs);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Traduction des libellés impossible : version française seule');
      return texts.map(() => null);
    }
  }

  /**
   * Compose la version bilingue d'un message (textes non rendus : variables `{user}`… intactes).
   * Désactivé → message inchangé. Échec / délai dépassé → message français seul + avertissement dans les logs.
   */
  async localizeMessage(guildId: string, parts: MessageParts, opts: LocalizeOptions = {}): Promise<LocalizedMessage> {
    const content = parts.content ?? undefined;
    const embeds = parts.embeds ?? [];
    const resolved = await this.resolve(guildId, opts);
    const layout = opts.layout ?? resolved.layout;
    const original: LocalizedMessage = { content, embeds, translated: false, failed: false, layout };
    if (!resolved.enabled) return original;
    try {
      const texts = [content ?? '', ...embeds.flatMap(collectEmbedTexts)];
      const translated = await withTimeout(this.translateTexts(texts), this.timeoutMs);
      let cursor = 1;
      const english = embeds.map((spec) => {
        const count = collectEmbedTexts(spec).length;
        const slice = translated.slice(cursor, cursor + count);
        cursor += count;
        return applyEmbedTexts(spec, slice);
      });
      const composedContent = composeContent(content, translated[0], opts.contentMax ?? DISCORD_LIMITS.content);
      const composedEmbeds = composeEmbeds(embeds, english, layout);
      const changed = composedContent !== content || english.some((e) => e !== null);
      return { content: composedContent, embeds: changed ? composedEmbeds : embeds, translated: changed, failed: false, layout };
    } catch (err) {
      log.warn({ guildId, scope: opts.scope, targetId: opts.targetId, err: err instanceof Error ? err.message : String(err) }, 'Traduction automatique impossible : message envoyé en français seul');
      return { ...original, failed: true };
    }
  }
}

export const autoTranslateService = new AutoTranslateService();
