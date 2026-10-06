/**
 * Tickets — fonctions pures du cycle fermeture / réouverture :
 *  - choix de la catégorie « Tickets fermés » (raison → réglage du serveur → catégorie par défaut → sur place),
 *    avec la limite Discord de 50 salons par catégorie ;
 *  - choix de la catégorie de réouverture (catégorie d'origine mémorisée → catégorie de la raison) ;
 *  - membres dont l'accès est retiré à la fermeture et rétabli à la réouverture (créateur + membres ajoutés, jamais le staff).
 */

/** Catégorie « Tickets fermés » du serveur RS Battle Royale : utilisée quand aucun réglage n'est défini et qu'elle existe. */
export const DEFAULT_CLOSED_CATEGORY_ID = '1557072815700574240';

/** Limite Discord : salons par catégorie. */
export const CATEGORY_CHANNEL_LIMIT = 50;

/** Catégorie vue depuis le cache Discord (null = inexistante ou pas une catégorie). */
export interface CategoryInfo {
  id: string;
  childCount: number;
}

export type CategorySource = 'type' | 'setting' | 'default' | 'origin';

/**
 * Résultat :
 *  - `move`  : déplacer le salon dans `categoryId` ;
 *  - `stay`  : laisser le salon où il est — `none` (aucune catégorie valable), `full` (50 salons, `categoryId` = catégorie pleine),
 *              `already` (le salon y est déjà).
 */
export type CategoryDecision =
  | { action: 'move'; categoryId: string; source: CategorySource }
  | { action: 'stay'; reason: 'none' }
  | { action: 'stay'; reason: 'full' | 'already'; categoryId: string; source: CategorySource };

function decide(candidates: { id: string | null | undefined; source: CategorySource }[], currentParentId: string | null | undefined, lookup: (id: string) => CategoryInfo | null): CategoryDecision {
  for (const c of candidates) {
    if (!c.id) continue;
    const cat = lookup(c.id);
    if (!cat) continue; // catégorie configurée mais supprimée : on passe à la suivante
    if (currentParentId === cat.id) return { action: 'stay', reason: 'already', categoryId: cat.id, source: c.source };
    if (cat.childCount >= CATEGORY_CHANNEL_LIMIT) return { action: 'stay', reason: 'full', categoryId: cat.id, source: c.source };
    return { action: 'move', categoryId: cat.id, source: c.source };
  }
  return { action: 'stay', reason: 'none' };
}

/**
 * Catégorie de fermeture, par priorité : catégorie d'archive de la raison, réglage du serveur (`closedCategoryId`),
 * catégorie par défaut `DEFAULT_CLOSED_CATEGORY_ID` si elle existe sur le serveur. Une catégorie pleine (50 salons)
 * laisse le salon sur place (pas de repli silencieux vers une autre catégorie).
 */
export function resolveClosedCategory(input: {
  typeArchiveId?: string | null;
  settingId?: string | null;
  defaultId?: string | null;
  currentParentId?: string | null;
  lookup: (id: string) => CategoryInfo | null;
}): CategoryDecision {
  return decide(
    [
      { id: input.typeArchiveId, source: 'type' },
      { id: input.settingId, source: 'setting' },
      { id: input.defaultId === undefined ? DEFAULT_CLOSED_CATEGORY_ID : input.defaultId, source: 'default' },
    ],
    input.currentParentId,
    input.lookup,
  );
}

/** Catégorie de réouverture : catégorie d'origine mémorisée à la fermeture, sinon catégorie de la raison. */
export function resolveReopenCategory(input: { openCategoryId?: string | null; typeCategoryId?: string | null; currentParentId?: string | null; lookup: (id: string) => CategoryInfo | null }): CategoryDecision {
  return decide(
    [
      { id: input.openCategoryId, source: 'origin' },
      { id: input.typeCategoryId, source: 'type' },
    ],
    input.currentParentId,
    input.lookup,
  );
}

/**
 * Membres du ticket (créateur + membres ajoutés) dont l'accès est retiré à la fermeture et rétabli à la réouverture.
 * Le staff (rôles staff / admin / rôles de la raison, permissions de modération) garde toujours son accès : il n'est jamais touché.
 */
export function planMemberAccess(input: { openerId: string; participants: readonly string[]; isStaff: (id: string) => boolean }): { members: string[]; staff: string[] } {
  const ids = [...new Set([input.openerId, ...input.participants].filter(Boolean))];
  return { members: ids.filter((id) => !input.isStaff(id)), staff: ids.filter((id) => input.isStaff(id)) };
}
