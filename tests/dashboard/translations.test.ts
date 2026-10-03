import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { buildTranslationRows } from '../../dashboard/routes/guild/translations';

describe('buildTranslationRows', () => {
  const catalog = { 'core.yes': 'Oui', 'core.no': 'Non', 'tickets.open.title': 'Ouvrir un ticket' };
  const overrides = { 'core.yes': 'Ouais' };
  const globals = { 'core.no': 'Nope' };

  it('fusionne catalogue et overrides, trié par clé', () => {
    const rows = buildTranslationRows(catalog, globals, overrides, '', 'all');
    expect(rows.map((r) => r.key)).toEqual(['core.no', 'core.yes', 'tickets.open.title']);
    expect(rows[1]).toEqual({ key: 'core.yes', defaultValue: 'Oui', globalOverride: null, override: 'Ouais' });
    expect(rows[0].globalOverride).toBe('Nope');
  });
  it('filtre par recherche sur la clé ou les valeurs', () => {
    expect(buildTranslationRows(catalog, globals, overrides, 'ticket', 'all').map((r) => r.key)).toEqual(['tickets.open.title']);
    expect(buildTranslationRows(catalog, globals, overrides, 'ouais', 'all').map((r) => r.key)).toEqual(['core.yes']);
  });
  it('ne garde que les overrides si demandé', () => {
    expect(buildTranslationRows(catalog, globals, overrides, '', 'overrides').map((r) => r.key)).toEqual(['core.yes']);
  });
});
