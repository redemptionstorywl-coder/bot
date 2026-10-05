import type { EmbedSpec } from '../EmbedService';

/**
 * Traduction automatique — composition (fonctions pures) du message bilingue envoyé sur Discord :
 *  - layout `embed`   : embed français (marqueur 🇫🇷) puis embed anglais (marqueur 🇬🇧) dans le même message ;
 *  - layout `content` : texte anglais ajouté après une ligne de séparation « 🇬🇧 » (dans le texte du message,
 *                       ou dans l'embed lui-même — repli sur un embed anglais séparé si les limites sont dépassées).
 * Toutes les limites Discord sont respectées (troncature sûre).
 */

export const TRANSLATE_LAYOUTS = ['embed', 'content'] as const;
export type TranslateLayout = (typeof TRANSLATE_LAYOUTS)[number];
export const isTranslateLayout = (v: unknown): v is TranslateLayout => TRANSLATE_LAYOUTS.includes(v as TranslateLayout);

/** Réglage serveur « Traduction automatique en anglais » (modèle AutoTranslateSettings). */
export interface AutoTranslateConfig {
  enabled: boolean;
  /** embed : embed anglais sous l'embed français · content : texte anglais après une ligne « 🇬🇧 » */
  layout: TranslateLayout;
}

export const DEFAULT_AUTO_TRANSLATE: Readonly<AutoTranslateConfig> = Object.freeze({ enabled: false, layout: 'embed' });

export const FR_MARK = '🇫🇷';
export const EN_MARK = '🇬🇧';
export const FR_LABEL = `${FR_MARK} Français`;
export const EN_LABEL = `${EN_MARK} English`;
/** Ligne séparant le texte français du texte anglais (layout `content`). */
export const SEPARATOR_LINE = `${EN_MARK} ─────────`;
/** Préfixe d'une valeur de champ anglaise ajoutée sous la valeur française (layout `content`). */
const FIELD_EN_PREFIX = `\n${EN_MARK} `;
const FOOTER_JOIN = ' · ';

export const DISCORD_LIMITS = {
  content: 2000,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  embedTotal: 6000,
  embeds: 10,
  buttonLabel: 80,
  optionLabel: 100,
  optionDescription: 100,
  placeholder: 150,
} as const;

/** Tronque sans couper une paire de substitution UTF-16 (emoji) ; ajoute « … » si coupé. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  let cut = max - 1;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return `${text.slice(0, Math.max(0, cut)).trimEnd()}…`;
}

/** Nombre de caractères comptés par Discord pour la limite de 6000 par message (somme sur les embeds). */
export function embedTextLength(spec: EmbedSpec): number {
  let n = (spec.title?.length ?? 0) + (spec.description?.length ?? 0) + (spec.footer?.text.length ?? 0) + (spec.author?.name.length ?? 0);
  for (const f of spec.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

// ───────────────────────── Texte simple ─────────────────────────

/**
 * Texte bilingue : `fr` + ligne « 🇬🇧 » + `en` (tronqué pour tenir dans `max`).
 * Sans traduction (null, identique) ou sans place pour l'anglais : le texte français est renvoyé tel quel.
 */
export function composeContent(fr: string | undefined | null, en: string | undefined | null, max: number = DISCORD_LIMITS.content): string | undefined {
  const source = fr ?? undefined;
  if (!source || !en || en.trim() === source.trim()) return source;
  const head = `${source}\n\n${SEPARATOR_LINE}\n`;
  if (head.length + 20 > max) return source;
  return head + truncate(en, max - head.length);
}

/** Retire la partie anglaise ajoutée par `composeContent` (rechargement d'un message pour l'éditer). */
export function stripContentTranslation(content: string): string {
  const at = content.indexOf(`\n\n${SEPARATOR_LINE}\n`);
  return at >= 0 ? content.slice(0, at) : content;
}

// ───────────────────────── Embeds ─────────────────────────

/** Textes traduisibles d'un embed, dans un ordre stable (titre, description, footer, auteur, champs nom/valeur). */
export function collectEmbedTexts(spec: EmbedSpec): string[] {
  const out: string[] = [spec.title ?? '', spec.description ?? '', spec.footer?.text ?? '', spec.author?.name ?? ''];
  for (const f of spec.fields ?? []) out.push(f.name, f.value);
  return out;
}

/**
 * Applique les traductions (même ordre que `collectEmbedTexts`, `null` = inchangé) à une copie de l'embed.
 * URLs, couleur, images et horodatage sont conservés. Retourne `null` si rien n'a été traduit.
 */
export function applyEmbedTexts(spec: EmbedSpec, translated: (string | null | undefined)[]): EmbedSpec | null {
  let changed = false;
  const pick = (i: number, original: string, max: number): string => {
    const t = translated[i];
    if (!original || t === null || t === undefined || !t.trim() || t === original) return original;
    changed = true;
    return truncate(t, max);
  };
  const out: EmbedSpec = { ...spec };
  if (spec.title) out.title = pick(0, spec.title, DISCORD_LIMITS.title);
  if (spec.description) out.description = pick(1, spec.description, DISCORD_LIMITS.description);
  if (spec.footer) out.footer = { ...spec.footer, text: pick(2, spec.footer.text, DISCORD_LIMITS.footer) };
  if (spec.author) out.author = { ...spec.author, name: pick(3, spec.author.name, DISCORD_LIMITS.author) };
  if (spec.fields) out.fields = spec.fields.map((f, i) => ({ ...f, name: pick(4 + i * 2, f.name, DISCORD_LIMITS.fieldName), value: pick(5 + i * 2, f.value, DISCORD_LIMITS.fieldValue) }));
  return changed ? out : null;
}

function markFooter(spec: EmbedSpec, mark: string, label: string): EmbedSpec {
  const text = spec.footer?.text ? truncate(`${mark}${FOOTER_JOIN}${spec.footer.text}`, DISCORD_LIMITS.footer) : label;
  return { ...spec, footer: { ...(spec.footer ?? {}), text } };
}

/** Embed français marqué « 🇫🇷 » dans son pied de page. */
export function markFrench(spec: EmbedSpec): EmbedSpec {
  return markFooter(spec, FR_MARK, FR_LABEL);
}

/** Embed anglais marqué « 🇬🇧 » : la grande image reste sur l'embed français (pas de doublon). */
export function markEnglish(spec: EmbedSpec): EmbedSpec {
  const { image: _image, ...rest } = spec;
  return markFooter(rest, EN_MARK, EN_LABEL);
}

/**
 * Layout `content` appliqué à un embed : la traduction est ajoutée dans le même embed
 * (description après la ligne « 🇬🇧 », valeurs de champs, pied de page). `null` si les limites seraient dépassées.
 */
export function mergeEmbedCompact(fr: EmbedSpec, en: EmbedSpec): EmbedSpec | null {
  const englishPart = [en.title && en.title !== fr.title ? `**${en.title}**` : null, en.description && en.description !== fr.description ? en.description : null].filter((x): x is string => !!x).join('\n');
  const out: EmbedSpec = { ...fr };
  if (englishPart) out.description = fr.description ? `${fr.description}\n\n${SEPARATOR_LINE}\n${englishPart}` : `${SEPARATOR_LINE}\n${englishPart}`;
  if (fr.fields) {
    out.fields = fr.fields.map((f, i) => {
      const e = en.fields?.[i];
      if (!e || (e.name === f.name && e.value === f.value)) return f;
      // Nom anglais (s'il diffère) en gras au début de la ligne 🇬🇧 : le nom du champ reste français (édition réversible).
      const englishLine = `${e.name !== f.name ? `**${e.name}** · ` : ''}${e.value}`;
      return { ...f, value: `${f.value}${FIELD_EN_PREFIX}${englishLine}` };
    });
  }
  if (fr.footer?.text && en.footer?.text && en.footer.text !== fr.footer.text) out.footer = { ...fr.footer, text: `${fr.footer.text}${FOOTER_JOIN}${EN_MARK} ${en.footer.text}` };
  if ((out.description?.length ?? 0) > DISCORD_LIMITS.description) return null;
  if ((out.footer?.text.length ?? 0) > DISCORD_LIMITS.footer) return null;
  if (out.fields?.some((f) => f.value.length > DISCORD_LIMITS.fieldValue)) return null;
  if (embedTextLength(out) > DISCORD_LIMITS.embedTotal) return null;
  return out;
}

/** Retire marqueurs et parties anglaises d'un embed rechargé depuis Discord (édition d'un message bilingue). */
export function stripEmbedTranslation(spec: EmbedSpec): EmbedSpec {
  const out: EmbedSpec = { ...spec };
  if (out.description) {
    const at = out.description.indexOf(SEPARATOR_LINE);
    if (at >= 0) out.description = out.description.slice(0, at).trimEnd() || undefined;
  }
  if (out.fields) out.fields = out.fields.map((f) => ({ ...f, value: f.value.split(FIELD_EN_PREFIX)[0] || f.value }));
  if (out.footer?.text) {
    let text = out.footer.text;
    const en = text.indexOf(`${FOOTER_JOIN}${EN_MARK} `);
    if (en >= 0) text = text.slice(0, en);
    if (text === FR_LABEL || text === EN_LABEL) out.footer = out.footer.iconUrl ? { ...out.footer, text: '' } : undefined;
    else out.footer = { ...out.footer, text: text.replace(new RegExp(`^(?:${FR_MARK}|${EN_MARK})${FOOTER_JOIN}`), '') };
    if (out.footer && !out.footer.text) out.footer = undefined;
  }
  return out;
}

/** Vrai si l'embed (pied de page) est une version anglaise ajoutée automatiquement. */
export function isEnglishEmbed(footerText: string | null | undefined): boolean {
  return !!footerText && (footerText === EN_LABEL || footerText.startsWith(`${EN_MARK}${FOOTER_JOIN}`));
}

/**
 * Compose la liste d'embeds bilingue. `en[i]` = traduction de `fr[i]` (null = pas de traduction).
 * Garantit ≤ 10 embeds et ≤ 6000 caractères au total : les embeds anglais sont raccourcis, puis retirés si nécessaire.
 */
export function composeEmbeds(fr: EmbedSpec[], en: (EmbedSpec | null)[], layout: TranslateLayout): EmbedSpec[] {
  type Slot = { spec: EmbedSpec; original: EmbedSpec; english: boolean; partner?: number };
  const slots: Slot[] = [];
  fr.forEach((spec, i) => {
    const tr = en[i];
    if (!tr) {
      slots.push({ spec, original: spec, english: false });
      return;
    }
    if (layout === 'content') {
      const merged = mergeEmbedCompact(spec, tr);
      if (merged) {
        slots.push({ spec: merged, original: spec, english: false });
        return;
      }
    }
    const frIndex = slots.length;
    slots.push({ spec: markFrench(spec), original: spec, english: false });
    slots.push({ spec: markEnglish(tr), original: spec, english: true, partner: frIndex });
  });
  const drop = (index: number) => {
    const slot = slots[index]!;
    if (slot.partner !== undefined) slots[slot.partner]!.spec = slots[slot.partner]!.original;
    slots.splice(index, 1);
  };
  // 10 embeds maximum : les embeds anglais en trop sont retirés (en partant de la fin).
  for (let i = slots.length - 1; i >= 0 && slots.length > DISCORD_LIMITS.embeds; i--) if (slots[i]!.english) drop(i);
  // 6000 caractères au total : on raccourcit la description des embeds anglais, puis on les retire.
  const total = () => slots.reduce((n, s) => n + embedTextLength(s.spec), 0);
  for (let i = slots.length - 1; i >= 0 && total() > DISCORD_LIMITS.embedTotal; i--) {
    const slot = slots[i]!;
    if (!slot.english) continue;
    const overflow = total() - DISCORD_LIMITS.embedTotal;
    const desc = slot.spec.description ?? '';
    if (desc.length - overflow >= 80) slot.spec = { ...slot.spec, description: truncate(desc, desc.length - overflow) };
    else drop(i);
  }
  return slots.slice(0, DISCORD_LIMITS.embeds).map((s) => s.spec);
}

// ───────────────────────── Composants (menus, boutons) ─────────────────────────

/** « FR / EN » si cela tient dans `max` et que les deux diffèrent, sinon le texte français. */
export function bilingualLabel(fr: string, en: string | null | undefined, max: number): string {
  if (!en || en.trim() === fr.trim()) return truncate(fr, max);
  const combined = `${fr} / ${en}`;
  return combined.length <= max ? combined : truncate(fr, max);
}

/**
 * Option de menu déroulant bilingue (raisons de ticket) :
 *  - libellé « FR / EN » s'il tient en 100 caractères, sinon le libellé français ;
 *  - description « FR / EN » si elle tient, sinon la description anglaise ; sans description française
 *    et libellé non combiné, la description porte le libellé anglais.
 */
export function bilingualOption(fr: { label: string; description?: string | null }, en: { label?: string | null; description?: string | null }): { label: string; description?: string } {
  const label = bilingualLabel(fr.label, en.label, DISCORD_LIMITS.optionLabel);
  const combinedLabel = label !== truncate(fr.label, DISCORD_LIMITS.optionLabel);
  const max = DISCORD_LIMITS.optionDescription;
  if (fr.description) {
    if (!en.description || en.description === fr.description) return { label, description: truncate(fr.description, max) };
    const both = `${fr.description} / ${en.description}`;
    return { label, description: both.length <= max ? both : truncate(en.description, max) };
  }
  if (!combinedLabel && en.label && en.label !== fr.label) return { label, description: truncate(`${EN_MARK} ${en.label}`, max) };
  return { label };
}
