import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { TranslationService } from '../../src/services/TranslationService';

describe('TranslationService', () => {
  const service = new TranslationService(path.resolve(__dirname, '../../src/locales'));

  it('charge fr et en', () => {
    expect(service.availableLanguages).toContain('fr');
    expect(service.availableLanguages).toContain('en');
  });
  it('traduit avec interpolation', () => {
    expect(service.translate('fr', 'core.module_disabled', { module: 'Tickets' })).toContain('Tickets');
    expect(service.translate('en', 'core.yes')).toBe('Yes');
  });
  it('retombe sur en puis sur la clé', () => {
    expect(service.translate('xx', 'core.yes')).toBe('Yes');
    expect(service.translate('fr', 'does.not.exist')).toBe('does.not.exist');
  });
  it('bind() lie la langue', () => {
    const t = service.bind('fr');
    expect(t('core.no')).toBe('Non');
  });
});
