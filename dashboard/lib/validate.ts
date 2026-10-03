import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { HttpError } from './errors';

/** Transforme une erreur Zod en liste de messages lisibles. */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')} : ${i.message}` : i.message));
}

export class ValidationError extends HttpError {
  constructor(details: string[]) {
    super(400, 'Données invalides', details);
    this.name = 'ValidationError';
  }
}

/** Valide `data` avec `schema` ; lève une ValidationError (400) lisible en cas d'échec. */
export function parseOrThrow<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new ValidationError(formatZodIssues(result.error));
  return result.data;
}

export interface ValidSchemas<B extends ZodTypeAny, Q extends ZodTypeAny, P extends ZodTypeAny> {
  body?: B;
  query?: Q;
  params?: P;
}

export interface Validated<B, Q, P> {
  body: B;
  query: Q;
  params: P;
}

const VALID_KEY = Symbol.for('dashboard.validated');

/**
 * Middleware de validation : `validate({ body, query, params })`.
 * Les valeurs validées (et transformées) sont lues avec `valid(req)`.
 */
export function validate<B extends ZodTypeAny = z.ZodUnknown, Q extends ZodTypeAny = z.ZodUnknown, P extends ZodTypeAny = z.ZodUnknown>(schemas: ValidSchemas<B, Q, P>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const details: string[] = [];
    const out: Validated<unknown, unknown, unknown> = { body: req.body, query: req.query, params: req.params };
    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) out[part] = result.data;
      else details.push(...formatZodIssues(result.error).map((m) => `${part}.${m}`));
    }
    if (details.length) return next(new ValidationError(details));
    (req as unknown as Record<symbol, unknown>)[VALID_KEY] = out;
    next();
  };
}

/** Récupère les données validées par `validate()`. */
export function valid<B = unknown, Q = unknown, P = unknown>(req: Request): Validated<B, Q, P> {
  const stored = (req as unknown as Record<symbol, unknown>)[VALID_KEY] as Validated<B, Q, P> | undefined;
  return stored ?? { body: req.body as B, query: req.query as unknown as Q, params: req.params as unknown as P };
}

// ───── Schémas réutilisables ─────

export const discordIdSchema = z.string().regex(/^\d{15,22}$/, 'identifiant Discord invalide');
export const guildIdParams = z.object({ guildId: discordIdSchema });

/** Champ de formulaire pouvant être absent, une chaîne ou un tableau (checkbox / select multiple). */
export const stringArray = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}, z.array(z.string()));

export const discordIdArray = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((x) => typeof x === 'string' && x !== '');
}, z.array(discordIdSchema));

/** Case à cocher HTML : 'on' / 'true' / '1' → true, absent → false. */
export const checkbox = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) v = v[v.length - 1];
  return v === 'on' || v === 'true' || v === '1' || v === 1;
}, z.boolean());

/** Chaîne optionnelle : '' → null. */
export const optionalText = (max = 2000) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

/** Identifiant Discord optionnel : '' → null. */
export const optionalDiscordId = z.preprocess((v) => (v === '' || v === undefined ? null : v), discordIdSchema.nullable());

export const hexColorSchema = z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'couleur hexadécimale attendue').transform((v) => (v.startsWith('#') ? v.toUpperCase() : `#${v.toUpperCase()}`));

export const pageQuery = z.coerce.number().int().min(1).default(1);
