import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LANGUAGE, FALLBACK_LANGUAGE, LANGUAGE_CODES } from '../config/constants';
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
 * Traductions de l'interface du bot (fichiers src/locales/<lang>/<ns>.json, langues fr et en).
 * Le bot répond dans la langue par défaut du serveur (GuildSettings.defaultLanguage, 'fr' par défaut).
 * Résolution d'une clé : langue demandée → fallback (en) → clé brute.
 */
export class TranslationService {
  private readonly locales = new Map<string, Record<string, string>>();
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

  /** Traduction brute avec interpolation `{var}`. */
  translate(lang: string, key: string, vars?: TranslationVars, _guildId?: string | null): string {
    const value = this.locales.get(lang)?.[key] ?? this.locales.get(FALLBACK_LANGUAGE)?.[key] ?? key;
    return this.interpolate(value, vars);
  }

  interpolate(template: string, vars?: TranslationVars): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars && vars[k] != null ? String(vars[k]) : m));
  }

  /** Retourne une fonction t() liée à une langue. */
  bind(lang: string, _guildId?: string | null): Translator {
    return (key, vars) => this.translate(lang, key, vars);
  }

  /** Langue de l'interface pour un serveur : sa langue par défaut si supportée, sinon 'fr'. */
  resolveLanguage(guildDefault?: string | null): string {
    return guildDefault && this.isSupported(guildDefault) ? guildDefault : DEFAULT_LANGUAGE;
  }
}

export const translationService = new TranslationService();
