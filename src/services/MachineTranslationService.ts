import crypto from 'node:crypto';
import { prisma } from '../database/client';
import { env } from '../config/env';
import type { EmbedSpec } from './EmbedService';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';

const log = childLogger('MachineTranslationService');

// ───────────────────────── Types ─────────────────────────

/** Un fournisseur de traduction automatique. `translate` doit lancer une erreur en cas d'échec. */
export interface TranslationProvider {
  readonly name: string;
  translate(text: string, from: string, to: string): Promise<string>;
}

export interface ProviderInfo {
  name: string;
  /** Le fournisseur est utilisable (clé présente ou gratuit) */
  enabled: boolean;
  /** Précision affichée dans le dashboard */
  detail: string;
  /** Fournisseur interrogé en premier */
  primary: boolean;
}

export interface ProviderAttempt {
  provider: string;
  error: string;
}

/** Lancée quand tous les fournisseurs ont échoué. */
export class TranslationUnavailableError extends Error {
  constructor(public readonly attempts: ProviderAttempt[]) {
    super(`translation_unavailable: ${attempts.map((a) => `${a.provider} (${a.error})`).join(' | ') || 'no provider'}`);
    this.name = 'TranslationUnavailableError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PROVIDER_TIMEOUT_MS = 8_000;
export const MYMEMORY_MAX_CHARS = 500;
const MEMORY_CACHE_TTL_MS = 24 * 60 * 60_000;

// ───────────────────────── Fonctions pures : protection du contenu ─────────────────────────

export const TOKEN_OPEN = '⟦';
export const TOKEN_CLOSE = '⟧';

/**
 * Motifs à ne jamais traduire, dans l'ordre de priorité : blocs de code, code inline, emojis custom,
 * timestamps Discord, mentions, URLs, variables de template `{user}`.
 */
const PROTECTED_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/,
  /`[^`\n]+`/,
  /<a?:\w+:\d+>/,
  /<t:-?\d+(?::[tTdDfFR])?>/,
  /<(?:@[!&]?|#)\d+>/,
  /<?https?:\/\/[^\s<>]+>?/,
  /\{\w+\}/,
];
const PROTECTED_REGEX = new RegExp(PROTECTED_PATTERNS.map((p) => `(?:${p.source})`).join('|'), 'g');
const TOKEN_REGEX = new RegExp(`${TOKEN_OPEN}\\s*(\\d+)\\s*${TOKEN_CLOSE}`, 'g');

export interface ProtectedText {
  text: string;
  tokens: string[];
}

/** Remplace chaque segment protégé par un jeton `⟦n⟧` (les fournisseurs les laissent intacts). */
export function protectText(text: string): ProtectedText {
  const tokens: string[] = [];
  const protectedText = text.replace(PROTECTED_REGEX, (match) => {
    tokens.push(match);
    return `${TOKEN_OPEN}${tokens.length - 1}${TOKEN_CLOSE}`;
  });
  return { text: protectedText, tokens };
}

/**
 * Restaure les segments protégés. Un jeton absent de la sortie (supprimé par le fournisseur) est
 * réinjecté à la fin du texte pour ne jamais perdre une mention, une URL ou une variable.
 */
export function restoreText(text: string, tokens: string[]): string {
  if (!tokens.length) return text;
  const seen = new Set<number>();
  let out = text.replace(TOKEN_REGEX, (match, idx: string) => {
    const i = Number(idx);
    if (i < 0 || i >= tokens.length) return match;
    seen.add(i);
    return tokens[i]!;
  });
  const missing = tokens.filter((_, i) => !seen.has(i));
  if (missing.length) out = `${out.trimEnd()} ${missing.join(' ')}`.trim();
  return out;
}

// ───────────────────────── Fonctions pures : découpage ─────────────────────────

export interface TextSegment {
  text: string;
  /** false = séparateur (espaces / sauts de ligne) à conserver tel quel */
  translate: boolean;
}

function splitLongLine(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const sentences = line.split(/(?<=[.!?…؟。])\s+/);
  const out: string[] = [];
  let current = '';
  const flush = () => {
    if (current) out.push(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      flush();
      // Phrase trop longue : coupe sur les espaces, puis en dur si nécessaire.
      let rest = sentence;
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max);
        const at = cut > 0 ? cut : max;
        out.push(rest.slice(0, at));
        rest = rest.slice(at).trimStart();
      }
      if (rest) current = rest;
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > max) {
      flush();
      current = sentence;
    } else current = candidate;
  }
  flush();
  return out;
}

/**
 * Découpe un texte en segments de `max` caractères maximum (lignes, puis phrases, puis mots) en
 * conservant les séparateurs : la concaténation des segments redonne exactement le texte d'origine.
 */
export function segmentText(text: string, max: number): TextSegment[] {
  const segments: TextSegment[] = [];
  const push = (t: string, translate: boolean) => {
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last && last.translate === translate && !translate) last.text += t;
    else segments.push({ text: t, translate });
  };
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) push('\n', false);
    if (!line.trim()) {
      push(line, false);
      return;
    }
    const leading = line.match(/^\s*/)![0];
    const trailing = line.match(/\s*$/)![0];
    const core = line.slice(leading.length, line.length - trailing.length);
    push(leading, false);
    const parts = splitLongLine(core, max);
    parts.forEach((part, j) => {
      if (j > 0) push(' ', false);
      push(part, true);
    });
    push(trailing, false);
  });
  return segments;
}

// ───────────────────────── Codes langue ─────────────────────────

export function deeplSourceLang(code: string): string {
  return code.split('-')[0]!.toUpperCase();
}

export function deeplTargetLang(code: string): string {
  const base = code.split('-')[0]!.toLowerCase();
  if (base === 'en') return 'EN-US';
  if (base === 'pt') return 'PT-BR';
  return base.toUpperCase();
}

export function googleLang(code: string): string {
  const base = code.split('-')[0]!.toLowerCase();
  return base === 'pt' ? 'pt-BR' : base;
}

export function myMemoryLang(code: string): string {
  const base = code.split('-')[0]!.toLowerCase();
  return base === 'pt' ? 'pt-BR' : base;
}

// ───────────────────────── Fournisseurs ─────────────────────────

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class DeepLProvider implements TranslationProvider {
  readonly name = 'deepl';
  readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
  ) {
    this.baseUrl = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const res = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: [text], source_lang: deeplSourceLang(from), target_lang: deeplTargetLang(to), preserve_formatting: true, split_sentences: '1' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { translations?: { text?: string }[] };
    const out = data.translations?.[0]?.text;
    if (typeof out !== 'string') throw new Error('invalid response');
    return out;
  }
}

/** Google Translate « gtx » : point d'accès gratuit non officiel (sans clé, sans garantie de disponibilité). */
export class GoogleGtxProvider implements TranslationProvider {
  readonly name = 'google';

  constructor(private readonly fetchImpl: FetchLike) {}

  async translate(text: string, from: string, to: string): Promise<string> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(googleLang(from))}&tl=${encodeURIComponent(googleLang(to))}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetchWithTimeout(this.fetchImpl, url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('invalid response');
    const out = (data[0] as unknown[]).map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0] : '')).join('');
    if (!out) throw new Error('empty response');
    return out;
  }
}

/** MyMemory : gratuit, 500 caractères par requête (découpage automatique), quota journalier relevé avec `de=<email>`. */
export class MyMemoryProvider implements TranslationProvider {
  readonly name = 'mymemory';

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly email = '',
  ) {}

  private async translateChunk(text: string, from: string, to: string): Promise<string> {
    const params = new URLSearchParams({ q: text, langpair: `${myMemoryLang(from)}|${myMemoryLang(to)}` });
    if (this.email) params.set('de', this.email);
    const res = await fetchWithTimeout(this.fetchImpl, `https://api.mymemory.translated.net/get?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { responseStatus?: number | string; responseData?: { translatedText?: string }; responseDetails?: string };
    if (Number(data.responseStatus) !== 200) throw new Error(String(data.responseDetails ?? data.responseStatus ?? 'error'));
    const out = data.responseData?.translatedText;
    if (typeof out !== 'string' || !out) throw new Error('invalid response');
    return out;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const segments = segmentText(text, MYMEMORY_MAX_CHARS);
    const out: string[] = [];
    for (const seg of segments) out.push(seg.translate ? await this.translateChunk(seg.text, from, to) : seg.text);
    return out.join('');
  }
}

// ───────────────────────── Service ─────────────────────────

export interface MachineTranslationOptions {
  providers?: TranslationProvider[];
  fetch?: FetchLike;
  /** Désactive le cache base de données (tests) */
  dbCache?: boolean;
}

function readEnv(key: 'DEEPL_API_KEY' | 'MYMEMORY_EMAIL'): string {
  try {
    return env()[key] ?? '';
  } catch {
    return process.env[key] ?? '';
  }
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Traduction automatique avec fournisseurs enchaînés (DeepL → Google gtx → MyMemory), protection des
 * mentions / URLs / variables / code, cache mémoire + base (MachineTranslation).
 */
export class MachineTranslationService {
  private readonly memory = new TTLCache<string>(MEMORY_CACHE_TTL_MS, 5000);
  private readonly fetchImpl: FetchLike;
  private readonly dbCache: boolean;
  private customProviders: TranslationProvider[] | null;
  private builtProviders: TranslationProvider[] | null = null;

  constructor(opts: MachineTranslationOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.dbCache = opts.dbCache ?? true;
    this.customProviders = opts.providers ?? null;
  }

  /** Remplace la chaîne de fournisseurs (tests / extensions). `null` = chaîne par défaut. */
  setProviders(providers: TranslationProvider[] | null): void {
    this.customProviders = providers;
    this.builtProviders = null;
  }

  get providers(): TranslationProvider[] {
    if (this.customProviders) return this.customProviders;
    if (!this.builtProviders) {
      const chain: TranslationProvider[] = [];
      const deeplKey = readEnv('DEEPL_API_KEY').trim();
      if (deeplKey) chain.push(new DeepLProvider(deeplKey, this.fetchImpl));
      chain.push(new GoogleGtxProvider(this.fetchImpl), new MyMemoryProvider(this.fetchImpl, readEnv('MYMEMORY_EMAIL').trim()));
      this.builtProviders = chain;
    }
    return this.builtProviders;
  }

  isAvailable(): boolean {
    return this.providers.length > 0;
  }

  /** Description des fournisseurs (dashboard « Paramètres »). */
  providersInfo(): ProviderInfo[] {
    const deeplKey = readEnv('DEEPL_API_KEY').trim();
    const email = readEnv('MYMEMORY_EMAIL').trim();
    const list: ProviderInfo[] = [
      { name: 'DeepL', enabled: !!deeplKey, detail: deeplKey ? (deeplKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com') : 'DEEPL_API_KEY absente', primary: false },
      { name: 'Google Translate (gtx)', enabled: true, detail: 'gratuit, non officiel', primary: false },
      { name: 'MyMemory', enabled: true, detail: email ? `gratuit · ${email}` : 'gratuit · 500 caractères / requête', primary: false },
    ];
    const first = list.find((p) => p.enabled);
    if (first) first.primary = true;
    return list;
  }

  private cacheKey(hash: string, from: string, to: string): string {
    return `${from}:${to}:${hash}`;
  }

  private async readDb(hash: string, from: string, to: string): Promise<string | null> {
    if (!this.dbCache) return null;
    try {
      const row = await prisma.machineTranslation.findUnique({ where: { hash_sourceLang_targetLang: { hash, sourceLang: from, targetLang: to } } });
      return row?.translatedText ?? null;
    } catch (err) {
      log.debug({ err }, 'Lecture du cache de traduction impossible');
      return null;
    }
  }

  private async writeDb(hash: string, from: string, to: string, sourceText: string, translatedText: string, provider: string): Promise<void> {
    if (!this.dbCache) return;
    try {
      await prisma.machineTranslation.upsert({
        where: { hash_sourceLang_targetLang: { hash, sourceLang: from, targetLang: to } },
        create: { hash, sourceLang: from, targetLang: to, sourceText, translatedText, provider },
        update: { translatedText, provider },
      });
    } catch (err) {
      log.debug({ err }, 'Écriture du cache de traduction impossible');
    }
  }

  /** Interroge les fournisseurs dans l'ordre ; retourne la première réponse non vide. */
  private async translateWithProviders(text: string, from: string, to: string): Promise<{ text: string; provider: string }> {
    const attempts: ProviderAttempt[] = [];
    for (const provider of this.providers) {
      try {
        const out = await provider.translate(text, from, to);
        if (out && out.trim()) return { text: out, provider: provider.name };
        attempts.push({ provider: provider.name, error: 'empty' });
      } catch (err) {
        const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err);
        attempts.push({ provider: provider.name, error: message });
        log.warn({ provider: provider.name, err: message, from, to }, 'Fournisseur de traduction en échec');
      }
    }
    throw new TranslationUnavailableError(attempts);
  }

  /** Traduit un texte (protection des segments non traduisibles, cache). Texte vide ou from === to → inchangé. */
  async translate(text: string, from: string, to: string): Promise<string> {
    const source = text ?? '';
    const fromCode = from.split('-')[0]!.toLowerCase();
    const toCode = to.split('-')[0]!.toLowerCase();
    if (!source.trim() || fromCode === toCode) return source;
    const hash = sha256(source);
    const key = this.cacheKey(hash, fromCode, toCode);
    const cached = this.memory.get(key) ?? (await this.readDb(hash, fromCode, toCode));
    if (cached) {
      this.memory.set(key, cached);
      return cached;
    }
    const protectedText = protectText(source);
    // Rien à traduire une fois les segments protégés retirés (ex. texte composé uniquement de mentions).
    if (!protectedText.text.replace(TOKEN_REGEX, '').trim()) return source;
    const result = await this.translateWithProviders(protectedText.text, fromCode, toCode);
    const restored = restoreText(result.text, protectedText.tokens);
    this.memory.set(key, restored);
    await this.writeDb(hash, fromCode, toCode, source, restored, result.provider);
    return restored;
  }

  /** Traduit plusieurs textes (séquentiellement, avec dédoublonnage) et conserve l'ordre. */
  async translateMany(texts: string[], from: string, to: string): Promise<string[]> {
    const unique = new Map<string, string>();
    for (const text of texts) {
      if (unique.has(text)) continue;
      unique.set(text, await this.translate(text, from, to));
    }
    return texts.map((t) => unique.get(t) ?? t);
  }

  /**
   * Traduit les textes d'un EmbedSpec (titre, description, footer, auteur, champs). Les URLs, couleurs,
   * images et le timestamp sont conservés tels quels.
   */
  async translateEmbedSpec(spec: EmbedSpec, from: string, to: string): Promise<EmbedSpec> {
    const texts: string[] = [];
    const push = (s: string | undefined): number => {
      if (s === undefined) return -1;
      texts.push(s);
      return texts.length - 1;
    };
    const iTitle = push(spec.title);
    const iDesc = push(spec.description);
    const iFooter = push(spec.footer?.text);
    const iAuthor = push(spec.author?.name);
    const fieldIdx = (spec.fields ?? []).map((f) => ({ name: push(f.name), value: push(f.value) }));
    const translated = await this.translateMany(texts, from, to);
    const pick = (i: number, fallback: string): string => (i >= 0 ? (translated[i] ?? fallback) : fallback);
    const out: EmbedSpec = { ...spec };
    if (spec.title !== undefined) out.title = pick(iTitle, spec.title).slice(0, 256);
    if (spec.description !== undefined) out.description = pick(iDesc, spec.description).slice(0, 4096);
    if (spec.footer) out.footer = { ...spec.footer, text: pick(iFooter, spec.footer.text).slice(0, 2048) };
    if (spec.author) out.author = { ...spec.author, name: pick(iAuthor, spec.author.name).slice(0, 256) };
    if (spec.fields) out.fields = spec.fields.map((f, i) => ({ ...f, name: pick(fieldIdx[i]!.name, f.name).slice(0, 256), value: pick(fieldIdx[i]!.value, f.value).slice(0, 1024) }));
    return out;
  }
}

export const machineTranslationService = new MachineTranslationService();
