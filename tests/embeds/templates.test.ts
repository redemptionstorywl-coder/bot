import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
import { prisma } from '../../src/database/client';

const prismaMock = prisma as unknown as ReturnType<typeof createPrismaMock>;

import { EmbedTemplateError, EmbedTemplateService } from '../../src/services/EmbedTemplateService';

describe('EmbedTemplateService.ensureDefaults', () => {
  beforeEach(() => {
    prismaMock.embedTemplate.findMany.mockReset();
    prismaMock.embedTemplate.create.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }));
  });

  it('crée les 8 templates manquants puis ne refait rien (cache)', async () => {
    const service = new EmbedTemplateService();
    prismaMock.embedTemplate.findMany.mockResolvedValue([]);
    const created = await service.ensureDefaults('g1', 'u1', 'fr');
    expect(created).toBe(8);
    expect(prismaMock.embedTemplate.create).toHaveBeenCalledTimes(8);
    const again = await service.ensureDefaults('g1', 'u1', 'fr');
    expect(again).toBe(0);
  });

  it('ne recrée pas les templates existants (par nom)', async () => {
    const service = new EmbedTemplateService();
    const existing = service.buildDefaultTemplates('fr').slice(0, 3).map((tpl, i) => ({ id: i + 1, guildId: 'g2', name: tpl.name, description: null, spec: tpl.spec, buttons: [], createdById: 'u', createdAt: new Date(), updatedAt: new Date() }));
    prismaMock.embedTemplate.findMany.mockResolvedValue(existing);
    const created = await service.ensureDefaults('g2', 'u1', 'fr');
    expect(created).toBe(5);
  });
});

describe('EmbedTemplateService.create', () => {
  it('refuse un nom en doublon et un spec invalide', async () => {
    const service = new EmbedTemplateService();
    prismaMock.embedTemplate.findUnique.mockResolvedValueOnce({ id: 9, name: 'Dup' });
    await expect(service.create('g', { name: 'Dup', spec: { title: 'x' } }, 'u')).rejects.toBeInstanceOf(EmbedTemplateError);
    await expect(service.create('g', { name: 'Bad', spec: { color: 'nope' } }, 'u')).rejects.toMatchObject({ code: 'invalid_spec' });
  });
});
