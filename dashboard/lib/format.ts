/** Helpers de formatage exposés aux vues via `res.locals.fmt`. */

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: process.env.TZ || 'Europe/Paris' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.TZ || 'Europe/Paris' });
const numberFmt = new Intl.NumberFormat('fr-FR');

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const fmt = {
  date(value: Date | string | number | null | undefined): string {
    const d = toDate(value);
    return d ? dateFmt.format(d) : '—';
  },
  dateTime(value: Date | string | number | null | undefined): string {
    const d = toDate(value);
    return d ? dateTimeFmt.format(d) : '—';
  },
  /** Date relative courte : "il y a 3 min", "dans 2 h"… */
  relative(value: Date | string | number | null | undefined, now = Date.now()): string {
    const d = toDate(value);
    if (!d) return '—';
    const diff = d.getTime() - now;
    const abs = Math.abs(diff);
    const units: [number, string][] = [
      [60_000, 's'],
      [3_600_000, 'min'],
      [86_400_000, 'h'],
      [2_592_000_000, 'j'],
      [31_536_000_000, 'mois'],
    ];
    let value_ = Math.round(abs / 1000);
    let unit = 's';
    for (let i = 0; i < units.length; i++) {
      if (abs < units[i][0]) break;
      const next = units[i + 1];
      value_ = Math.round(abs / units[i][0]);
      unit = next ? next[1] : 'an';
    }
    if (abs < 60_000) return diff <= 0 ? "à l'instant" : 'dans quelques secondes';
    return diff < 0 ? `il y a ${value_} ${unit}` : `dans ${value_} ${unit}`;
  },
  number(value: number | bigint | null | undefined): string {
    return value === null || value === undefined ? '0' : numberFmt.format(value);
  },
  /** Durée en secondes → "2 j 3 h 4 min" */
  duration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const d = Math.floor(s / 86_400);
    const h = Math.floor((s % 86_400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts: string[] = [];
    if (d) parts.push(`${d} j`);
    if (h) parts.push(`${h} h`);
    if (m || !parts.length) parts.push(`${m} min`);
    return parts.join(' ');
  },
  json(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2) ?? '';
    } catch {
      return String(value);
    }
  },
  truncate(value: string | null | undefined, max = 80): string {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  },
  /** Couleur numérique Discord → #RRGGBB */
  hex(color: number | string | null | undefined): string {
    if (typeof color === 'string') return color.startsWith('#') ? color : `#${color}`;
    if (typeof color !== 'number') return '#7C3AED';
    return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
  },
  percent(part: number, total: number): number {
    if (!total) return 0;
    return Math.round((part / total) * 1000) / 10;
  },
  /** Premières lettres d'un nom (avatar de secours). */
  initials(name: string | null | undefined): string {
    if (!name) return '?';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  },
};

export type Formatters = typeof fmt;

/** URL d'avatar Discord (CDN) avec repli sur l'avatar par défaut. */
export function avatarUrl(userId: string, avatar: string | null | undefined, size = 64): string {
  if (avatar) return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${avatar.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** URL d'icône de serveur Discord (CDN) ; null si pas d'icône. */
export function guildIconUrl(guildId: string, icon: string | null | undefined, size = 128): string | null {
  if (!icon) return null;
  if (icon.startsWith('http')) return icon;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${icon.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
}
