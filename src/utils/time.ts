const UNITS: Record<string, number> = {
  s: 1,
  sec: 1,
  m: 60,
  min: 60,
  h: 3600,
  hr: 3600,
  d: 86400,
  j: 86400,
  w: 604800,
  sem: 604800,
  mo: 2592000,
  y: 31536000,
  an: 31536000,
};

/**
 * Parse une durée humaine ("1h30m", "2d", "45 min", "1w") en secondes.
 * Retourne null si invalide.
 */
export function parseDuration(input: string): number | null {
  if (!input) return null;
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(cleaned)) return Number(cleaned) * 60; // nombre seul = minutes
  const regex = /(\d+(?:\.\d+)?)(mo|sem|min|sec|hr|an|[smhdjwy])/g;
  let total = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  while ((m = regex.exec(cleaned)) !== null) {
    const value = parseFloat(m[1]!);
    const unit = UNITS[m[2]!];
    if (unit === undefined) return null;
    total += value * unit;
    matched += m[0];
  }
  if (matched !== cleaned || total <= 0) return null;
  return Math.floor(total);
}

/** Formate une durée en secondes en texte court ("1j 2h 3m"). */
export function formatDuration(seconds: number, lang = 'fr'): string {
  if (seconds < 0) seconds = 0;
  const units: [number, string, string][] = [
    [86400, 'j', 'd'],
    [3600, 'h', 'h'],
    [60, 'm', 'm'],
    [1, 's', 's'],
  ];
  const parts: string[] = [];
  let rest = Math.floor(seconds);
  for (const [size, fr, en] of units) {
    if (rest >= size) {
      const n = Math.floor(rest / size);
      rest %= size;
      parts.push(`${n}${lang === 'fr' ? fr : en}`);
    }
    if (parts.length === 3) break;
  }
  return parts.length ? parts.join(' ') : `0s`;
}

/** Timestamp Discord `<t:unix:style>` */
export function discordTimestamp(date: Date | number, style: 'R' | 'F' | 'f' | 'D' | 'd' | 'T' | 't' = 'F'): string {
  const unix = Math.floor((typeof date === 'number' ? date : date.getTime()) / 1000);
  return `<t:${unix}:${style}>`;
}

/**
 * Parse une date fournie par un humain : "2025-01-31 20:00", "31/01/2025 20:00", "in 2h", "+30m".
 * Retourne null si invalide.
 */
export function parseDateInput(input: string, now: Date = new Date()): Date | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^(in|\+|dans)\s*/i.test(raw)) {
    const dur = parseDuration(raw.replace(/^(in|\+|dans)\s*/i, ''));
    return dur ? new Date(now.getTime() + dur * 1000) : null;
  }
  const fr = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:h](\d{2})?)?$/);
  if (fr) {
    const [, d, mo, y, h = '0', mi = '0'] = fr;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi || '0'));
    return isNaN(date.getTime()) ? null : date;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0'] = iso;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    return isNaN(date.getTime()) ? null : date;
  }
  const generic = new Date(raw);
  return isNaN(generic.getTime()) ? null : generic;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
