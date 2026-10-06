import { prisma } from '../../src/database/client';

/**
 * Statistiques de tickets complémentaires (lecture seule) non exposées par TicketService :
 * temps de première réponse du staff, activité quotidienne, staff le plus actif.
 * Requêtes bornées (derniers tickets / derniers jours) pour rester légères.
 */

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export interface FirstResponseStats {
  /** Moyenne (secondes) du délai entre l'ouverture et le premier message d'un membre du staff ; null si non calculable */
  avgSeconds: number | null;
  medianSeconds: number | null;
  /** Nombre de tickets pris en compte */
  sample: number;
}

/** Temps de première réponse calculé sur les 100 derniers tickets disposant d'un transcript (staff identifié). */
export async function firstResponseStats(guildId: string): Promise<FirstResponseStats> {
  const tickets = (await prisma.ticket.findMany({
    where: { guildId, transcript: { isNot: null } },
    select: { id: true, userId: true, createdAt: true, transcript: { select: { staffIds: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })) ?? [];
  if (!tickets.length) return { avgSeconds: null, medianSeconds: null, sample: 0 };
  const rawFirsts: unknown = await prisma.ticketMessage.groupBy({
    by: ['ticketId', 'authorId'],
    where: { ticketId: { in: tickets.map((t) => t.id) } },
    _min: { createdAt: true },
  });
  const firsts = (rawFirsts ?? []) as { ticketId: number; authorId: string; _min: { createdAt: Date | null } }[];
  const delays: number[] = [];
  for (const t of tickets) {
    const staff = new Set(asIds(t.transcript?.staffIds).filter((id) => id !== t.userId));
    if (!staff.size) continue;
    let first: number | null = null;
    for (const g of firsts) {
      if (g.ticketId !== t.id || !staff.has(g.authorId) || !g._min.createdAt) continue;
      const at = new Date(g._min.createdAt).getTime();
      if (first === null || at < first) first = at;
    }
    if (first !== null) delays.push(Math.max(0, Math.round((first - new Date(t.createdAt).getTime()) / 1000)));
  }
  if (!delays.length) return { avgSeconds: null, medianSeconds: null, sample: 0 };
  delays.sort((a, b) => a - b);
  const avg = Math.round(delays.reduce((a, b) => a + b, 0) / delays.length);
  return { avgSeconds: avg, medianSeconds: delays[Math.floor(delays.length / 2)] ?? avg, sample: delays.length };
}

export interface DailyPoint {
  key: string;
  label: string;
  opened: number;
  closed: number;
}

/** Tickets ouverts / fermés par jour sur `days` jours (fuseau du serveur). */
export async function dailyActivity(guildId: string, timezone: string, days = 14): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const rows = (await prisma.ticket.findMany({
    where: { guildId, OR: [{ createdAt: { gte: since } }, { closedAt: { gte: since } }] },
    select: { createdAt: true, closedAt: true },
    take: 5000,
  })) ?? [];
  let fmtKey: Intl.DateTimeFormat;
  try {
    fmtKey = new Intl.DateTimeFormat('fr-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    fmtKey = new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const points: DailyPoint[] = [];
  const index = new Map<string, DailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = fmtKey.format(d);
    const [, m, day] = key.split('-');
    const p = { key, label: `${day}/${m}`, opened: 0, closed: 0 };
    points.push(p);
    index.set(key, p);
  }
  for (const r of rows) {
    const o = index.get(fmtKey.format(new Date(r.createdAt)));
    if (o) o.opened++;
    if (r.closedAt) {
      const c = index.get(fmtKey.format(new Date(r.closedAt)));
      if (c) c.closed++;
    }
  }
  return points;
}

/** Membres ayant fermé le plus de tickets (le créateur d'un ticket qui le ferme lui-même n'est pas compté). */
export async function topClosers(guildId: string, limit = 5): Promise<{ userId: string; count: number }[]> {
  const rawRows: unknown = await prisma.ticket.findMany({
    where: { guildId, closedById: { not: null } },
    select: { userId: true, closedById: true },
    take: 50_000,
  });
  const counts = new Map<string, number>();
  for (const r of (rawRows ?? []) as { userId: string; closedById: string | null }[]) {
    if (!r.closedById || r.closedById === r.userId) continue;
    counts.set(r.closedById, (counts.get(r.closedById) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
