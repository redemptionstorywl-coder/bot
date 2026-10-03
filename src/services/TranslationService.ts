import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../database/client';
import { DEFAULT_LANGUAGE, FALLBACK_LANGUAGE, LANGUAGE_CODES, fromDiscordLocale } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';

const log = childLogger('TranslationService');

export type TranslationVars = Record<string, string | number | boolean | null | undefined>;
export type Translator = (key: string, vars?: TranslationVars) => string;

type LocaleTree = { [k: string]: string | LocaleTree };

function flatten(tree: LocaleTree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

/**
 * Service de traduction.
 *  - Fichiers src/locales/<lang>.json (clé imbriquées : "tickets.open.title")
 *  - Overrides en base (table Translation) : globaux (guildId null) et par serveur
 *  - Langue d'un utilisateur : table UserLanguage (cache mémoire)
 *  - Résolution : user → serveur → défaut → fallback (en) → clé brute
 */
export class TranslationService {
  private readonly locales = new Map<string, Record<string, string>>();
  private readonly overrides = new TTLCache<Record<string, string>>(5 * 60_000);
  private readonly userLang = new TTLCache<string>(10 * 60_000, 50_000);
  private readonly localesDir: string;

  constructor(localesDir = path.resolve(__dirname, '..', 'locales')) {
    this.localesDir = localesDir;
    this.loadLocales();
  }

  /**
   * Charge les fichiers de langue :
   *  - src/locales/<lang>.json            → clés à la racine
   *  - src/locales/<lang>/<namespace>.json → clés préfixées par `<namespace>.`
   * Chaque module possède ainsi son propre fichier (tickets.json, moderation.json…).
   */
  loadLocales(): void {
    this.locales.clear();
    if (!fs.existsSync(this.localesDir)) {
      log.warn({ dir: this.localesDir }, 'Dossier locales introuvable');
      return;
    }
    for (const entry of fs.readdirSync(this.localesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const code = entry.name.replace('.json', '');
        this.merge(code, this.readJson(path.join(this.localesDir, entry.name)), '');
      } else if (entry.isDirectory()) {
        const code = entry.name;
        const dir = path.join(this.localesDir, code);
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.json')) continue;
          const ns = file.replace('.json', '');
          this.merge(code, this.readJson(path.join(dir, file)), ns);
        }
      }
    }
    log.info({ languages: [...this.locales.keys()] }, 'Langues chargées');
  }

  private readJson(file: string): LocaleTree {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as LocaleTree;
    } catch (err) {
      log.error({ err, file }, 'Fichier de langue invalide');
      return {};
    }
  }

  private merge(code: string, tree: LocaleTree, prefix: string): void {
    const flat = flatten(tree, prefix);
    const existing = this.locales.get(code) ?? {};
    this.locales.set(code, { ...existing, ...flat });
  }

  get availableLanguages(): string[] {
    return [...this.locales.keys()];
  }

  isSupported(code: string): boolean {
    return LANGUAGE_CODES.includes(code);
  }

  /** Toutes les clés d'une langue (pour le dashboard "Traductions"). */
  getCatalog(lang: string): Record<string, string> {
    return { ...(this.locales.get(lang) ?? {}) };
  }

  /** Traduction brute avec interpolation `{var}`. */
  translate(lang: string, key: string, vars?: TranslationVars, guildId?: string | null): string {
    const value = this.lookup(lang, key, guildId) ?? this.lookup(FALLBACK_LANGUAGE, key, guildId) ?? key;
    return this.interpolate(value, vars);
  }

  private lookup(lang: string, key: string, guildId?: string | null): string | undefined {
    const guildOverride = guildId ? this.overrides.get(`${guildId}:${lang}`)?.[key] : undefined;
    if (guildOverride !== undefined) return guildOverride;
    const globalOverride = this.overrides.get(`global:${lang}`)?.[key];
    if (globalOverride !== undefined) return globalOverride;
    return this.locales.get(lang)?.[key];
  }

  interpolate(template: string, vars?: TranslationVars): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars && vars[k] != null ? String(vars[k]) : m));
  }

  /** Retourne une fonction t() liée à une langue + serveur. */
  bind(lang: string, guildId?: string | null): Translator {
    return (key, vars) => this.translate(lang, key, vars, guildId);
  }

  // ───── Overrides base de données ─────

  async loadOverrides(guildId: string | null, lang: string): Promise<Record<string, string>> {
    const cacheKey = `${guildId ?? 'global'}:${lang}`;
    const cached = this.overrides.get(cacheKey);
    if (cached) return cached;
    const rows = await prisma.translation.findMany({ where: { guildId, language: lang } });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    this.overrides.set(cacheKey, map);
    return map;
  }

  /** Précharge les overrides d'un serveur pour toutes les langues (appelé à la résolution du contexte). */
  async preloadGuild(guildId: string): Promise<void> {
    const rows = await prisma.translation.findMany({ where: { OR: [{ guildId }, { guildId: null }] } });
    const grouped = new Map<string, Record<string, string>>();
    for (const r of rows) {
      const k = `${r.guildId ?? 'global'}:${r.language}`;
      if (!grouped.has(k)) grouped.set(k, {});
      grouped.get(k)![r.key] = r.value;
    }
    for (const lang of LANGUAGE_CODES) {
      this.overrides.set(`${guildId}:${lang}`, grouped.get(`${guildId}:${lang}`) ?? {});
      this.overrides.set(`global:${lang}`, grouped.get(`global:${lang}`) ?? {});
    }
  }

  async setOverride(guildId: string | null, lang: string, key: string, value: string): Promise<void> {
    const existing = await prisma.translation.findFirst({ where: { guildId, language: lang, key } });
    if (existing) await prisma.translation.update({ where: { id: existing.id }, data: { value } });
    else await prisma.translation.create({ data: { guildId, language: lang, key, value } });
    this.overrides.delete(`${guildId ?? 'global'}:${lang}`);
  }

  async deleteOverride(guildId: string | null, lang: string, key: string): Promise<void> {
    await prisma.translation.deleteMany({ where: { guildId, language: lang, key } });
    this.overrides.delete(`${guildId ?? 'global'}:${lang}`);
  }

  invalidateGuild(guildId: string): void {
    this.overrides.invalidatePrefix(`${guildId}:`);
    this.userLang.invalidatePrefix(`${guildId}:`);
  }

  // ───── Langue utilisateur ─────

  async getUserLanguage(guildId: string, userId: string): Promise<string | null> {
    const key = `${guildId}:${userId}`;
    const cached = this.userLang.get(key);
    if (cached !== undefined) return cached === '' ? null : cached;
    const row = await prisma.userLanguage.findUnique({ where: { userId_guildId: { userId, guildId } } });
    this.userLang.set(key, row?.language ?? '');
    return row?.language ?? null;
  }

  async setUserLanguage(guildId: string, userId: string, language: string, userInfo?: { username: string; globalName?: string | null; avatar?: string | null }): Promise<void> {
    if (!this.isSupported(language)) throw new Error(`Langue non supportée : ${language}`);
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, username: userInfo?.username ?? 'unknown', globalName: userInfo?.globalName ?? null, avatar: userInfo?.avatar ?? null },
      update: userInfo ? { username: userInfo.username, globalName: userInfo.globalName ?? null, avatar: userInfo.avatar ?? null } : {},
    });
    await prisma.userLanguage.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: { userId, guildId, language },
      update: { language },
    });
    this.userLang.set(`${guildId}:${userId}`, language);
  }

  /**
   * Résout la langue à utiliser pour un utilisateur :
   * langue choisie → locale Discord (si activée sur le serveur) → langue par défaut du serveur.
   */
  async resolveLanguage(opts: { guildId?: string | null; userId?: string; discordLocale?: string; guildDefault?: string; enabledLanguages?: string[] }): Promise<string> {
    const guildDefault = opts.guildDefault ?? DEFAULT_LANGUAGE;
    if (opts.guildId && opts.userId) {
      const chosen = await this.getUserLanguage(opts.guildId, opts.userId);
      if (chosen && this.isSupported(chosen)) return chosen;
    }
    const fromLocale = fromDiscordLocale(opts.discordLocale);
    if (fromLocale && (!opts.enabledLanguages || opts.enabledLanguages.includes(fromLocale))) return fromLocale;
    return guildDefault;
  }

  /** Compte les utilisateurs par langue (stats dashboard). */
  async countByLanguage(guildId: string): Promise<Record<string, number>> {
    const rows = await prisma.userLanguage.groupBy({ by: ['language'], where: { guildId }, _count: { _all: true } });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.language] = r._count._all;
    return out;
  }
}

export const translationService = new TranslationService();
