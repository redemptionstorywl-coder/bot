import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guild } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [] }) }));

import { prisma as prismaClient } from '../../src/database/client';
import { parseButtonLines, renderPanel, MAX_PANEL_BUTTONS } from '../../src/commands/roles/_welcomeShared';
import { welcomeService } from '../../src/services/WelcomeService';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;

const t = (key: string, vars: Record<string, unknown> = {}) => `${key}${Object.keys(vars).length ? `[${Object.values(vars).join(',')}]` : ''}`;
const guild = { id: '222222222222222222', name: 'Redemption Story' } as unknown as Guild;

describe('parseButtonLines', () => {
  it('parse « label | url | emoji » en boutons liens', () => {
    const r = parseButtonLines('Site | https://example.com | 🌐\nDocs|https://docs.example.com');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buttons).toEqual([
      { label: 'Site', style: 'link', url: 'https://example.com', emoji: '🌐' },
      { label: 'Docs', style: 'link', url: 'https://docs.example.com' },
    ]);
  });

  it('refuse une URL invalide ou trop de lignes', () => {
    expect(parseButtonLines('Site | ftp://x').ok).toBe(false);
    expect(parseButtonLines('| https://example.com').ok).toBe(false);
    expect(parseButtonLines(Array.from({ length: MAX_PANEL_BUTTONS + 1 }, (_, i) => `B${i} | https://e.com/${i}`).join('\n')).ok).toBe(false);
  });
});

describe('renderPanel', () => {
  beforeEach(() => welcomeService.invalidate(guild.id));

  it('onglet bienvenue : 4 rangées, onglet actif en Primary, notice dans la description', async () => {
    prisma.welcomeConfig.findUnique.mockResolvedValueOnce({
      guildId: guild.id,
      enabled: true,
      channelId: '333333333333333333',
      message: { fr: 'Salut {user}', en: 'Hi {user}' },
      embed: { title: 'Bienvenue !' },
      imageEnabled: false,
      imageBackgroundUrl: null,
      imageTitle: 'BIENVENUE',
      imageSubtitle: '{username}',
      dmEnabled: false,
      dmMessage: null,
      dmEmbed: null,
      buttons: [{ label: 'Site', style: 'link', url: 'https://example.com' }],
      languagePromptEnabled: true,
      updatedAt: new Date(),
    });
    const payload = await renderPanel({ guild, tab: 'welcome', t, lang: 'en', fallbackLang: 'fr', notice: { type: 'success', text: 'OK' } });
    expect(payload.components).toHaveLength(4);
    const rows = payload.components.map((r) => r.toJSON());
    const [welcomeTab, leaveTab] = rows[0]!.components as { custom_id: string; style: number }[];
    expect(welcomeTab!.custom_id).toBe('welcome:cfg:tab:welcome');
    expect(welcomeTab!.style).toBe(1); // Primary
    expect(leaveTab!.style).toBe(2); // Secondary
    expect((rows[1]!.components[0] as { custom_id: string }).custom_id).toBe('welcome:cfg:channel:welcome');
    expect(rows[3]!.components).toHaveLength(5);
    const embed = payload.embeds[0]!.toJSON();
    expect(embed.description).toContain('✅ OK');
    const message = embed.fields!.find((f) => f.name.startsWith('welcome.config.kind_message'));
    expect(message!.value).toContain('Hi {user}');
    expect(embed.fields!.find((f) => f.name.startsWith('welcome.config.kind_embed'))!.value).toContain('Bienvenue !');
  });

  it('onglet départ : toggle logs présent, pas de rangée DM', async () => {
    prisma.leaveConfig.findUnique.mockResolvedValueOnce(null);
    const payload = await renderPanel({ guild, tab: 'leave', t, lang: 'fr', fallbackLang: 'fr' });
    const ids = payload.components.flatMap((r) => r.toJSON().components.map((c) => (c as { custom_id?: string }).custom_id));
    expect(ids).toContain('welcome:cfg:logs:leave');
    expect(ids).not.toContain('welcome:cfg:dm:leave');
    expect(ids).not.toContain('welcome:cfg:dm:welcome');
    expect(ids.every((id) => !id || id.length <= 100)).toBe(true);
  });
});
