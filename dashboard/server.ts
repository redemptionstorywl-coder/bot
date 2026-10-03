import type { RedemptionClient } from '../src/core/Client';

export interface DashboardHandle {
  close(): Promise<void>;
}

/** Placeholder remplacé par l'implémentation complète du dashboard. */
export async function startDashboard(_client: RedemptionClient): Promise<DashboardHandle> {
  return { close: async () => undefined };
}
