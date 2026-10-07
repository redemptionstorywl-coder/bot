import { z } from 'zod';

/**
 * Schémas Zod partagés par l'API REST, le namespace Socket.IO et les adaptateurs.
 * Toute donnée entrante d'un serveur de jeu passe par ces schémas (payload « normalisé »).
 */

const discordId = z.string().regex(/^\d{15,22}$/, 'ID Discord attendu');
const nonNegInt = z.coerce.number().int().min(0);

export const fivemIdentifierSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9_]+:[A-Za-z0-9_\-.:]+$/i, 'Identifiant FiveM attendu (ex: license:abcd…)');

export const serverPlayerSchema = z.object({
  id: z.coerce.number().int().min(0),
  name: z.string().min(1).max(128),
  identifiers: z.array(z.string().max(128)).max(20).default([]),
  ping: z.coerce.number().int().min(0).max(10_000).optional(),
});
export type ServerPlayer = z.infer<typeof serverPlayerSchema>;

export const serverStatusSchema = z.object({
  online: z.boolean().default(true),
  players: nonNegInt.default(0),
  maxPlayers: nonNegInt.default(0),
  version: z.string().max(128).optional(),
  maintenance: z.boolean().optional(),
  playerList: z.array(serverPlayerSchema).max(2048).default([]),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

export const normalizedStatsSchema = z.object({
  identifier: fivemIdentifierSchema,
  season: z.coerce.number().int().min(1).optional(),
  /** `increment` (défaut) : les valeurs sont ajoutées ; `set` : elles remplacent les valeurs stockées. */
  mode: z.enum(['increment', 'set']).default('increment'),
  wins: nonNegInt.default(0),
  kills: nonNegInt.default(0),
  deaths: nonNegInt.default(0),
  matches: nonNegInt.default(0),
  damage: nonNegInt.default(0),
  top10: nonNegInt.default(0),
  xp: nonNegInt.default(0),
  playtimeMinutes: nonNegInt.default(0),
});
export type NormalizedStats = z.infer<typeof normalizedStatsSchema>;

export const statsBatchSchema = z.union([normalizedStatsSchema, z.array(normalizedStatsSchema).min(1).max(200)]);

export const sanctionTypeSchema = z.enum(['BAN', 'KICK', 'WARN', 'UNBAN']);
export const normalizedSanctionSchema = z
  .object({
    identifier: fivemIdentifierSchema.optional(),
    discordId: discordId.optional(),
    /** Tous les identifiants du joueur (GetPlayerIdentifiers) : permet de retrouver `discord:` automatiquement. */
    identifiers: z.array(z.string().max(128)).max(20).optional(),
    type: sanctionTypeSchema,
    reason: z.string().min(1).max(1000),
    /** Durée en secondes (bans temporaires) */
    duration: z.coerce.number().int().min(1).optional(),
    staff: z.string().min(1).max(128),
    /**
     * BAN / UNBAN : appliquer aussi sur Discord ? Absent = réglage `syncBansToDiscord` du serveur.
     * (`exports.rs_bridge:Ban(src, raison, durée, alsoDiscord)`)
     */
    syncDiscord: z.boolean().optional(),
  })
  .refine((s) => s.identifier || s.discordId || s.identifiers?.length, { message: '`identifier`, `identifiers` ou `discordId` requis' });
export type NormalizedSanction = z.infer<typeof normalizedSanctionSchema>;

export const maintenanceSchema = z.object({ enabled: z.boolean() });

export const playerJoinSchema = serverPlayerSchema;
export const playerLeaveSchema = z.object({
  id: z.coerce.number().int().min(0),
  name: z.string().max(128).optional(),
  reason: z.string().max(256).optional(),
  /** Identifiants du joueur (recommandé : permet de clore la session même après un redémarrage du bot) */
  identifiers: z.array(z.string().max(128)).max(20).optional(),
});

/** `POST /players/name` : pseudo choisi en jeu → surnom Discord. */
export const playerNameSchema = z
  .object({
    discordId: discordId.optional(),
    identifiers: z.array(z.string().max(128)).max(20).default([]),
    name: z.string().min(1).max(128),
    id: z.coerce.number().int().min(0).optional(),
  })
  .refine((p) => p.discordId || p.identifiers.length > 0, { message: '`discordId` ou `identifiers` requis' });

/** `POST /check` : vérification à la connexion (deferrals). */
export const connectionCheckSchema = z.object({
  identifiers: z.array(z.string().max(128)).min(1).max(20),
  name: z.string().max(128).optional(),
});

// ───────────── Logs en jeu (POST /logs, rs_bridge server/logs.lua) ─────────────

export const GAME_LOG_TYPES = ['connect', 'disconnect', 'account', 'kill', 'death', 'match_start', 'match_end', 'ban', 'kick', 'warn', 'unban', 'admin', 'chat', 'anticheat', 'server', 'custom'] as const;
export type GameLogType = (typeof GAME_LOG_TYPES)[number];

/** Salons qu'un log `custom` peut viser (`data.channel`). */
export const GAME_LOG_CHANNELS = ['connections', 'accounts', 'kills', 'matches', 'sanctions', 'admin', 'chat', 'anticheat', 'server'] as const;
export type GameLogChannel = (typeof GAME_LOG_CHANNELS)[number];

export const GAME_LOG_MAX_BATCH = 50;
/** Taille max du JSON `data` d'une entrée (octets) et profondeur max. */
export const GAME_LOG_MAX_DATA_BYTES = 8 * 1024;
export const GAME_LOG_MAX_DEPTH = 4;

function depthOf(v: unknown, depth = 0): number {
  if (!v || typeof v !== 'object') return depth;
  let max = depth + 1;
  for (const child of Object.values(v as Record<string, unknown>)) max = Math.max(max, depthOf(child, depth + 1));
  return max;
}

/** Données libres d'un log : objet JSON (tableau vide Lua `[]` accepté = objet vide), 8 ko et 4 niveaux max. */
export const gameLogDataSchema = z.preprocess(
  (v) => (v === undefined || v === null || (Array.isArray(v) && v.length === 0) ? {} : v),
  z
    .record(z.string().max(64), z.unknown())
    .refine((d) => Object.keys(d).length <= 40, { message: '40 champs max' })
    .refine((d) => depthOf(d) <= GAME_LOG_MAX_DEPTH, { message: `${GAME_LOG_MAX_DEPTH} niveaux max` })
    .refine((d) => JSON.stringify(d).length <= GAME_LOG_MAX_DATA_BYTES, { message: `${GAME_LOG_MAX_DATA_BYTES} octets max` }),
);

export const gameLogEntrySchema = z.object({
  type: z.enum(GAME_LOG_TYPES),
  /** Horodatage Unix (secondes) côté serveur de jeu ; absent = réception */
  ts: z.coerce.number().int().min(0).max(4_102_444_800).optional(),
  data: gameLogDataSchema,
});
export type GameLogEntry = z.infer<typeof gameLogEntrySchema>;

/** `POST /logs` : lot d'entrées (rs_bridge envoie au plus 25 entrées toutes les 5 s). */
export const gameLogBatchSchema = z.array(gameLogEntrySchema).min(1).max(GAME_LOG_MAX_BATCH);

export const socketAuthSchema = z.object({
  apiKey: z.string().min(1),
  serverKey: z.string().min(1).max(64),
  guildId: discordId,
});

/** Formate une ZodError en message court lisible (jamais de stack). */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; ');
}

/** Extrait l'identifiant `license:` d'une liste d'identifiants FiveM (sinon le premier). */
export function pickLicense(identifiers: string[]): string | undefined {
  return identifiers.find((i) => i.startsWith('license:')) ?? identifiers.find((i) => i.startsWith('license2:')) ?? identifiers[0];
}

/** Extrait l'identifiant `discord:` d'une liste d'identifiants FiveM (retourne l'ID numérique). */
export function pickDiscordId(identifiers: string[]): string | undefined {
  const d = identifiers.find((i) => i.startsWith('discord:'));
  return d ? d.slice('discord:'.length) : undefined;
}
