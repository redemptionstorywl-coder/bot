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

export const sanctionTypeSchema = z.enum(['BAN', 'KICK', 'WARN']);
export const normalizedSanctionSchema = z
  .object({
    identifier: fivemIdentifierSchema.optional(),
    discordId: discordId.optional(),
    type: sanctionTypeSchema,
    reason: z.string().min(1).max(1000),
    /** Durée en secondes (bans temporaires) */
    duration: z.coerce.number().int().min(1).optional(),
    staff: z.string().min(1).max(128),
  })
  .refine((s) => s.identifier || s.discordId, { message: '`identifier` ou `discordId` requis' });
export type NormalizedSanction = z.infer<typeof normalizedSanctionSchema>;

export const maintenanceSchema = z.object({ enabled: z.boolean() });

export const playerJoinSchema = serverPlayerSchema;
export const playerLeaveSchema = z.object({
  id: z.coerce.number().int().min(0),
  name: z.string().max(128).optional(),
  reason: z.string().max(256).optional(),
});

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
