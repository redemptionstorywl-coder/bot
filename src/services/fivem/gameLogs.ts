import { BRAND } from '../../config/constants';
import { formatDuration } from '../../utils/time';
import type { Translator } from '../TranslationService';
import type { GameRouteKey } from '../logs/routes';
import { GAME_LOG_CHANNELS, type GameLogChannel, type GameLogEntry, type GameLogType } from './schemas';

/**
 * Rendu des logs en jeu (POST /logs, entrées générées par le bot) en embeds propres (fonctions pures, testées dans
 * tests/fivem/gameLogs.test.ts). Identifiants masqués : seuls `license:` (raccourci) et `discord:` (mention) sont affichés.
 */

export const GAME_ROUTE_BY_TYPE: Readonly<Record<GameLogType, GameRouteKey>> = {
  connect: 'game.connections',
  disconnect: 'game.connections',
  account: 'game.accounts',
  kill: 'game.kills',
  death: 'game.kills',
  match_start: 'game.matches',
  match_end: 'game.matches',
  ban: 'game.sanctions',
  kick: 'game.sanctions',
  warn: 'game.sanctions',
  unban: 'game.sanctions',
  admin: 'game.admin',
  chat: 'game.chat',
  anticheat: 'game.anticheat',
  server: 'game.server',
  custom: 'game.server',
};

/** Types non conservés en base (volume) : Discord uniquement. */
export const GAME_LOG_NO_DATABASE: ReadonlySet<GameLogType> = new Set<GameLogType>(['kill', 'death', 'chat']);

export const SERVER_EVENTS = ['start', 'stop', 'restart_scheduled', 'shutdown', 'announcement', 'resource_start', 'resource_stop', 'error', 'online', 'offline'] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];
export const ACCOUNT_EVENTS = ['created', 'name', 'discord_rename'] as const;
export type AccountEvent = (typeof ACCOUNT_EVENTS)[number];

export interface GamePlayer {
  id: number | null;
  name: string | null;
  license: string | null;
  discordId: string | null;
}

export interface RenderContext {
  t: Translator;
  lang: string;
  /** Licence → ID Discord connu (FiveMPlayer) */
  discordByLicense?: ReadonlyMap<string, string>;
  /** Licence → dernier pseudo connu (FiveMPlayer), quand l'entrée n'a que des identifiants (sanctions) */
  nameByLicense?: ReadonlyMap<string, string>;
}

export interface RenderedGameLog {
  action: `game.${GameLogType}`;
  route: GameRouteKey;
  title: string;
  description?: string;
  fields: { name: string; value: string; inline?: boolean }[];
  color: number;
  skipDatabase: boolean;
  targetId: string | null;
  actorId: string | null;
  data: Record<string, unknown>;
}

const DISCORD_ID = /^\d{15,22}$/;

const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Texte affichable : codes couleur FiveM (^1, ~r~) retirés, espaces normalisés, longueur bornée. */
export function cleanText(v: unknown, max = 256): string | null {
  if (v === null || v === undefined) return null;
  const s = (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')
    .replace(/\^\d/g, '')
    .replace(/~[a-zA-Z]~/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? cut(s, max) : null;
}

/** `license:0123456789abcdef…` → `license:0123…cdef` */
export function shortLicense(license: string | null | undefined): string | null {
  if (!license) return null;
  const m = /^(license2?):([a-z0-9]+)$/i.exec(license.trim());
  if (!m) return null;
  const hash = m[2]!;
  return `${m[1]!.toLowerCase()}:${hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Joueur à partir d'un objet `{ id, name, identifiers, discordId }`, d'un nom, ou des champs à plat de `data`. */
export function parsePlayer(v: unknown, ctx: Pick<RenderContext, 'discordByLicense' | 'nameByLicense'> = {}): GamePlayer | null {
  if (typeof v === 'string' || typeof v === 'number') {
    const name = cleanText(v, 64);
    return name ? { id: null, name, license: null, discordId: null } : null;
  }
  const r = asRecord(v);
  if (!r) return null;
  const ids = Array.isArray(r.identifiers) ? r.identifiers.filter((x): x is string => typeof x === 'string') : [];
  const license = ids.find((i) => i.startsWith('license:')) ?? ids.find((i) => i.startsWith('license2:')) ?? (typeof r.license === 'string' ? r.license : null);
  const fromIds = ids.find((i) => i.startsWith('discord:'))?.slice(8) ?? null;
  const explicit = typeof r.discordId === 'string' ? r.discordId : typeof r.discord === 'string' ? r.discord.replace(/^discord:/, '') : null;
  const discordId = [explicit, fromIds, license ? (ctx.discordByLicense?.get(license) ?? null) : null].find((d): d is string => !!d && DISCORD_ID.test(d)) ?? null;
  const id = num(r.id ?? r.source);
  const name = cleanText(r.name, 64) ?? (license ? cleanText(ctx.nameByLicense?.get(license), 64) : null);
  if (!name && id === null && !license && !discordId) return null;
  return { id: id !== null ? Math.trunc(id) : null, name, license: license ?? null, discordId };
}

/** `**Pseudo** (#12) · @Discord · license:0123…cdef` */
export function playerLine(p: GamePlayer | null, t: Translator): string {
  if (!p) return t('loghub.game.unknown_player');
  const parts = [`**${p.name ?? t('loghub.game.unknown_player')}**${p.id !== null ? ` (#${p.id})` : ''}`];
  parts.push(p.discordId ? `<@${p.discordId}>` : t('loghub.game.not_linked'));
  const lic = shortLicense(p.license);
  if (lic) parts.push(`\`${lic}\``);
  return parts.join(' · ');
}

/** Licences présentes dans un lot (pour retrouver les comptes Discord liés en une requête). */
export function collectLicenses(entries: readonly GameLogEntry[]): string[] {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 4) return;
    if (typeof v === 'string' && /^license2?:[a-z0-9]+$/i.test(v)) out.add(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => visit(x, depth + 1));
  };
  for (const e of entries) visit(e.data, 0);
  return [...out].slice(0, 500);
}

/** Copie des données pour la base : identifiants autres que licence / Discord retirés (jamais d'IP, steam, xbl…). */
export function redactData(v: unknown, depth = 0): unknown {
  if (depth > 5) return null;
  if (typeof v === 'string') {
    if (/^(ip|steam|xbl|live|fivem):/i.test(v) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(v.trim())) return null;
    return cut(v, 1024);
  }
  if (Array.isArray(v)) return v.map((x) => redactData(x, depth + 1)).filter((x) => x !== null).slice(0, 50);
  const r = asRecord(v);
  if (r) return Object.fromEntries(Object.entries(r).slice(0, 40).map(([k, x]) => [k, redactData(x, depth + 1)]));
  return v;
}

const weaponName = (v: unknown): string | null => {
  const s = cleanText(v, 64);
  if (!s) return null;
  return s.replace(/^weapon_/i, '').replace(/_/g, ' ').toLowerCase();
};

const colorOf = (v: unknown): number | null => {
  if (typeof v === 'number' && v >= 0 && v <= 0xffffff) return Math.trunc(v);
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v)) return parseInt(v.replace('#', ''), 16);
  return null;
};

/** Route d'un log `custom` : `data.channel` parmi GAME_LOG_CHANNELS, sinon `game.server`. */
export function customRoute(channel: unknown): GameRouteKey {
  return typeof channel === 'string' && (GAME_LOG_CHANNELS as readonly string[]).includes(channel) ? (`game.${channel as GameLogChannel}` as GameRouteKey) : 'game.server';
}

type FieldKey =
  | 'player'
  | 'reason'
  | 'session'
  | 'old'
  | 'new'
  | 'weapon'
  | 'distance'
  | 'headshot'
  | 'match'
  | 'cause'
  | 'mode'
  | 'map'
  | 'players'
  | 'winner'
  | 'duration'
  | 'top'
  | 'staff'
  | 'origin'
  | 'discord_outcome'
  | 'case'
  | 'action'
  | 'target'
  | 'groups'
  | 'details'
  | 'channel'
  | 'severity'
  | 'resource'
  | 'in'
  | 'event';

const OUTCOMES = ['banned', 'unbanned', 'kicked', 'warned', 'recorded'] as const;
type Outcome = (typeof OUTCOMES)[number];

export function renderGameLog(entry: GameLogEntry, ctx: RenderContext): RenderedGameLog {
  const { t } = ctx;
  const d = entry.data as Record<string, unknown>;
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  const field = (key: FieldKey, value: string | null | undefined, inline = true) => {
    if (value) fields.push({ name: t(`loghub.game.fields.${key}`), value: cut(value, 1024), inline });
  };
  const player = parsePlayer(d.player ?? d.target ?? d.victim ?? (d.name !== undefined || d.identifiers !== undefined ? d : null), ctx);
  const duration = (v: unknown): string | null => {
    const n = num(v);
    return n !== null && n > 0 ? formatDuration(Math.round(n), ctx.lang) : null;
  };
  let title = t(`loghub.game.titles.${entry.type}`);
  let description: string | undefined;
  let color: number = BRAND.colors.primary;
  let route: GameRouteKey = GAME_ROUTE_BY_TYPE[entry.type];
  let target: GamePlayer | null = player;
  let actor: GamePlayer | null = null;

  switch (entry.type) {
    case 'connect':
      field('player', playerLine(player, t), false);
      if (d.refused === true) {
        title = t('loghub.game.titles.connect_refused');
        color = BRAND.colors.danger;
        field('reason', cleanText(d.reason, 512), false);
      }
      break;
    case 'disconnect':
      color = BRAND.colors.anthracite;
      field('player', playerLine(player, t), false);
      field('reason', cleanText(d.reason, 512), false);
      field('session', duration(d.duration));
      break;
    case 'account': {
      const event = (ACCOUNT_EVENTS as readonly string[]).includes(String(d.event)) ? (d.event as AccountEvent) : 'name';
      title = t(`loghub.game.titles.account_${event}`);
      field('player', playerLine(player, t), false);
      field('old', cleanText(d.old ?? d.previous, 128));
      field('new', cleanText(d.new ?? d.pseudo ?? d.nickname, 128));
      break;
    }
    case 'kill': {
      const killer = parsePlayer(d.killer, ctx);
      const victim = parsePlayer(d.victim, ctx);
      target = victim;
      actor = killer;
      color = BRAND.colors.anthracite;
      description = t('loghub.game.kill_line', { killer: killer ? playerLine(killer, t) : t('loghub.game.environment'), victim: playerLine(victim, t) });
      field('weapon', weaponName(d.weapon));
      const dist = num(d.distance);
      if (dist !== null) field('distance', `${dist.toFixed(1)} m`);
      if (d.headshot === true) field('headshot', t('core.yes'));
      field('match', cleanText(d.matchId ?? d.match, 64));
      break;
    }
    case 'death':
      color = BRAND.colors.anthracite;
      field('player', playerLine(player, t), false);
      field('cause', cleanText(d.cause, 128) ?? weaponName(d.weapon));
      field('match', cleanText(d.matchId ?? d.match, 64));
      break;
    case 'match_start':
      target = null;
      field('match', cleanText(d.matchId ?? d.match, 64));
      field('mode', cleanText(d.mode, 64));
      field('map', cleanText(d.map, 64));
      field('players', cleanText(d.players, 16));
      break;
    case 'match_end': {
      const winner = parsePlayer(d.winner, ctx);
      target = winner;
      color = BRAND.colors.primary;
      field('match', cleanText(d.matchId ?? d.match, 64));
      field('winner', winner ? playerLine(winner, t) : null, false);
      field('duration', duration(d.duration));
      field('players', cleanText(d.players, 16));
      if (Array.isArray(d.top)) {
        const lines = d.top.slice(0, 10).map((row, i) => {
          const r = asRecord(row) ?? {};
          const name = cleanText(r.name ?? asRecord(r.player)?.name, 48) ?? '—';
          const place = num(r.place) ?? i + 1;
          const kills = num(r.kills);
          return `${place}. **${name}**${kills !== null ? ` — ${t('loghub.game.kills', { count: kills })}` : ''}`;
        });
        field('top', lines.join('\n'), false);
      }
      break;
    }
    case 'ban':
    case 'kick':
    case 'warn':
    case 'unban': {
      color = entry.type === 'unban' ? BRAND.colors.primary : entry.type === 'warn' ? BRAND.colors.warning : BRAND.colors.danger;
      actor = parsePlayer(d.staff, ctx);
      field('player', playerLine(player, t), false);
      field('staff', actor?.name ?? cleanText(d.staff, 128));
      field('duration', duration(d.duration));
      field('reason', cleanText(d.reason, 1024), false);
      field('origin', cleanText(d.origin ?? d.source, 64));
      if (typeof d.discord === 'string') {
        const outcome: Outcome = (OUTCOMES as readonly string[]).includes(d.discord) ? (d.discord as Outcome) : 'recorded';
        field('discord_outcome', t(`loghub.game.outcomes.${outcome}`));
      }
      if (num(d.caseNumber) !== null) field('case', `#${num(d.caseNumber)}`);
      break;
    }
    case 'admin':
      actor = parsePlayer(d.staff ?? d.admin, ctx);
      target = parsePlayer(d.target, ctx);
      field('staff', actor ? playerLine(actor, t) : null, false);
      field('action', cleanText(d.action, 128));
      field('target', target ? playerLine(target, t) : null, false);
      if (Array.isArray(d.groups)) field('groups', d.groups.map((g) => cleanText(g, 32)).filter(Boolean).join(', ') || t('core.none'));
      field('details', cleanText(d.details ?? d.message, 1024), false);
      break;
    case 'chat':
      color = BRAND.colors.anthracite;
      description = `${playerLine(player, t)}\n> ${cleanText(d.message, 1500) ?? ''}`;
      field('channel', cleanText(d.channel, 32));
      break;
    case 'anticheat':
      color = BRAND.colors.danger;
      field('player', playerLine(player, t), false);
      field('reason', cleanText(d.reason, 512), false);
      field('severity', cleanText(d.severity, 32));
      field('details', cleanText(typeof d.details === 'object' ? JSON.stringify(d.details) : d.details, 1024), false);
      break;
    case 'server': {
      target = null;
      const event = (SERVER_EVENTS as readonly string[]).includes(String(d.event)) ? (d.event as ServerEvent) : null;
      title = event ? t(`loghub.game.server_events.${event}`) : t('loghub.game.titles.server');
      color = event === 'offline' || event === 'shutdown' || event === 'error' ? BRAND.colors.danger : event === 'stop' || event === 'restart_scheduled' ? BRAND.colors.warning : BRAND.colors.primary;
      field('resource', cleanText(d.resource, 64));
      field('staff', cleanText(d.author ?? d.staff, 64));
      const seconds = num(d.secondsRemaining ?? d.seconds);
      if (seconds !== null) field('in', formatDuration(Math.max(1, Math.round(seconds)), ctx.lang));
      description = cleanText(d.message, 2000) ?? undefined;
      if (!event && d.event !== undefined) field('event', cleanText(d.event, 64));
      break;
    }
    case 'custom': {
      route = customRoute(d.channel);
      title = cleanText(d.title, 256) ?? t('loghub.game.titles.custom');
      description = cleanText(d.description, 4000) ?? undefined;
      color = colorOf(d.color) ?? BRAND.colors.primary;
      if (player && (d.player !== undefined || d.target !== undefined)) field('player', playerLine(player, t), false);
      if (Array.isArray(d.fields)) {
        for (const raw of d.fields.slice(0, 20)) {
          const f = asRecord(raw);
          const name = cleanText(f?.name, 256);
          const value = cleanText(f?.value, 1024);
          if (name && value) fields.push({ name, value, inline: f?.inline === true });
        }
      }
      break;
    }
  }

  return {
    action: `game.${entry.type}`,
    route,
    title: cut(title, 256),
    description,
    fields: fields.slice(0, 25),
    color,
    skipDatabase: GAME_LOG_NO_DATABASE.has(entry.type),
    targetId: target?.discordId ?? null,
    actorId: actor?.discordId ?? null,
    data: { type: entry.type, ts: entry.ts ?? null, title: cut(title, 256), ...(redactData(entry.data) as Record<string, unknown>) },
  };
}
