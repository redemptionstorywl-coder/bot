/** Conversion entre `<input type="datetime-local">` et Date, dans le fuseau horaire du serveur Discord. */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Décalage (ms) entre l'heure UTC et l'heure locale du fuseau à l'instant `date`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour === 24 ? 0 : parts.hour!, parts.minute!, parts.second!);
  return asUtc - date.getTime();
}

/**
 * Interprète une valeur `AAAA-MM-JJTHH:mm` comme une heure locale du fuseau `timeZone`
 * (défaut : Europe/Paris) et retourne la Date correspondante. `null` si invalide.
 */
export function parseLocalDateTime(value: string, timeZone = 'Europe/Paris'): Date | null {
  const m = LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const tz = isValidTimeZone(timeZone) ? timeZone : 'Europe/Paris';
  const [, y, mo, d, h, mi, s] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (Number.isNaN(guess)) return null;
  let result = guess - tzOffsetMs(new Date(guess), tz);
  // Deuxième passe pour les changements d'heure (DST)
  result = guess - tzOffsetMs(new Date(result), tz);
  const date = new Date(result);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date → valeur `AAAA-MM-JJTHH:mm` dans le fuseau donné (pré-remplissage des champs datetime-local). */
export function toLocalInputValue(value: Date | string | number | null | undefined, timeZone = 'Europe/Paris'): string {
  if (value === null || value === undefined) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const tz = isValidTimeZone(timeZone) ? timeZone : 'Europe/Paris';
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}
