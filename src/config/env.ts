import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(20, 'DISCORD_TOKEN manquant ou invalide'),
  CLIENT_ID: z.string().regex(/^\d{15,22}$/, 'CLIENT_ID doit être un ID Discord'),
  DISCORD_CLIENT_SECRET: z.string().optional().default(''),
  OWNER_IDS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  DEV_GUILD_ID: z.string().optional().default(''),
  DATABASE_URL: z.string().startsWith('mysql://', 'DATABASE_URL doit commencer par mysql://'),
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().optional(),
  DASHBOARD_PORT: z.coerce.number().int().positive().optional(),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET doit faire au moins 16 caractères').default('change-me-with-a-long-random-string'),
  FIVEM_API_KEY: z.string().min(8).default('change-me-fivem-api-key'),
  TEBEX_WEBHOOK_SECRET: z.string().optional().default(''),
  /** Traduction automatique FR → EN : DeepL (prioritaire, clé « …:fx » = API Free), Google Cloud, sinon MyMemory gratuit. */
  DEEPL_API_KEY: z.string().trim().optional().default(''),
  GOOGLE_TRANSLATE_API_KEY: z.string().trim().optional().default(''),
  MYMEMORY_EMAIL: z.union([z.literal(''), z.string().trim().email('MYMEMORY_EMAIL doit être une adresse e-mail')]).optional().default(''),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  TZ: z.string().default('Europe/Paris'),
});

export type Env = Omit<z.infer<typeof envSchema>, 'DASHBOARD_PORT'> & { DASHBOARD_PORT: number };

/**
 * Valide les variables d'environnement. Lance une erreur lisible si quelque chose manque.
 * Le token n'est jamais affiché.
 */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration .env invalide :\n${issues}\n\nCopiez .env.example vers .env et complétez les valeurs.`);
  }
  const data = parsed.data;
  // Render / Heroku / Railway fournissent PORT : il a priorité sur DASHBOARD_PORT.
  return { ...data, DASHBOARD_PORT: data.PORT ?? data.DASHBOARD_PORT ?? 3000 };
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Masque un secret pour les logs (ne montre que les 4 derniers caractères). */
export function maskSecret(secret: string): string {
  if (!secret) return '(vide)';
  return `${'*'.repeat(Math.max(0, secret.length - 4))}${secret.slice(-4)}`;
}
