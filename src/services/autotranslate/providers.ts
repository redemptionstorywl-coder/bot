import { segmentText } from './text';

/**
 * Fournisseurs de traduction automatique FR → EN.
 * Ordre : DeepL (`DEEPL_API_KEY`, API Free si la clé finit par `:fx`) → Google Cloud Translation (`GOOGLE_TRANSLATE_API_KEY`)
 * → MyMemory (gratuit, sans clé ; `MYMEMORY_EMAIL` relève le quota). MyMemory sert aussi de secours si le premier échoue.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderResult {
  text: string;
  /** Langue source détectée par le fournisseur (code ISO en minuscules), si connue */
  detected?: string;
}

export interface TranslateRequest {
  /** 'fr' si le texte est connu comme français ; absent = détection automatique par le fournisseur */
  source?: 'fr';
  target: 'en';
}

export interface TranslationProvider {
  readonly name: string;
  /** Traduit un lot de textes (même ordre en sortie). Lance une erreur en cas d'échec. */
  translate(texts: string[], req: TranslateRequest): Promise<ProviderResult[]>;
}

export const PROVIDER_TIMEOUT_MS = 8_000;
export const MYMEMORY_MAX_CHARS = 450;

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | null,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
  }
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&apos;': "'" };
/** Décode les entités HTML courantes (Google / MyMemory peuvent en renvoyer). */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#0?39);/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
}

/** DeepL API v2 (https://www.deepl.com/pro-api) — 500 000 caractères / mois gratuits avec une clé « API Free ». */
export class DeepLProvider implements TranslationProvider {
  readonly name = 'deepl';
  readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs = PROVIDER_TIMEOUT_MS,
  ) {
    this.baseUrl = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  }

  get isFree(): boolean {
    return this.baseUrl.includes('api-free');
  }

  async translate(texts: string[], req: TranslateRequest): Promise<ProviderResult[]> {
    const out: ProviderResult[] = [];
    for (const batch of chunk(texts, 50)) {
      const body: Record<string, unknown> = { text: batch, target_lang: 'EN-GB', preserve_formatting: true };
      if (req.source) body.source_lang = 'FR';
      const res = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/v2/translate`, { method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, this.timeoutMs);
      if (!res.ok) throw new ProviderError(this.name, res.status, res.status === 456 ? 'quota exceeded' : res.status === 403 ? 'invalid key' : `HTTP ${res.status}`);
      const data = (await res.json()) as { translations?: { text?: unknown; detected_source_language?: unknown }[] };
      if (!Array.isArray(data.translations) || data.translations.length !== batch.length) throw new ProviderError(this.name, res.status, 'invalid response');
      for (const tr of data.translations) {
        if (typeof tr.text !== 'string') throw new ProviderError(this.name, res.status, 'invalid response');
        out.push({ text: tr.text, detected: typeof tr.detected_source_language === 'string' ? tr.detected_source_language.toLowerCase() : undefined });
      }
    }
    return out;
  }
}

/** Google Cloud Translation API v2 (clé d'API Google Cloud). */
export class GoogleCloudProvider implements TranslationProvider {
  readonly name = 'google';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs = PROVIDER_TIMEOUT_MS,
  ) {}

  async translate(texts: string[], req: TranslateRequest): Promise<ProviderResult[]> {
    const out: ProviderResult[] = [];
    for (const batch of chunk(texts, 100)) {
      const body: Record<string, unknown> = { q: batch, target: 'en', format: 'text' };
      if (req.source) body.source = 'fr';
      const res = await fetchWithTimeout(this.fetchImpl, `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, this.timeoutMs);
      if (!res.ok) throw new ProviderError(this.name, res.status, `HTTP ${res.status}`);
      const data = (await res.json()) as { data?: { translations?: { translatedText?: unknown; detectedSourceLanguage?: unknown }[] } };
      const list = data.data?.translations;
      if (!Array.isArray(list) || list.length !== batch.length) throw new ProviderError(this.name, res.status, 'invalid response');
      for (const tr of list) {
        if (typeof tr.translatedText !== 'string') throw new ProviderError(this.name, res.status, 'invalid response');
        out.push({ text: decodeEntities(tr.translatedText), detected: typeof tr.detectedSourceLanguage === 'string' ? tr.detectedSourceLanguage.toLowerCase() : req.source });
      }
    }
    return out;
  }
}

/** MyMemory (https://mymemory.translated.net) : gratuit, sans clé, requêtes de 500 caractères max (découpage automatique). */
export class MyMemoryProvider implements TranslationProvider {
  readonly name = 'mymemory';

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly email = '',
    private readonly timeoutMs = PROVIDER_TIMEOUT_MS,
  ) {}

  private async translateChunk(text: string): Promise<string> {
    const params = new URLSearchParams({ q: text, langpair: 'fr|en' });
    if (this.email) params.set('de', this.email);
    const res = await fetchWithTimeout(this.fetchImpl, `https://api.mymemory.translated.net/get?${params.toString()}`, { method: 'GET' }, this.timeoutMs);
    if (!res.ok) throw new ProviderError(this.name, res.status, `HTTP ${res.status}`);
    const data = (await res.json()) as { responseStatus?: number | string; responseData?: { translatedText?: unknown }; responseDetails?: unknown };
    const status = Number(data.responseStatus);
    const out = data.responseData?.translatedText;
    if (status !== 200 || typeof out !== 'string' || !out) throw new ProviderError(this.name, Number.isNaN(status) ? null : status, String(data.responseDetails ?? 'invalid response').slice(0, 200));
    // Quota atteint : MyMemory répond 200 avec un avertissement à la place de la traduction.
    if (/^MYMEMORY WARNING|^QUERY LENGTH LIMIT/i.test(out)) throw new ProviderError(this.name, 429, out.slice(0, 200));
    return decodeEntities(out);
  }

  async translate(texts: string[]): Promise<ProviderResult[]> {
    const out: ProviderResult[] = [];
    for (const text of texts) {
      const parts: string[] = [];
      for (const seg of segmentText(text, MYMEMORY_MAX_CHARS)) parts.push(seg.translate ? await this.translateChunk(seg.text) : seg.text);
      out.push({ text: parts.join('') });
    }
    return out;
  }
}

export interface ProviderEnv {
  DEEPL_API_KEY?: string;
  GOOGLE_TRANSLATE_API_KEY?: string;
  MYMEMORY_EMAIL?: string;
}

/** Chaîne de fournisseurs selon les clés présentes (MyMemory toujours en dernier, en secours). */
export function buildProviderChain(cfg: ProviderEnv, fetchImpl: FetchLike, timeoutMs = PROVIDER_TIMEOUT_MS): TranslationProvider[] {
  const chain: TranslationProvider[] = [];
  const deepl = cfg.DEEPL_API_KEY?.trim();
  const google = cfg.GOOGLE_TRANSLATE_API_KEY?.trim();
  if (deepl) chain.push(new DeepLProvider(deepl, fetchImpl, timeoutMs));
  if (google) chain.push(new GoogleCloudProvider(google, fetchImpl, timeoutMs));
  chain.push(new MyMemoryProvider(fetchImpl, cfg.MYMEMORY_EMAIL?.trim() ?? '', timeoutMs));
  return chain;
}

export interface ProviderDescription {
  /** Fournisseur principal */
  primary: 'deepl' | 'google' | 'mymemory';
  /** Nom du service (« DeepL API Free »…) — jamais la clé */
  label: string;
  /** Point d'accès utilisé */
  endpoint: string;
  /** MyMemory : adresse e-mail fournie (quota relevé) */
  mymemoryEmail: boolean;
}

/** Description du fournisseur actif (panneau /config, dashboard). */
export function describeProvider(cfg: ProviderEnv): ProviderDescription {
  const deepl = cfg.DEEPL_API_KEY?.trim();
  const mymemoryEmail = !!cfg.MYMEMORY_EMAIL?.trim();
  if (deepl) {
    const free = deepl.endsWith(':fx');
    return { primary: 'deepl', label: free ? 'DeepL API Free' : 'DeepL API Pro', endpoint: free ? 'api-free.deepl.com' : 'api.deepl.com', mymemoryEmail };
  }
  if (cfg.GOOGLE_TRANSLATE_API_KEY?.trim()) return { primary: 'google', label: 'Google Cloud Translation', endpoint: 'translation.googleapis.com', mymemoryEmail };
  return { primary: 'mymemory', label: 'MyMemory', endpoint: 'api.mymemory.translated.net', mymemoryEmail };
}
