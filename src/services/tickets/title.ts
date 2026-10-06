/**
 * Tickets — fonctions pures du titre saisi à l'ouverture :
 *  - titre → nom de salon Discord (minuscules, espaces → `-`, accents et emojis conservés, caractères interdits retirés, ≤ 100) ;
 *  - suffixe `-<numéro>` uniquement si un salon porte déjà ce nom ;
 *  - composition du formulaire d'ouverture (titre + questions de la raison + message facultatif) dans la limite de 5 champs.
 */

/** Longueur max du titre saisi par le membre. */
export const TICKET_TITLE_MAX = 50;
/** Longueur max du message facultatif (posté en embed dans le ticket). */
export const TICKET_MESSAGE_MAX = 2000;
/** Limite Discord : champs par modal. */
export const MODAL_INPUT_LIMIT = 5;
/** Questions par raison : le titre prend toujours une place du formulaire. */
export const MAX_TYPE_QUESTIONS = MODAL_INPUT_LIMIT - 1;
/** Limite Discord : longueur d'un nom de salon. */
export const CHANNEL_NAME_MAX = 100;

/**
 * Caractères conservés : lettres (accents compris), chiffres, marques combinantes, emojis (pictogrammes, drapeaux,
 * teintes de peau, ZWJ, sélecteur de variante), `-` et `_`. Tout le reste (ponctuation, symboles ASCII, guillemets…) est retiré.
 */
const FORBIDDEN = /[^\p{L}\p{N}\p{M}\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F_-]/gu;

/** Coupe à `max` unités UTF-16 sans casser un emoji (paire de substitution). */
function cut(s: string, max: number): string {
  let out = '';
  for (const ch of Array.from(s)) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * Titre → nom de salon. Retourne `null` si rien d'exploitable ne reste (le nom par défaut de la raison est alors utilisé).
 * Ex. « Problème de connexion 🔌 » → `problème-de-connexion-🔌`.
 */
export function slugifyTicketTitle(title: string): string | null {
  const slug = title
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(FORBIDDEN, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  const trimmed = cut(slug, CHANNEL_NAME_MAX).replace(/[-_]+$/g, '');
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(trimmed) ? trimmed : null;
}

/** Nom libre : `base` s'il n'est pas déjà pris, sinon `base-<suffix>` (raccourci pour tenir dans 100 caractères). */
export function uniqueChannelName(base: string, taken: Iterable<string>, suffix: string | number): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  const tail = `-${suffix}`;
  return `${cut(base, CHANNEL_NAME_MAX - tail.length).replace(/[-_]+$/g, '')}${tail}`;
}

/**
 * Champs du formulaire d'ouverture : le titre (obligatoire) en premier, puis les questions de la raison, puis le message
 * facultatif s'il reste une place. Au-delà de 5 champs, les questions en trop ne sont pas posées.
 */
export function planOpenModal<Q>(questions: readonly Q[]): { questions: Q[]; message: boolean; dropped: number } {
  const kept = questions.slice(0, MAX_TYPE_QUESTIONS);
  return { questions: kept, message: 1 + kept.length < MODAL_INPUT_LIMIT, dropped: questions.length - kept.length };
}
