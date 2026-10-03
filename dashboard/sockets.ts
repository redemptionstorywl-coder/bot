import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server as SocketServer, type Socket } from 'socket.io';
import type { RedemptionClient } from '../src/core/Client';
import { env } from '../src/config/env';
import { guildConfigService } from '../src/services/GuildConfigService';
import { attachFiveMSocket } from '../src/api/fivem';
import { childLogger } from '../src/utils/logger';
import { hasGuildAccess, isDiscordId } from './lib/access';
import { botGuildIds } from './lib/guildData';
import { MODULE_KEYS } from '../src/config/constants';
import type { SessionRequest } from './lib/types';

const log = childLogger('DashboardSockets');

/**
 * Événements du bus interne (`client.bus`) relayés tels quels aux rooms `guild:<id>`.
 * Le payload doit contenir `guildId`. Les modules émettent par ex. `client.bus.emit('ticket:open', { guildId, ticketId })`.
 */
export const RELAYED_BUS_EVENTS = [
  'log:new',
  'ticket:open',
  'ticket:claim',
  'ticket:close',
  'ticket:update',
  'moderation:sanction',
  'moderation:warning',
  'announcement:published',
  'announcement:scheduled',
  'giveaway:start',
  'giveaway:end',
  'event:update',
  'member:join',
  'member:leave',
  'fivem:status',
  'shop:order',
] as const;
export type RelayedBusEvent = (typeof RELAYED_BUS_EVENTS)[number];

export interface DashboardSockets {
  io: SocketServer;
  /** Diffuse un événement à tous les onglets ouverts sur le serveur `guildId`. */
  broadcastToGuild(guildId: string, event: string, payload: unknown): void;
  close(): Promise<void>;
}

let current: DashboardSockets | null = null;

/** Accès global pour les routes (null tant que le serveur n'est pas démarré). */
export function getDashboardSockets(): DashboardSockets | null {
  return current;
}

/** Raccourci sûr : ne fait rien si Socket.IO n'est pas démarré. */
export function broadcastToGuild(guildId: string, event: string, payload: unknown): void {
  current?.broadcastToGuild(guildId, event, payload);
}

function roomName(guildId: string): string {
  return `guild:${guildId}`;
}

export function createSockets(httpServer: HttpServer, client: RedemptionClient, sessionMiddleware: RequestHandler): DashboardSockets {
  const io = new SocketServer(httpServer, {
    serveClient: true,
    cors: { origin: false },
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // Partage de la session express avec Engine.IO (la requête de handshake passe par express-session)
  io.engine.use(sessionMiddleware as unknown as (req: unknown, res: unknown, next: (err?: unknown) => void) => void);

  io.use((socket, next) => {
    const session = (socket.request as SessionRequest).session;
    if (!session?.user) return next(new Error('Connexion requise'));
    next();
  });

  io.on('connection', (socket: Socket) => {
    const session = (socket.request as SessionRequest).session!;
    const user = session.user!;
    socket.on('guild:join', (guildId: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
      if (!isDiscordId(guildId)) return ack?.({ ok: false, error: 'Identifiant invalide' });
      if (!hasGuildAccess(session.guilds, guildId, user.id, env().OWNER_IDS, botGuildIds(client))) return ack?.({ ok: false, error: 'Accès refusé' });
      for (const room of socket.rooms) if (room.startsWith('guild:')) void socket.leave(room);
      void socket.join(roomName(guildId));
      ack?.({ ok: true });
    });
    socket.on('guild:leave', (guildId: unknown) => {
      if (isDiscordId(guildId)) void socket.leave(roomName(guildId));
    });
  });

  const onConfigUpdate = (guildId: string) => {
    void guildConfigService
      .get(guildId)
      .then((config) => {
        io.to(roomName(guildId)).emit('config:update', {
          guildId,
          at: Date.now(),
          modules: config?.modules ?? null,
          active: config ? MODULE_KEYS.filter((k) => config.modules[k]).length : null,
          total: MODULE_KEYS.length,
          kind: config?.kind ?? null,
          defaultLanguage: config?.defaultLanguage ?? null,
        });
      })
      .catch((err: unknown) => log.warn({ err, guildId }, 'config:update non diffusé'));
  };
  guildConfigService.on('update', onConfigUpdate);

  const busListeners: [string, (payload: unknown) => void][] = RELAYED_BUS_EVENTS.map((event) => {
    const listener = (payload: unknown) => {
      const guildId = payload && typeof payload === 'object' ? (payload as { guildId?: unknown }).guildId : undefined;
      if (!isDiscordId(guildId)) return;
      io.to(roomName(guildId)).emit(event, { ...(payload as Record<string, unknown>), at: Date.now() });
      if (event !== 'log:new') io.to(roomName(guildId)).emit('log:new', { guildId, event, at: Date.now() });
    };
    client.bus.on(event, listener);
    return [event, listener];
  });

  attachFiveMSocket(io, client);

  const sockets: DashboardSockets = {
    io,
    broadcastToGuild(guildId, event, payload) {
      io.to(roomName(guildId)).emit(event, payload);
    },
    async close() {
      guildConfigService.off('update', onConfigUpdate);
      for (const [event, listener] of busListeners) client.bus.off(event, listener);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (current === sockets) current = null;
    },
  };
  current = sockets;
  log.info('Socket.IO prêt');
  return sockets;
}
