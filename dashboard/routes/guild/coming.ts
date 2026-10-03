import { Router } from 'express';
import type { RedemptionClient } from '../../../src/core/Client';
import { render } from '../../lib/render';
import { PENDING_MODULE_PAGES } from '../../lib/navigation';
import { MODULE_LABELS } from '../../../src/config/constants';

/**
 * Pages de modules « en cours d'intégration ».
 * Chaque module métier remplace son entrée en montant son propre routeur AVANT celui-ci
 * dans routes/index.ts (ou en retirant l'entrée de PENDING_MODULE_PAGES).
 * Toutes les entrées de navigation ayant aujourd'hui un routeur dédié, PENDING_MODULE_PAGES est vide
 * et ce routeur n'enregistre aucune route : il reste disponible pour un futur module.
 */
export function createComingRouter(_client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  for (const entry of PENDING_MODULE_PAGES) {
    if (!entry.path) continue;
    router.get(`/${entry.path}`, (_req, res) => {
      render(res, 'coming', {
        title: entry.label,
        page: entry.key,
        entry,
        moduleLabel: entry.module ? MODULE_LABELS[entry.module] : entry.label,
        moduleEnabled: entry.module ? Boolean(res.locals.config?.modules[entry.module]) : true,
      });
    });
  }
  return router;
}
