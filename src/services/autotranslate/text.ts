/**
 * Traduction automatique — fonctions pures sur le texte :
 *  - protection des segments à ne jamais traduire (variables `{user}`, mentions, emojis custom, URLs, code, Markdown)
 *    remplacés par des jetons `⟦n⟧` que les fournisseurs laissent intacts, puis restauration ;
 *  - découpage en segments (fournisseurs limités en taille par requête) ;
 *  - détection grossière FR / EN (on ne traduit pas un texte déjà en anglais).
 */

export const TOKEN_OPEN = '⟦';
export const TOKEN_CLOSE = '⟧';

/**
 * Rôle d'un jeton à la restauration :
 *  - keep   : contenu (mention, URL, variable, code…) — réinjecté en fin de texte si le fournisseur l'a perdu ;
 *  - open   : ouvre une mise en forme (`**`, préfixe de ligne `> `, `# `…) — espaces suivants retirés ;
 *  - close  : ferme une mise en forme (`**`, `](url)`) — espaces précédents retirés.
 */
export type TokenRole = 'keep' | 'open' | 'close';

export interface ProtectedToken {
  value: string;
  role: TokenRole;
  /** Index du jeton apparié (marqueurs Markdown ouvrant / fermant) */
  pair?: number;
  /** Jeton de mise en forme (non réinjecté s'il disparaît) */
  markup: boolean;
}

export interface ProtectedText {
  text: string;
  tokens: ProtectedToken[];
}

/** Groupes nommés de l'expression de protection, dans l'ordre de priorité. */
const PATTERNS: [name: string, source: string][] = [
  ['codeblock', '```[\\s\\S]*?```'],
  ['code', '`[^`\\n]+`'],
  ['emoji', '<a?:\\w{1,32}:\\d{5,22}>'],
  ['timestamp', '<t:-?\\d+(?::[tTdDfFR])?>'],
  ['mention', '<(?:@[!&]?|#)\\d{5,22}>'],
  ['command', '</[\\w -]{1,64}:\\d{5,22}>'],
  ['linktarget', '\\]\\(\\s*<?https?://[^\\s)<>]+>?\\s*\\)'],
  ['url', '<https?://[^\\s>]+>|https?://[^\\s<>]*[^\\s<>.,;:!?\'")\\]]'],
  ['variable', '\\{\\w{1,32}\\}'],
  ['prefix', '^(?:[ \\t]*(?:>>> |> |-# |#{1,3} |[-*] |\\d{1,3}\\. ))+'],
  ['marker', '\\*{1,3}|~~|\\|\\||(?<![\\p{L}\\p{N}])_{1,2}|_{1,2}(?![\\p{L}\\p{N}])'],
];
const PROTECT_REGEX = new RegExp(PATTERNS.map(([name, src]) => `(?<${name}>${src})`).join('|'), 'gmu');
const TOKEN_REGEX = /⟦\s*(\d+)\s*⟧/g;

/** Remplace chaque segment protégé par un jeton `⟦n⟧`. */
export function protectText(text: string): ProtectedText {
  const tokens: ProtectedToken[] = [];
  const markerSlots = new Map<string, number[]>();
  const out = text.replace(PROTECT_REGEX, (match: string, ...rest: unknown[]) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    const index = tokens.length;
    if (groups.prefix !== undefined) tokens.push({ value: match, role: 'open', markup: true });
    else if (groups.linktarget !== undefined) tokens.push({ value: match, role: 'close', markup: false });
    else if (groups.marker !== undefined) {
      tokens.push({ value: match, role: 'keep', markup: true });
      const list = markerSlots.get(match) ?? [];
      list.push(index);
      markerSlots.set(match, list);
    } else tokens.push({ value: match, role: 'keep', markup: false });
    return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
  });
  // Marqueurs Markdown appariés (nombre pair d'occurrences) : alternance ouvrant / fermant.
  for (const slots of markerSlots.values()) {
    if (slots.length % 2 !== 0) continue;
    for (let i = 0; i < slots.length; i += 2) {
      const open = tokens[slots[i]!]!;
      const close = tokens[slots[i + 1]!]!;
      open.role = 'open';
      open.pair = slots[i + 1];
      close.role = 'close';
      close.pair = slots[i];
    }
  }
  return { text: out, tokens };
}

/** Vrai s'il reste du texte traduisible (au moins une lettre) une fois les jetons retirés. */
export function hasTranslatableText(protectedText: string): boolean {
  return /\p{L}/u.test(protectedText.replace(TOKEN_REGEX, ''));
}

/**
 * Restaure les segments protégés.
 *  - espaces parasites autour des marqueurs (`** gras **` → `**gras**`) retirés ;
 *  - un jeton de contenu perdu par le fournisseur est réinjecté en fin de texte (aucune mention / URL / variable perdue) ;
 *  - un marqueur Markdown dont la paire a disparu est retiré (pas de gras orphelin).
 */
export function restoreText(text: string, tokens: ProtectedToken[]): string {
  if (!tokens.length) return text.replace(TOKEN_REGEX, '');
  let out = text.replace(TOKEN_REGEX, (_m, idx: string) => `${TOKEN_OPEN}${Number(idx)}${TOKEN_CLOSE}`);
  const present = new Set<number>();
  for (const m of out.matchAll(TOKEN_REGEX)) present.add(Number(m[1]));
  tokens.forEach((token, i) => {
    if (!present.has(i)) return;
    const tag = `${TOKEN_OPEN}${i}${TOKEN_CLOSE}`;
    if (token.role === 'open') out = out.replace(new RegExp(`${tag}[ \\t]+`, 'g'), tag);
    else if (token.role === 'close') out = out.replace(new RegExp(`[ \\t]+${tag}`, 'g'), tag);
  });
  const dropped = new Set<number>();
  tokens.forEach((token, i) => {
    if (token.pair !== undefined && (!present.has(i) || !present.has(token.pair))) dropped.add(i);
  });
  const seen = new Set<number>();
  // 1. Jetons inconnus, dupliqués ou orphelins retirés, puis espaces laissés par ces retraits normalisés
  //    (avant la réinsertion : le contenu protégé — blocs de code compris — n'est jamais touché).
  out = out.replace(TOKEN_REGEX, (m, idx: string) => {
    const i = Number(idx);
    if (!tokens[i] || dropped.has(i) || seen.has(i)) return '';
    seen.add(i);
    return m;
  });
  out = out.replace(/(\S)[ \t]{2,}/g, '$1 ').replace(/[ \t]+$/gm, '');
  // 2. Réinsertion des segments protégés.
  out = out.replace(TOKEN_REGEX, (_m, idx: string) => tokens[Number(idx)]!.value);
  const missing = tokens.filter((t, i) => !t.markup && !present.has(i)).map((t) => t.value);
  if (missing.length) out = `${out.trimEnd()} ${missing.join(' ')}`.trim();
  return out;
}

// ───────────────────────── Découpage ─────────────────────────

export interface TextSegment {
  text: string;
  /** false = séparateur (espaces / sauts de ligne) conservé tel quel */
  translate: boolean;
}

function splitLongLine(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const sentences = line.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  let current = '';
  const flush = () => {
    if (current) out.push(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      flush();
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
 * Découpe un texte en segments d'au plus `max` caractères (lignes, puis phrases, puis mots) en conservant
 * les séparateurs : la concaténation des segments redonne exactement le texte (aux espaces de coupe près).
 */
export function segmentText(text: string, max: number): TextSegment[] {
  const segments: TextSegment[] = [];
  const push = (t: string, translate: boolean) => {
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last && !translate && !last.translate) last.text += t;
    else segments.push({ text: t, translate });
  };
  text.split('\n').forEach((line, i) => {
    if (i > 0) push('\n', false);
    if (!line.trim()) {
      push(line, false);
      return;
    }
    const leading = line.match(/^\s*/)![0];
    const trailing = line.match(/\s*$/)![0];
    const core = line.slice(leading.length, line.length - trailing.length);
    push(leading, false);
    splitLongLine(core, max).forEach((part, j) => {
      if (j > 0) push(' ', false);
      push(part, true);
    });
    push(trailing, false);
  });
  return segments;
}

// ───────────────────────── Détection de langue ─────────────────────────

const FR_WORDS = new Set(
  'le la les des du de un une et est sont pour sur dans avec vous nous pas ce cette ces qui que au aux ne votre vos notre nos il elle ils elles sera être avoir ou mais plus tout tous toutes bienvenue merci bonjour salut veuillez serveur règlement règles joueurs joueur jeu partie ici chez sans très aussi comme leur leurs fait faire peut peuvent doit alors donc quand avant après'.split(' '),
);
const EN_WORDS = new Set(
  'the and is are to of in for on with you your we our this that it be will have has not or but all welcome please thanks thank from by at an as can must here rules players player game server join read only more when before after their they them do does'.split(' '),
);

export type DetectedLanguage = 'fr' | 'en' | 'unknown';

/**
 * Détection grossière (mots-outils + accents) : 'en' seulement quand l'anglais domine nettement,
 * 'fr' quand le français domine, 'unknown' sinon (textes courts : on laisse le fournisseur décider).
 */
export function detectLanguage(text: string): DetectedLanguage {
  const clean = protectText(text).text.replace(TOKEN_REGEX, ' ').toLowerCase();
  const words = clean.match(/[\p{L}']+/gu) ?? [];
  let fr = (clean.match(/[éèêàçùâîôûëïœ]/g) ?? []).length * 0.5;
  let en = 0;
  for (const raw of words) {
    const w = raw.replace(/^[a-z]'/, '');
    if (FR_WORDS.has(w)) fr++;
    if (EN_WORDS.has(w)) en++;
    if (/^(?:l|d|j|n|qu|c|s|m|t)'/.test(raw)) fr++;
  }
  if (en >= 2 && en > fr * 2) return 'en';
  if (fr >= 1 && fr > en) return 'fr';
  return 'unknown';
}
