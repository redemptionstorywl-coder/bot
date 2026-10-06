import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma as prismaClient } from '../../src/database/client';
import { BRAND, DEFAULT_BRAND_HEX, EMBED_COLOR_PALETTE } from '../../src/config/constants';
import { guildConfigService } from '../../src/services/GuildConfigService';
import { embedService } from '../../src/services/EmbedService';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;
const ROOT = path.resolve(__dirname, '..', '..');
const guildRow = (brandColor: string | null) => ({ id: '100000000000000001', name: 'RS', kind: 'BATTLE_ROYALE', settings: brandColor === null ? null : { guildId: '100000000000000001', brandColor, defaultLanguage: 'fr', modules: {}, adminRoleIds: [], staffRoleIds: [] }, logChannels: [] });

describe('Couleur des embeds par défaut : bleu #2F8BFF', () => {
  it('BRAND et couleur par défaut du serveur', () => {
    expect(BRAND.colors.primary).toBe(0x2f8bff);
    expect(BRAND.colors.success).toBe(0x2f8bff);
    expect(DEFAULT_BRAND_HEX).toBe('#2F8BFF');
    expect(EMBED_COLOR_PALETTE[0]).toMatchObject({ key: 'brand_blue', hex: DEFAULT_BRAND_HEX });
  });

  it('un embed sans couleur est bleu', () => {
    expect(embedService.build({ title: 'Test' }).data.color).toBe(0x2f8bff);
  });

  it('serveur sans réglage → bleu ; couleur choisie conservée', async () => {
    prisma.guild.findUnique.mockResolvedValueOnce(guildRow(null));
    expect((await guildConfigService.get('100000000000000001'))!.brandColor).toBe(0x2f8bff);
    guildConfigService.invalidate('100000000000000001');
    prisma.guild.findUnique.mockResolvedValueOnce(guildRow('#EF4444'));
    expect((await guildConfigService.get('100000000000000001'))!.brandColor).toBe(0xef4444);
    guildConfigService.invalidate('100000000000000001');
  });

  it('schéma + migration : défaut bleu et anciens violets par défaut convertis', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toContain('brandColor      String          @default("#2F8BFF")');
    const sql = fs.readFileSync(path.join(ROOT, 'prisma', 'migrations', '20261012000001_blue_default', 'migration.sql'), 'utf8');
    expect(sql).toContain("MODIFY `brandColor` VARCHAR(9) NOT NULL DEFAULT '#2F8BFF'");
    expect(sql).toMatch(/UPDATE `GuildSettings` SET `brandColor` = '#2F8BFF' WHERE .*'7C3AED', '8141037'/);
  });
});
