import { FiveMFramework } from '@prisma/client';
import { BaseAdapter } from './base';
import { normalizedSanctionSchema, normalizedStatsSchema, type NormalizedSanction, type NormalizedStats } from '../schemas';

/**
 * Adaptateur « Custom » : le serveur envoie directement le payload normalisé (voir docs/FIVEM.md).
 * Aucun mapping : validation Zod stricte.
 */
export class CustomAdapter extends BaseAdapter {
  readonly framework = FiveMFramework.CUSTOM;

  normalizeStats(payload: unknown): NormalizedStats {
    return normalizedStatsSchema.parse(payload);
  }

  normalizeSanction(payload: unknown): NormalizedSanction {
    return normalizedSanctionSchema.parse(payload);
  }
}
