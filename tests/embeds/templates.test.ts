import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
import { prisma } from '../../src/database/client';

const prismaMock = prisma as unknown as ReturnType<typeof createPrismaMock>;

import { EmbedTemplateError, EmbedTemplateService } from '../../src/services/EmbedTemplateService';

describe('EmbedTemplateService.create', () => {
  it('refuse un nom en doublon et un spec invalide', async () => {
    const service = new EmbedTemplateService();
    prismaMock.embedTemplate.findUnique.mockResolvedValueOnce({ id: 9, name: 'Dup' });
    await expect(service.create('g', { name: 'Dup', spec: { title: 'x' } }, 'u')).rejects.toBeInstanceOf(EmbedTemplateError);
    await expect(service.create('g', { name: 'Bad', spec: { color: 'nope' } }, 'u')).rejects.toMatchObject({ code: 'invalid_spec' });
  });
});
