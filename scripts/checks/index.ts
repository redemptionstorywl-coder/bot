/* eslint-disable no-console */
import { printResult, type CheckResult } from './_lib';
import { run as customIds } from './customids';
import { run as i18n } from './i18n';
import { run as deadRefs } from './deadrefs';
import { run as luaRoutes } from './lua-routes';
import { run as migrations } from './migrations';
import { run as logRoutes } from './log-routes';

/**
 * `npm run check` — vérifications statiques du projet (aucune base, aucun token Discord requis) :
 * customIds ⇄ handlers, clés de traduction, références mortes, Lua rs_bridge ⇄ API FiveM, migrations ⇄ schéma,
 * actions de logs ⇄ routes du serveur de logs central.
 * Options : `--verbose` (affiche les notes), `--only=customids,i18n,…`.
 * Chaque vérification se lance aussi seule : `npx tsx scripts/checks/<nom>.ts`.
 */
const CHECKS: Record<string, () => Promise<CheckResult>> = { customids: customIds, i18n, deadrefs: deadRefs, 'lua-routes': luaRoutes, migrations, 'log-routes': logRoutes };

async function main(): Promise<void> {
  const verbose = process.argv.includes('--verbose');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const selected = Object.entries(CHECKS).filter(([name]) => !only || only.includes(name));
  let failed = 0;
  for (const [name, run] of selected) {
    const started = Date.now();
    try {
      const result = await run();
      printResult(result, verbose);
      if (result.problems.length) failed++;
    } catch (err) {
      failed++;
      console.log(`\n✖ ${name} — vérification impossible : ${(err as Error).stack ?? String(err)}`);
    }
    if (verbose) console.log(`   (${Date.now() - started} ms)`);
  }
  console.log(`\n${failed ? `✖ ${failed} vérification(s) en échec` : `✔ ${selected.length} vérifications OK`}`);
  process.exit(failed ? 1 : 0);
}

void main();
