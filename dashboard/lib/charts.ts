/**
 * Modèles de graphiques rendus côté serveur (SVG + étiquettes HTML positionnées en %), conformes au skill dataviz :
 * une seule échelle par graphique, graduations « rondes », marques fines (barres ≤ 24 px, extrémité arrondie 4 px ancrée
 * à la ligne de base, lignes 2 px), couleurs par emplacement de série (--series-1…3, palette validée), jamais de double axe.
 * Les vues : partials/chart-mirror.ejs, chart-line.ejs, chart-hbars.ejs ; l'infobulle : public/js/charts.js.
 */

/** Largeur / hauteur du repère SVG (étiré en largeur via preserveAspectRatio="none", traits non mis à l'échelle). */
export const PLOT_W = 600;
export const PLOT_H = 200;

export interface ChartSeries {
  key: string;
  label: string;
  /** Emplacement dans la palette catégorielle (ordre fixe : 1 violet, 2 sarcelle, 3 cuivre) */
  slot: 1 | 2 | 3;
  values: number[];
}

export interface DayAxis {
  /** Clés AAAA-MM-JJ dans le fuseau du serveur */
  keys: string[];
  /** Étiquette courte (axe) : « 5 oct. » */
  short: string[];
  /** Étiquette longue (infobulle, tableau) : « dim. 5 oct. » */
  long: string[];
}

function dayKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Axe des N derniers jours (aujourd'hui inclus), dans le fuseau du serveur. */
export function dayAxis(days: number, timeZone: string, now: Date = new Date()): DayAxis {
  const [y, m, d] = dayKey(now, timeZone).split('-').map(Number) as [number, number, number];
  const keys: string[] = [];
  const short: string[] = [];
  const long: string[] = [];
  // Midi UTC de chaque jour calendaire : même date dans tous les fuseaux usuels, pas d'effet des changements d'heure.
  const fmtShort = safeFormatter({ timeZone: 'UTC', day: 'numeric', month: 'short' });
  const fmtLong = safeFormatter({ timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(y, m - 1, d - i, 12));
    keys.push(date.toISOString().slice(0, 10));
    short.push(fmtShort.format(date));
    long.push(fmtLong.format(date));
  }
  return { keys, short, long };
}

function safeFormatter(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('fr-FR', opts);
  } catch {
    const { timeZone: _tz, ...rest } = opts;
    return new Intl.DateTimeFormat('fr-FR', rest);
  }
}

/** Compte les dates par jour de l'axe (les dates hors période sont ignorées). */
export function bucketByDay(dates: Iterable<Date | null | undefined>, axis: DayAxis, timeZone: string): number[] {
  const index = new Map(axis.keys.map((k, i) => [k, i]));
  const out = axis.keys.map(() => 0);
  for (const d of dates) {
    if (!d) continue;
    const i = index.get(dayKey(d, timeZone));
    if (i !== undefined) out[i]! += 1;
  }
  return out;
}

export interface NiceScale {
  max: number;
  step: number;
  ticks: number[];
}

/** Échelle « ronde » à partir de 0 : `count` intervalles égaux (graduations entières, pas de 1, 2, 2,5, 3, 4, 5 × 10^n). */
export function niceScale(rawMax: number, count = 4): NiceScale {
  const max = Math.max(0, rawMax);
  if (max === 0) return { max: count, step: 1, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const rough = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 3, 4, 5, 10].map((m) => m * pow).filter((s) => s >= 1 && Number.isInteger(s) && s * count >= max);
  const step = candidates.length ? Math.min(...candidates) : Math.max(1, Math.ceil(rough));
  return { max: step * count, step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface AxisLabel {
  left: number;
  text: string;
  align: 'start' | 'middle' | 'end';
  /** Étiquette secondaire, masquée sur les écrans étroits */
  minor: boolean;
}

/** Étiquettes de l'axe X : une par semaine environ, première et dernière comprises, positionnées au centre des colonnes. */
export function xLabels(axis: DayAxis, every = 7): AxisLabel[] {
  const n = axis.keys.length;
  if (!n) return [];
  const picks: number[] = [];
  for (let i = n - 1; i >= 0; i -= every) picks.push(i);
  const first = picks[picks.length - 1]!;
  if (first > Math.floor(every / 2)) picks.push(0);
  else picks[picks.length - 1] = 0;
  const sortedPicks = picks.sort((a, b) => a - b);
  const middle = sortedPicks[Math.floor(sortedPicks.length / 2)];
  return sortedPicks.map((i) => ({
    left: round(((i + 0.5) / n) * 100),
    text: axis.short[i] ?? '',
    align: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle',
    minor: i !== 0 && i !== n - 1 && i !== middle,
  }));
}

export interface BarMark {
  i: number;
  slot: 1 | 2 | 3;
  d: string;
}

export interface TooltipData {
  labels: string[];
  series: { label: string; slot: 1 | 2 | 3; values: number[]; sign?: string }[];
}

export interface MirrorChartModel {
  kind: 'mirror';
  id: string;
  n: number;
  empty: boolean;
  /** Graduations de l'axe Y du haut vers le bas (ex. 4, 2, 0, 2, 4) */
  yTicks: string[];
  /** Positions des lignes de grille en unités du repère (y) */
  gridY: number[];
  baselineY: number;
  bars: BarMark[];
  xLabels: AxisLabel[];
  up: ChartSeries;
  down: ChartSeries;
  totals: { up: number; down: number; net: number };
  tooltip: TooltipData;
  days: { label: string; up: number; down: number }[];
}

/** Chemin d'une colonne à extrémité arrondie (rayon 4) et base carrée, vers le haut (dir -1) ou le bas (dir 1). */
function columnPath(x: number, w: number, base: number, h: number, dir: -1 | 1): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  const end = base + dir * h;
  const yr = end - dir * r;
  return `M${round(x)} ${round(base)}V${round(yr)}Q${round(x)} ${round(end)} ${round(x + r)} ${round(end)}H${round(x + w - r)}Q${round(x + w)} ${round(end)} ${round(x + w)} ${round(yr)}V${round(base)}Z`;
}

/**
 * Colonnes en miroir autour d'une ligne de base : `up` au-dessus (ex. arrivées), `down` en dessous (ex. départs).
 * Même échelle des deux côtés (une seule échelle, graduations symétriques).
 */
export function mirrorChart(id: string, axis: DayAxis, up: ChartSeries, down: ChartSeries): MirrorChartModel {
  const n = axis.keys.length;
  const maxUp = Math.max(0, ...up.values);
  const maxDown = Math.max(0, ...down.values);
  const scale = niceScale(Math.max(maxUp, maxDown), 2);
  const mid = PLOT_H / 2;
  const slotW = PLOT_W / Math.max(1, n);
  const barW = Math.min(slotW * 0.62, 24);
  const bars: BarMark[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * slotW + (slotW - barW) / 2;
    const hu = ((up.values[i] ?? 0) / scale.max) * (mid - 1);
    const hd = ((down.values[i] ?? 0) / scale.max) * (mid - 1);
    if (hu > 0) bars.push({ i, slot: up.slot, d: columnPath(x, barW, mid - 1, Math.max(hu, 1.5), -1) });
    if (hd > 0) bars.push({ i, slot: down.slot, d: columnPath(x, barW, mid + 1, Math.max(hd, 1.5), 1) });
  }
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const tUp = sum(up.values);
  const tDown = sum(down.values);
  const fmt = (v: number) => v.toLocaleString('fr-FR');
  return {
    kind: 'mirror',
    id,
    n,
    empty: tUp + tDown === 0,
    yTicks: [fmt(scale.max), fmt(scale.max / 2), '0', fmt(scale.max / 2), fmt(scale.max)],
    gridY: [0, mid / 2, mid + mid / 2, PLOT_H],
    baselineY: mid,
    bars,
    xLabels: xLabels(axis),
    up,
    down,
    totals: { up: tUp, down: tDown, net: tUp - tDown },
    tooltip: { labels: axis.long, series: [{ label: up.label, slot: up.slot, values: up.values, sign: '+' }, { label: down.label, slot: down.slot, values: down.values, sign: '−' }] },
    days: axis.long.map((label, i) => ({ label, up: up.values[i] ?? 0, down: down.values[i] ?? 0 })),
  };
}

export interface ColumnChartModel {
  kind: 'columns';
  id: string;
  n: number;
  empty: boolean;
  yTicks: string[];
  gridY: number[];
  bars: BarMark[];
  xLabels: AxisLabel[];
  series: ChartSeries;
  total: number;
  tooltip: TooltipData & { currency?: string };
  days: { label: string; value: number }[];
}

/**
 * Colonnes d'une seule série (pas de légende : le titre la nomme), ancrées à la ligne de base, extrémité arrondie 4 px.
 * `format(v)` met en forme les graduations (ex. montants) ; `currency` est transmis à l'infobulle.
 */
export function columnChart(id: string, axis: DayAxis, series: ChartSeries, opts: { format?: (v: number) => string; currency?: string } = {}): ColumnChartModel {
  const n = axis.keys.length;
  const scale = niceScale(Math.max(0, ...series.values), 4);
  const slotW = PLOT_W / Math.max(1, n);
  const barW = Math.min(slotW * 0.62, 24);
  const bars: BarMark[] = [];
  series.values.forEach((v, i) => {
    if (v <= 0) return;
    const h = Math.max((v / scale.max) * PLOT_H, 1.5);
    bars.push({ i, slot: series.slot, d: columnPath(i * slotW + (slotW - barW) / 2, barW, PLOT_H, h, -1) });
  });
  const fmt = opts.format ?? ((v: number) => v.toLocaleString('fr-FR'));
  return {
    kind: 'columns',
    id,
    n,
    empty: series.values.every((v) => v === 0),
    yTicks: [...scale.ticks].reverse().map(fmt),
    gridY: scale.ticks.map((t) => round(PLOT_H - (t / scale.max) * PLOT_H)),
    bars,
    xLabels: xLabels(axis),
    series,
    total: series.values.reduce((a, v) => a + v, 0),
    tooltip: { labels: axis.long, series: [{ label: series.label, slot: series.slot, values: series.values }], currency: opts.currency },
    days: axis.long.map((label, i) => ({ label, value: series.values[i] ?? 0 })),
  };
}

export interface LineChartModel {
  kind: 'line';
  id: string;
  n: number;
  empty: boolean;
  yTicks: string[];
  gridY: number[];
  lines: { slot: 1 | 2 | 3; d: string; area: string; endX: number; endY: number }[];
  /** Étiquettes directes en bout de ligne (omises si elles se chevauchent : légende + infobulle prennent le relais) */
  endLabels: { slot: 1 | 2 | 3; label: string; value: number; top: number }[];
  xLabels: AxisLabel[];
  series: ChartSeries[];
  totals: number[];
  tooltip: TooltipData;
  days: { label: string; values: number[] }[];
}

/** Courbes multi-séries (2 px) sur une échelle commune ; aire à 10 % pour la première série seulement. */
export function lineChart(id: string, axis: DayAxis, series: ChartSeries[]): LineChartModel {
  const n = axis.keys.length;
  const scale = niceScale(Math.max(0, ...series.flatMap((s) => s.values)), 4);
  const slotW = PLOT_W / Math.max(1, n);
  const xAt = (i: number) => round((i + 0.5) * slotW);
  const yAt = (v: number) => round(PLOT_H - (v / scale.max) * PLOT_H);
  const lines = series.map((s, si) => {
    const pts = s.values.map((v, i) => `${xAt(i)} ${yAt(v)}`);
    const d = pts.length ? `M${pts.join('L')}` : '';
    const area = si === 0 && pts.length ? `M${xAt(0)} ${PLOT_H}L${pts.join('L')}L${xAt(n - 1)} ${PLOT_H}Z` : '';
    return { slot: s.slot, d, area, endX: xAt(n - 1), endY: yAt(s.values[n - 1] ?? 0) };
  });
  let endLabels = series.map((s, si) => ({ slot: s.slot, label: s.label, value: s.values[n - 1] ?? 0, top: round(((lines[si]?.endY ?? PLOT_H) / PLOT_H) * 100) }));
  const sorted = [...endLabels].sort((a, b) => a.top - b.top);
  const collide = sorted.some((l, i) => i > 0 && l.top - sorted[i - 1]!.top < 12);
  if (collide) endLabels = [];
  const fmt = (v: number) => v.toLocaleString('fr-FR');
  return {
    kind: 'line',
    id,
    n,
    empty: series.every((s) => s.values.every((v) => v === 0)),
    yTicks: [...scale.ticks].reverse().map(fmt),
    gridY: scale.ticks.map((t) => yAt(t)),
    lines,
    endLabels,
    xLabels: xLabels(axis),
    series,
    totals: series.map((s) => s.values.reduce((a, v) => a + v, 0)),
    tooltip: { labels: axis.long, series: series.map((s) => ({ label: s.label, slot: s.slot, values: s.values })) },
    days: axis.long.map((label, i) => ({ label, values: series.map((s) => s.values[i] ?? 0) })),
  };
}

export interface HBarsModel {
  kind: 'hbars';
  id: string;
  empty: boolean;
  rows: { label: string; value: number; pct: number }[];
  ticks: string[];
  total: number;
}

/** Barres horizontales d'une seule série, triées par valeur décroissante, valeur au bout de la barre. */
export function hbarsChart(id: string, rows: { label: string; value: number }[]): HBarsModel {
  const kept = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const scale = niceScale(Math.max(0, ...kept.map((r) => r.value)), 4);
  return {
    kind: 'hbars',
    id,
    empty: kept.length === 0,
    rows: kept.map((r) => ({ ...r, pct: round((r.value / scale.max) * 100) })),
    ticks: scale.ticks.map((t) => t.toLocaleString('fr-FR')),
    total: kept.reduce((s, r) => s + r.value, 0),
  };
}
