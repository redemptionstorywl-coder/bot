import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { RedemptionClient } from '../core/Client';

/**
 * API REST FiveM — montée par le dashboard sur `/api/fivem`.
 * Implémentation complète dans FiveMService (voir docs/FIVEM.md).
 */
export function createFiveMRouter(_client: RedemptionClient): Router {
  const router = Router();
  router.get('/health', (_req, res) => res.json({ ok: true }));
  return router;
}

/** Namespace Socket.IO `/fivem` pour les serveurs de jeu (temps réel). */
export function attachFiveMSocket(_io: SocketServer, _client: RedemptionClient): void {
  /* implémenté par FiveMService */
}
