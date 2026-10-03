import type { FiveMFramework, FiveMServer } from '@prisma/client';
import type { NormalizedSanction, NormalizedStats, ServerPlayer, ServerStatus } from '../schemas';

export type { NormalizedSanction, NormalizedStats, ServerPlayer, ServerStatus };

/**
 * Un adaptateur par framework FiveM (ESX, QBCore, Custom).
 *  - fetchStatus / fetchPlayers : interrogent les endpoints natifs (`/info.json`, `/players.json`) du serveur
 *    quand `FiveMServer.host` est défini (polling).
 *  - normalizeStats / normalizeSanction : convertissent le payload « natif » du framework
 *    vers le format normalisé validé par Zod. Lancent une ZodError si le payload est invalide.
 */
export interface FrameworkAdapter {
  readonly framework: FiveMFramework;
  fetchStatus(server: FiveMServer): Promise<ServerStatus>;
  fetchPlayers(server: FiveMServer): Promise<ServerPlayer[]>;
  normalizeStats(payload: unknown): NormalizedStats;
  normalizeSanction(payload: unknown): NormalizedSanction;
}

/** Réponse native FiveM `GET /info.json` (champs utilisés). */
export interface FiveMInfoJson {
  server?: string;
  version?: number | string;
  vars?: Record<string, string>;
  resources?: string[];
}

/** Entrée native FiveM `GET /players.json`. */
export interface FiveMPlayerJson {
  id: number;
  name: string;
  identifiers?: string[];
  ping?: number;
  endpoint?: string;
}

export const FETCH_TIMEOUT_MS = 5000;
