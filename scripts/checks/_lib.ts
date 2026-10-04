import fs from 'node:fs';
import path from 'node:path';

/**
 * Outils communs des vérifications statiques (`npm run check`).
 * Chaque vérification exporte `run(): Promise<CheckResult>` et peut aussi être lancée seule :
 * `npx tsx scripts/checks/<nom>.ts`.
 */

export interface CheckResult {
  name: string;
  /** Écarts bloquants (code de sortie 1) */
  problems: string[];
  /** Informations (vérifiées à la main, non bloquantes) */
  notes: string[];
  /** Résumé chiffré d'une ligne */
  summary: string;
}

/** Racine du projet : premier dossier parent contenant prisma/schema.prisma (fonctionne depuis scripts/ et dist/scripts/). */
export function findRoot(from = __dirname): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'prisma', 'schema.prisma'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const ROOT = findRoot();
export const rel = (file: string): string => path.relative(ROOT, file);

/** Fichiers d'un dossier (récursif), filtrés par extension ; ignore node_modules / dist. */
export function walkFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) out.push(...walkFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out.sort();
}

/** Lance une vérification seule (affichage + code de sortie). */
export async function runStandalone(run: () => Promise<CheckResult>): Promise<void> {
  const result = await run();
  printResult(result, true);
  process.exit(result.problems.length ? 1 : 0);
}

export function printResult(result: CheckResult, withNotes = false): void {
  const ok = result.problems.length === 0;
  console.log(`\n${ok ? '✔' : '✖'} ${result.name} — ${result.summary}`);
  for (const p of result.problems) console.log(`   ✖ ${p}`);
  if (withNotes) for (const n of result.notes) console.log(`   · ${n}`);
}
