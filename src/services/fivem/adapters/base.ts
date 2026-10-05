import type { FiveMFramework, FiveMServer } from '@prisma/client';
import { normalizedSanctionSchema, normalizedStatsSchema, serverPlayerSchema, type NormalizedSanction, type NormalizedStats, type ServerPlayer, type ServerStatus } from '../schemas';
import { FETCH_TIMEOUT_MS, type FiveMInfoJson, type FiveMPlayerJson, type FrameworkAdapter } from './types';

export class AdapterError extends Error {
  constructor(message: string, readonly code: 'no_host' | 'timeout' | 'http' | 'invalid') {
    super(message);
    this.name = 'AdapterError';
  }
}

/** GET JSON avec timeout (AbortController). Lance AdapterError. */
export async function fetchJson<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new AdapterError(`HTTP ${res.status} sur ${url}`, 'http');
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    if ((err as Error).name === 'AbortError') throw new AdapterError(`Timeout (${timeoutMs} ms) sur ${url}`, 'timeout');
    throw new AdapterError((err as Error).message, 'http');
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeHost(host: string): string {
  const h = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(h) ? h : `http://${h}`;
}

export function toBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
  }
  if (typeof v === 'number') return v !== 0;
  return undefined;
}

export function toInt(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

export function firstDefined(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

export function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

/** Liste d'identifiants (tableau de chaînes) ou undefined. */
export function identifierList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128).slice(0, 20);
  return out.length ? out : undefined;
}

const SANCTION_ALIASES: Record<string, 'BAN' | 'KICK' | 'WARN' | 'UNBAN'> = {
  ban: 'BAN',
  banned: 'BAN',
  tempban: 'BAN',
  kick: 'KICK',
  kicked: 'KICK',
  warn: 'WARN',
  warning: 'WARN',
  avertissement: 'WARN',
  unban: 'UNBAN',
  unbanned: 'UNBAN',
  pardon: 'UNBAN',
  deban: 'UNBAN',
};

export function normalizeSanctionType(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  return SANCTION_ALIASES[v.trim().toLowerCase()] ?? v.trim().toUpperCase();
}

/**
 * Adaptateur de base : lecture des endpoints natifs FiveM (identiques quel que soit le framework).
 * Les sous-classes définissent la normalisation des payloads et la convar de maintenance.
 */
export abstract class BaseAdapter implements FrameworkAdapter {
  abstract readonly framework: FiveMFramework;
  /** Convars (`vars` de info.json) indiquant la maintenance pour ce framework. */
  protected maintenanceVars: string[] = ['maintenance', 'sv_maintenance'];

  async fetchInfo(server: FiveMServer): Promise<FiveMInfoJson> {
    if (!server.host) throw new AdapterError('Aucun host configuré', 'no_host');
    return fetchJson<FiveMInfoJson>(`${normalizeHost(server.host)}/info.json`);
  }

  async fetchPlayers(server: FiveMServer): Promise<ServerPlayer[]> {
    if (!server.host) throw new AdapterError('Aucun host configuré', 'no_host');
    const raw = await fetchJson<FiveMPlayerJson[]>(`${normalizeHost(server.host)}/players.json`);
    if (!Array.isArray(raw)) throw new AdapterError('players.json invalide', 'invalid');
    const out: ServerPlayer[] = [];
    for (const p of raw) {
      const parsed = serverPlayerSchema.safeParse({ id: p.id, name: p.name, identifiers: p.identifiers ?? [], ping: p.ping });
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  async fetchStatus(server: FiveMServer): Promise<ServerStatus> {
    const [info, players] = await Promise.all([this.fetchInfo(server), this.fetchPlayers(server)]);
    const vars = info.vars ?? {};
    const maintenance = this.maintenanceVars.map((k) => toBool(vars[k])).find((v) => v !== undefined);
    return {
      online: true,
      players: players.length,
      maxPlayers: toInt(vars.sv_maxClients, 0),
      version: typeof info.server === 'string' ? info.server.slice(0, 128) : info.version !== undefined ? String(info.version) : undefined,
      maintenance,
      playerList: players,
    };
  }

  abstract normalizeStats(payload: unknown): NormalizedStats;
  abstract normalizeSanction(payload: unknown): NormalizedSanction;

  /** Valide un objet déjà mappé vers le format normalisé. */
  protected parseStats(mapped: Record<string, unknown>): NormalizedStats {
    return normalizedStatsSchema.parse(mapped);
  }

  protected parseSanction(mapped: Record<string, unknown>): NormalizedSanction {
    return normalizedSanctionSchema.parse(mapped);
  }
}
