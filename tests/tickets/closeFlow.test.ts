import { describe, expect, it } from 'vitest';
import { CATEGORY_CHANNEL_LIMIT, DEFAULT_CLOSED_CATEGORY_ID, planMemberAccess, resolveClosedCategory, resolveReopenCategory, type CategoryInfo } from '../../src/services/tickets/closeFlow';

const SETTING = '111111111111111111';
const ARCHIVE = '222222222222222222';
const ORIGIN = '333333333333333333';
const TYPE_CAT = '444444444444444444';

/** Catégories présentes sur le serveur : id → nombre de salons. */
const lookupOf = (cats: Record<string, number>) => (id: string): CategoryInfo | null => (id in cats ? { id, childCount: cats[id]! } : null);

describe('resolveClosedCategory — catégorie « Tickets fermés »', () => {
  it('réglage du serveur : le salon y est déplacé', () => {
    expect(resolveClosedCategory({ settingId: SETTING, lookup: lookupOf({ [SETTING]: 3 }) })).toEqual({ action: 'move', categoryId: SETTING, source: 'setting' });
  });

  it('sans réglage : catégorie par défaut 1557072815700574240 si elle existe (serveur Battle Royale)', () => {
    expect(DEFAULT_CLOSED_CATEGORY_ID).toBe('1557072815700574240');
    expect(resolveClosedCategory({ settingId: null, lookup: lookupOf({ [DEFAULT_CLOSED_CATEGORY_ID]: 0 }) })).toEqual({ action: 'move', categoryId: DEFAULT_CLOSED_CATEGORY_ID, source: 'default' });
  });

  it('aucune catégorie : le salon reste où il est', () => {
    expect(resolveClosedCategory({ settingId: null, lookup: lookupOf({}) })).toEqual({ action: 'stay', reason: 'none' });
  });

  it('réglage pointant vers une catégorie supprimée : repli sur la catégorie par défaut, sinon sur place', () => {
    expect(resolveClosedCategory({ settingId: SETTING, lookup: lookupOf({ [DEFAULT_CLOSED_CATEGORY_ID]: 1 }) })).toMatchObject({ action: 'move', categoryId: DEFAULT_CLOSED_CATEGORY_ID });
    expect(resolveClosedCategory({ settingId: SETTING, lookup: lookupOf({}) })).toEqual({ action: 'stay', reason: 'none' });
  });

  it('catégorie pleine (50 salons) : le salon reste en place, sans repli silencieux', () => {
    const full = resolveClosedCategory({ settingId: SETTING, lookup: lookupOf({ [SETTING]: CATEGORY_CHANNEL_LIMIT, [DEFAULT_CLOSED_CATEGORY_ID]: 0 }) });
    expect(full).toEqual({ action: 'stay', reason: 'full', categoryId: SETTING, source: 'setting' });
    expect(resolveClosedCategory({ settingId: SETTING, lookup: lookupOf({ [SETTING]: CATEGORY_CHANNEL_LIMIT - 1 }) })).toMatchObject({ action: 'move' });
  });

  it('la catégorie propre à la raison est prioritaire ; salon déjà dans la catégorie = rien à faire', () => {
    const cats = lookupOf({ [ARCHIVE]: 2, [SETTING]: 2 });
    expect(resolveClosedCategory({ typeArchiveId: ARCHIVE, settingId: SETTING, lookup: cats })).toEqual({ action: 'move', categoryId: ARCHIVE, source: 'type' });
    expect(resolveClosedCategory({ settingId: SETTING, currentParentId: SETTING, lookup: cats })).toEqual({ action: 'stay', reason: 'already', categoryId: SETTING, source: 'setting' });
  });

  it('defaultId: null désactive la catégorie par défaut', () => {
    expect(resolveClosedCategory({ defaultId: null, lookup: lookupOf({ [DEFAULT_CLOSED_CATEGORY_ID]: 0 }) })).toEqual({ action: 'stay', reason: 'none' });
  });
});

describe('resolveReopenCategory — retour dans la catégorie d’origine', () => {
  it('catégorie mémorisée à la fermeture, sinon celle de la raison', () => {
    const cats = lookupOf({ [ORIGIN]: 4, [TYPE_CAT]: 4 });
    expect(resolveReopenCategory({ openCategoryId: ORIGIN, typeCategoryId: TYPE_CAT, currentParentId: SETTING, lookup: cats })).toEqual({ action: 'move', categoryId: ORIGIN, source: 'origin' });
    expect(resolveReopenCategory({ openCategoryId: null, typeCategoryId: TYPE_CAT, currentParentId: SETTING, lookup: cats })).toEqual({ action: 'move', categoryId: TYPE_CAT, source: 'type' });
    expect(resolveReopenCategory({ openCategoryId: '999999999999999999', typeCategoryId: TYPE_CAT, lookup: cats })).toMatchObject({ categoryId: TYPE_CAT });
  });
  it('catégorie d’origine pleine ou absente : le salon reste où il est', () => {
    expect(resolveReopenCategory({ openCategoryId: ORIGIN, lookup: lookupOf({ [ORIGIN]: 50 }) })).toMatchObject({ action: 'stay', reason: 'full' });
    expect(resolveReopenCategory({ openCategoryId: null, typeCategoryId: null, lookup: lookupOf({}) })).toEqual({ action: 'stay', reason: 'none' });
  });
});

describe('planMemberAccess — qui perd l’accès à la fermeture', () => {
  it('créateur et membres ajoutés perdent l’accès, le staff le garde', () => {
    const staff = new Set(['mod']);
    const plan = planMemberAccess({ openerId: 'opener', participants: ['friend', 'mod', 'friend'], isStaff: (id) => staff.has(id) });
    expect(plan.members).toEqual(['opener', 'friend']);
    expect(plan.staff).toEqual(['mod']);
  });
  it('un créateur membre du staff n’est jamais bloqué', () => {
    expect(planMemberAccess({ openerId: 'mod', participants: [], isStaff: () => true })).toEqual({ members: [], staff: ['mod'] });
  });
});
