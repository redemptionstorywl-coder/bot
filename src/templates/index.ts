import { battleRoyaleTemplate } from './battleRoyale';
import { prisonTemplate } from './prison';
import { schoolTemplate } from './school';
import { shopTemplate } from './shop';
import type { ServerTemplate } from './types';

export * from './types';

/** Modèles de serveur disponibles pour `/template`. */
export const SERVER_TEMPLATES: ServerTemplate[] = [shopTemplate, battleRoyaleTemplate, prisonTemplate, schoolTemplate];

export const TEMPLATE_KEYS = SERVER_TEMPLATES.map((t) => t.key);

export function getTemplate(key: string): ServerTemplate | undefined {
  return SERVER_TEMPLATES.find((t) => t.key === key);
}
