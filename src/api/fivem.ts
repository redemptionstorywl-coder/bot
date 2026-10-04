import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Server as SocketServer, Socket } from 'socket.io';
import { ZodError } from 'zod';
import type { RedemptionClient } from '../core/Client';
import type { FiveMServer } from '@prisma/client';
import { fivemService, FiveMError } from '../services/FiveMService';
import { whitelistService } from '../services/WhitelistService';
import { battleRoyaleService } from '../services/BattleRoyaleService';
import { fivemSyncService } from '../services/FiveMSyncService';
import {
  connectionCheckSchema,
  formatZodError,
  maintenanceSchema,
  playerJoinSchema,
  playerLeaveSchema,
  playerNameSchema,
  serverStatusSchema,
  socketAuthSchema,
  statsBatchSchema,
  type NormalizedStats,
  type ServerPlayer,
} from '../services/fivem/schemas';
import { childLogger } from '../utils/logger';

const log = childLogger('FiveMApi');

// ───────────── Rate limit mémoire (120 req / min / IP) ─────────────

export const RATE_LIMIT = { windowMs: 60_000, max: 120 } as const;
const hits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string, now = Date.now(), limit = RATE_LIMIT): { allowed: boolean; remaining: number; retryAfterSec: number } {
  let entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + limit.windowMs };
    hits.set(ip, entry);
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  entry.count++;
  const remaining = Math.max(0, limit.max - entry.count);
  return { allowed: entry.count <= limit.max, remaining, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const r = checkRateLimit(ip);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT.max));
  res.setHeader('X-RateLimit-Remaining', String(r.remaining));
  if (!r.allowed) {
    res.setHeader('Retry-After', String(r.retryAfterSec));
    res.status(429).json({ error: 'rate_limited', message: `Trop de requêtes, réessayez dans ${r.retryAfterSec}s` });
    return;
  }
  next();
}

// ───────────── Auth ─────────────

type AuthedRequest = Request & { server: FiveMServer };

function extractApiKey(req: Request): string | undefined {
  const header = req.header('x-api-key');
  if (header) return header.trim();
  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return undefined;
}

const FIVEM_ERROR_STATUS: Record<FiveMError['code'], number> = { not_found: 404, unauthorized: 401, disabled: 403, duplicate: 409, invalid_key: 400, no_host: 400, unreachable: 502 };

async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { guildId, serverKey } = req.params as { guildId: string; serverKey: string };
    if (!/^\d{15,22}$/.test(guildId)) {
      res.status(400).json({ error: 'invalid_guild', message: 'guildId invalide' });
      return;
    }
    const headerKey = req.header('x-server-key');
    if (headerKey && headerKey !== serverKey) {
      res.status(400).json({ error: 'server_key_mismatch', message: 'x-server-key ne correspond pas à l’URL' });
      return;
    }
    (req as AuthedRequest).server = await fivemService.authenticate(guildId, serverKey, extractApiKey(req));
    next();
  } catch (err) {
    next(err);
  }
}

type Handler = (req: AuthedRequest, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next);

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation', message: formatZodError(err) });
    return;
  }
  if (err instanceof FiveMError) {
    res.status(FIVEM_ERROR_STATUS[err.code]).json({ error: err.code, message: err.message });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json', message: 'Corps JSON invalide' });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'payload_too_large', message: 'Corps trop volumineux' });
    return;
  }
  log.error({ err }, 'Erreur API FiveM');
  res.status(500).json({ error: 'internal', message: 'Erreur interne' });
}

// ───────────── Traitement partagé REST / Socket ─────────────

async function handleStats(server: FiveMServer, payload: unknown): Promise<{ applied: number; unlinked: string[]; results: Awaited<ReturnType<typeof battleRoyaleService.applyStats>>[] }> {
  const adapter = fivemService.getAdapter(server.framework);
  if (Array.isArray(payload) && (payload.length === 0 || payload.length > 200)) statsBatchSchema.parse(payload); // → 400 lisible (lot vide / trop grand)
  const items: NormalizedStats[] = Array.isArray(payload) ? payload.map((p) => adapter.normalizeStats(p)) : [adapter.normalizeStats(payload)];
  const results = [];
  const unlinked: string[] = [];
  for (const s of items) {
    const r = await battleRoyaleService.applyStats(server.guildId, s);
    results.push(r);
    if (r.unlinked) unlinked.push(s.identifier);
  }
  return { applied: results.filter((r) => r.applied).length, unlinked, results };
}

/** Sanction prise en jeu → Sanction + action Discord selon la config de synchronisation du serveur. */
async function handleSanction(server: FiveMServer, payload: unknown) {
  const sanction = fivemService.getAdapter(server.framework).normalizeSanction(payload);
  return fivemSyncService.handleSanction(server, sanction);
}

/**
 * Arrivée en jeu : liaison / rôles / surnom, puis ajout à la liste des joueurs du statut.
 * Sérialisée par serveur (withStatusLock) : deux arrivées simultanées partaient de la même liste et la seconde
 * effaçait la première, que le diff du statut traitait ensuite comme un départ (session close, rôle retiré).
 */
async function handleJoin(server: FiveMServer, payload: unknown) {
  const player: ServerPlayer = playerJoinSchema.parse(payload);
  return fivemService.withStatusLock(server, async (fresh) => {
    const result = await fivemSyncService.handleJoin(fresh, player);
    const current = fivemService.getResolvedStatus(fresh);
    const playerList = [...current.playerList.filter((p) => p.id !== player.id), player];
    const updated = await fivemService.applyStatus(fresh, { ...current, online: true, players: playerList.length, playerList }, 'rest');
    return { updated, players: playerList.length, ...result };
  });
}

/** Départ : temps de session comptabilisé, rôle « en jeu » retiré, joueur retiré du statut (sérialisé par serveur). */
async function handleLeave(server: FiveMServer, payload: unknown) {
  const leave = playerLeaveSchema.parse(payload);
  return fivemService.withStatusLock(server, async (fresh) => {
    const current = fivemService.getResolvedStatus(fresh);
    const known = current.playerList.find((p) => p.id === leave.id);
    const r = await fivemSyncService.handleLeave(fresh, { id: leave.id, identifiers: leave.identifiers ?? known?.identifiers });
    const playerList = current.playerList.filter((p) => p.id !== leave.id);
    const updated = await fivemService.applyStatus(fresh, { ...current, online: true, players: playerList.length, playerList }, 'rest');
    return { updated, players: playerList.length, minutes: r.minutes, discordId: r.discordId };
  });
}

/** Heartbeat / statut complet (sérialisé avec les arrivées / départs du même serveur). */
async function handleStatus(server: FiveMServer, payload: unknown, source: 'rest' | 'socket') {
  const status = serverStatusSchema.parse(payload);
  return fivemService.withStatusLock(server, (fresh) => fivemService.applyStatus(fresh, status, source));
}

// ───────────── Router ─────────────

/**
 * API REST FiveM — montée par le dashboard sur `/api/fivem`.
 * Auth : `x-api-key` (clé globale FIVEM_API_KEY ou clé propre au serveur) ; serveur identifié par l'URL.
 */
export function createFiveMRouter(client: RedemptionClient): Router {
  fivemService.attach(client);
  fivemSyncService.attach(client);
  const router = Router();
  router.use(rateLimit);
  router.use(express.json({ limit: '512kb' }));

  router.get('/health', (_req, res) => res.json({ ok: true, service: 'fivem', uptime: client.uptimeSeconds }));

  const base = '/servers/:guildId/:serverKey';

  router.post(
    `${base}/status`,
    authenticate,
    wrap(async (req, res) => {
      const updated = await handleStatus(req.server, req.body, 'rest');
      res.json({ ok: true, status: fivemService.getResolvedStatus(updated) });
    }),
  );

  router.get(
    `${base}/status`,
    authenticate,
    wrap(async (req, res) => {
      const status = fivemService.getResolvedStatus(req.server);
      res.json({ ok: true, server: { key: req.server.key, name: req.server.name, framework: req.server.framework, maintenance: req.server.maintenance }, status: { ...status, playerList: undefined } });
    }),
  );

  router.post(
    `${base}/stats`,
    authenticate,
    wrap(async (req, res) => {
      const r = await handleStats(req.server, req.body);
      res.status(r.unlinked.length ? 202 : 200).json({ ok: true, applied: r.applied, unlinked: r.unlinked.length ? true : false, unlinkedIdentifiers: r.unlinked, results: r.results });
    }),
  );

  router.get(
    `${base}/whitelist/:identifier`,
    authenticate,
    wrap(async (req, res) => {
      // Express a déjà décodé le paramètre : un second decodeURIComponent lançait une URIError (500) sur un `%` isolé.
      const identifier = String(req.params.identifier ?? '').slice(0, 128);
      const r = await whitelistService.check(req.server.guildId, identifier);
      res.json({ ok: true, identifier, ...r });
    }),
  );

  router.get(
    `${base}/whitelist`,
    authenticate,
    wrap(async (req, res) => {
      const list = await whitelistService.listAccepted(req.server.guildId);
      res.json({ ok: true, count: list.length, whitelist: list });
    }),
  );

  router.post(
    `${base}/sanctions`,
    authenticate,
    wrap(async (req, res) => {
      const r = await handleSanction(req.server, req.body);
      res.status(201).json({ ok: true, ...r });
    }),
  );

  router.post(
    `${base}/players/join`,
    authenticate,
    wrap(async (req, res) => {
      const { updated: _u, ...r } = await handleJoin(req.server, req.body);
      res.json({ ok: true, ...r });
    }),
  );

  router.post(
    `${base}/players/leave`,
    authenticate,
    wrap(async (req, res) => {
      const { updated: _u, ...r } = await handleLeave(req.server, req.body);
      res.json({ ok: true, ...r });
    }),
  );

  router.post(
    `${base}/players/name`,
    authenticate,
    wrap(async (req, res) => {
      const input = playerNameSchema.parse(req.body);
      const r = await fivemSyncService.handleNameChange(req.server, input);
      res.json({ ok: true, ...r });
    }),
  );

  router.post(
    `${base}/check`,
    authenticate,
    wrap(async (req, res) => {
      const { identifiers } = connectionCheckSchema.parse(req.body);
      const r = await fivemSyncService.checkConnection(req.server, identifiers);
      res.json({ ok: true, ...r });
    }),
  );

  router.get(
    `${base}/bans/:discordId`,
    authenticate,
    wrap(async (req, res) => {
      const discordId = String(req.params.discordId ?? '').replace(/^discord:/, '');
      if (!/^\d{15,22}$/.test(discordId)) {
        res.status(400).json({ error: 'validation', message: 'discordId invalide' });
        return;
      }
      const ban = await fivemSyncService.getDiscordBan(req.server.guildId, discordId);
      res.json({ ok: true, discordId, banned: ban.active, reason: ban.reason, expiresAt: ban.expiresAt?.toISOString() ?? null });
    }),
  );

  router.get(
    `${base}/actions`,
    authenticate,
    wrap(async (req, res) => {
      // Le polling des actions sert aussi de heartbeat léger.
      const actions = await fivemSyncService.takeActions(req.server);
      res.json({ ok: true, count: actions.length, actions });
    }),
  );

  router.get(
    `${base}/players`,
    authenticate,
    wrap(async (req, res) => {
      const players = await fivemService.getPlayers(req.server);
      res.json({ ok: true, count: players.length, players });
    }),
  );

  router.post(
    `${base}/maintenance`,
    authenticate,
    wrap(async (req, res) => {
      const { enabled } = maintenanceSchema.parse(req.body);
      const server = await fivemService.setMaintenance(req.server.guildId, req.server.key, enabled);
      res.json({ ok: true, maintenance: server.maintenance });
    }),
  );

  router.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Route inconnue' }));
  router.use(errorHandler);
  return router;
}

// ───────────── Socket.IO `/fivem` ─────────────

type Ack = (response: { ok: boolean; error?: string; message?: string; [k: string]: unknown }) => void;

function withAck(socket: Socket, event: string, fn: (payload: unknown) => Promise<Record<string, unknown> | void>) {
  socket.on(event, async (payload: unknown, ack?: Ack) => {
    try {
      const result = await fn(payload);
      ack?.({ ok: true, ...(result ?? {}) });
    } catch (err) {
      const message = err instanceof ZodError ? formatZodError(err) : err instanceof FiveMError ? err.code : 'internal';
      if (!(err instanceof ZodError) && !(err instanceof FiveMError)) log.error({ err, event }, 'Erreur socket FiveM');
      ack?.({ ok: false, error: err instanceof ZodError ? 'validation' : err instanceof FiveMError ? err.code : 'internal', message });
      socket.emit('error:event', { event, error: message });
    }
  });
}

/** Namespace Socket.IO `/fivem` : auth par handshake.auth { apiKey, serverKey, guildId }. */
export function attachFiveMSocket(io: SocketServer, client: RedemptionClient): void {
  fivemService.attach(client);
  fivemSyncService.attach(client);
  const nsp = io.of('/fivem');

  nsp.use(async (socket, next) => {
    const parsed = socketAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) return next(new Error('invalid_auth'));
    try {
      const server = await fivemService.authenticate(parsed.data.guildId, parsed.data.serverKey, parsed.data.apiKey);
      socket.data.server = server;
      next();
    } catch (err) {
      next(new Error(err instanceof FiveMError ? err.code : 'unauthorized'));
    }
  });

  nsp.on('connection', (socket) => {
    const server = socket.data.server as FiveMServer;
    /** Configuration à jour (les options de synchronisation peuvent changer pendant la connexion). */
    const fresh = async (): Promise<FiveMServer> => Object.assign(server, (await fivemService.getServer(server.guildId, server.key)) ?? {});
    fivemService.registerSocket(server, socket);
    socket.emit('ready', { serverKey: server.key, guildId: server.guildId, maintenance: server.maintenance });

    withAck(socket, 'status', async (payload) => {
      const updated = await handleStatus(server, payload, 'socket');
      Object.assign(server, updated);
      return { status: fivemService.getResolvedStatus(updated) };
    });

    withAck(socket, 'stats', async (payload) => {
      const r = await handleStats(server, payload);
      return { applied: r.applied, unlinked: r.unlinked.length > 0, unlinkedIdentifiers: r.unlinked };
    });

    withAck(socket, 'sanction', async (payload) => {
      const r = await handleSanction(await fresh(), payload);
      return { ...r };
    });

    withAck(socket, 'player:join', async (payload) => {
      const { updated, ...r } = await handleJoin(await fresh(), payload);
      Object.assign(server, updated);
      return { ...r };
    });

    withAck(socket, 'player:leave', async (payload) => {
      const { updated, ...r } = await handleLeave(await fresh(), payload);
      Object.assign(server, updated);
      return { ...r };
    });

    withAck(socket, 'player:name', async (payload) => {
      return { ...(await fivemSyncService.handleNameChange(await fresh(), playerNameSchema.parse(payload))) };
    });

    withAck(socket, 'check', async (payload) => {
      const { identifiers } = connectionCheckSchema.parse(payload);
      return { ...(await fivemSyncService.checkConnection(await fresh(), identifiers)) };
    });

    withAck(socket, 'whitelist:check', async (payload) => {
      const identifier = typeof payload === 'string' ? payload : String((payload as { identifier?: string })?.identifier ?? '');
      return { ...(await whitelistService.check(server.guildId, identifier.slice(0, 128))) };
    });

    socket.on('disconnect', (reason) => log.info({ server: server.key, reason }, 'Serveur FiveM déconnecté'));
  });
}
