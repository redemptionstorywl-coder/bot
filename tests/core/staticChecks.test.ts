import { describe, expect, it } from 'vitest';
import { run as customIds } from '../../scripts/checks/customids';
import { run as i18n } from '../../scripts/checks/i18n';
import { run as deadRefs } from '../../scripts/checks/deadrefs';
import { run as luaRoutes } from '../../scripts/checks/lua-routes';
import { run as migrations } from '../../scripts/checks/migrations';

/** Les vérifications de `npm run check` font aussi partie de la suite de tests. */
describe('vérifications statiques (npm run check)', () => {
  for (const [name, run] of Object.entries({ customIds, i18n, deadRefs, luaRoutes, migrations })) {
    it(`${name} : aucun écart`, async () => {
      const result = await run();
      expect(result.problems, result.problems.join('\n')).toEqual([]);
    }, 120_000);
  }
});
