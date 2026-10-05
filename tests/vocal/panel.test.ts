import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, type Guild, type GuildMember } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma as prismaClient } from '../../src/database/client';
import { MODULE_KEYS, type ModuleKey } from '../../src/config/constants';
import { translationService } from '../../src/services/TranslationService';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import { MAX_RULES, ruleFromPreset } from '../../src/services/TempVoiceService';
import { moveRule, parseLimitField, renderVocal, editModal, fallbackModal, buildLimitModal } from '../../src/panels/_vocal';
import { PanelError } from '../../src/panels/_modulesKit';
import vocalPanel from '../../src/panels/vocal';
import shopPanel from '../../src/panels/shop';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;
const tFr = translationService.bind('fr');
const tEn = translationService.bind('en');

const LOBBY = '200000000000000001';
const FR_ROLE = '300000000000000001';
let seq = 0;

function fakeGuild(): Guild {
  seq++;
  return {
    id: `9100000000000000${String(seq).padStart(2, '0')}`,
    name: 'Redemption Story',
    roles: { cache: new Map([[FR_ROLE, { id: FR_ROLE, name: 'Français' }]]) },
    channels: { cache: new Map([[LOBBY, { id: LOBBY, name: '➕ Créer un salon', isVoiceBased: () => true }]]) },
    members: { me: null },
  } as unknown as Guild;
}

function fakeConfig(guild: Guild, modules: Partial<Record<ModuleKey, boolean>> = {}): ResolvedGuildConfig {
  return {
    guildId: guild.id,
    kind: 'GENERIC',
    name: guild.name,
    defaultLanguage: 'fr',
    timezone: 'Europe/Paris',
    brandColor: 0x7c3aed,
    adminRoleIds: [],
    staffRoleIds: [],
    modules: { ...(Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<ModuleKey, boolean>), ...modules },
    logChannels: {},
    footerText: null,
    footerIconUrl: null,
    raw: {} as ResolvedGuildConfig['raw'],
  };
}

type Json = { type: number; custom_id?: string; components?: Json[]; options?: { label: string; value: string; description?: string }[]; placeholder?: string; label?: string; max_values?: number };

function checkLimits(payload: Awaited<ReturnType<typeof renderVocal>>): Json[] {
  const rows = payload.components.map((r) => r.toJSON() as unknown as Json);
  expect(rows.length).toBeLessThanOrEqual(5);
  const flat: Json[] = [];
  for (const r of rows) {
    const cs = r.components ?? [];
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.length).toBeLessThanOrEqual(5);
    if (cs.some((c) => c.type !== ComponentType.Button)) expect(cs).toHaveLength(1);
    for (const c of cs) {
      flat.push(c);
      if (c.custom_id) expect(c.custom_id.length).toBeLessThanOrEqual(100);
      if (c.label) expect(c.label.length).toBeLessThanOrEqual(80);
      if (c.placeholder) expect(c.placeholder.length).toBeLessThanOrEqual(150);
      for (const o of c.options ?? []) {
        expect(o.label.length).toBeLessThanOrEqual(100);
        if (o.description) expect(o.description.length).toBeLessThanOrEqual(100);
      }
    }
  }
  for (const e of payload.embeds.map((x) => x.toJSON())) {
    expect((e.description ?? '').length).toBeLessThanOrEqual(4096);
    for (const f of e.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(1024);
  }
  return flat;
}

const configRow = (guildId: string, over: Record<string, unknown> = {}) => ({ guildId, lobbyIds: [LOBBY], categoryId: null, userLimit: null, rules: [ruleFromPreset(FR_ROLE, 'fr')], fallback: null, ownerPermissions: true, transferOwnership: true, updatedAt: new Date(), ...over });

beforeEach(() => {
  prisma.tempVoiceChannel.findMany.mockResolvedValue([]);
});

describe('/config module:vocal', () => {
  it('panneau vocal : ordre 13, après les panneaux existants', () => {
    expect(vocalPanel).toMatchObject({ key: 'vocal', order: 13, module: 'vocal', emoji: '🔊' });
    expect(vocalPanel.order).toBeGreaterThan(shopPanel.order);
  });

  it('vue principale : lobbies, catégorie, règles, aperçu du nom du membre (fr / en)', async () => {
    for (const t of [tFr, tEn]) {
      const guild = fakeGuild();
      prisma.tempVoiceConfig.findUnique.mockResolvedValue(configRow(guild.id));
      const member = { displayName: 'Bob', user: { username: 'bob' }, roles: { cache: new Map([[FR_ROLE, {}]]) } } as unknown as GuildMember;
      const payload = await renderVocal({ guild, config: fakeConfig(guild), t, member });
      const components = checkLimits(payload);
      expect(components.find((c) => c.custom_id === 'cfg-vocal:lobbies')).toMatchObject({ type: ComponentType.ChannelSelect, max_values: 10 });
      expect(components.some((c) => c.custom_id === 'cfg-vocal:category')).toBe(true);
      expect(components.some((c) => c.custom_id === 'cfg-vocal:view:rules')).toBe(true);
      const text = JSON.stringify(payload.embeds[0]!.toJSON());
      expect(text).toContain('🇫🇷 Salon de Bob');
      expect(text).toContain("🇬🇧 Alex's lobby");
    }
  });

  it('vue règles : langue choisie → menu de rôle ; règle sélectionnée → actions', async () => {
    const guild = fakeGuild();
    prisma.tempVoiceConfig.findUnique.mockResolvedValue(configRow(guild.id, { rules: [ruleFromPreset(FR_ROLE, 'fr'), ruleFromPreset('300000000000000002', 'es')] }));
    const payload = await renderVocal({ guild, config: fakeConfig(guild), t: tFr, view: 'rules', picked: 'de', selected: 1 });
    const ids = checkLimits(payload).map((c) => c.custom_id);
    expect(ids).toEqual(expect.arrayContaining(['cfg-vocal:preset', 'cfg-vocal:role:de', 'cfg-vocal:rule', 'cfg-vocal:up:1', 'cfg-vocal:down:1', 'cfg-vocal:edit:1', 'cfg-vocal:del:1', 'cfg-vocal:fallback', 'cfg-vocal:view:main']));
  });

  it('20 règles : la vue reste dans les limites Discord', async () => {
    const guild = fakeGuild();
    const rules = Array.from({ length: MAX_RULES }, (_, i) => ruleFromPreset(`3000000000000001${String(i).padStart(2, '0')}`, 'pt'));
    prisma.tempVoiceConfig.findUnique.mockResolvedValue(configRow(guild.id, { rules }));
    checkLimits(await renderVocal({ guild, config: fakeConfig(guild), t: tFr, view: 'rules', picked: 'fr', selected: 0 }));
    checkLimits(await renderVocal({ guild, config: fakeConfig(guild, { vocal: false }), t: tEn }));
  });

  it('modals : limite, règle, repli', async () => {
    const guild = fakeGuild();
    prisma.tempVoiceConfig.findUnique.mockResolvedValue(configRow(guild.id, { userLimit: 4 }));
    const { tempVoiceService } = await import('../../src/services/TempVoiceService');
    const settings = await tempVoiceService.getConfig(guild.id);
    expect(buildLimitModal(settings, tFr).toJSON().custom_id).toBe('cfg-vocal:limit');
    expect(editModal(0, settings, tFr).toJSON().custom_id).toBe('cfg-vocal:edit:0');
    expect(fallbackModal(settings, tEn).toJSON().custom_id).toBe('cfg-vocal:fallback');
    expect(() => editModal(5, settings, tFr)).toThrow(PanelError);
  });

  it('limite saisie et réordonnancement des règles', () => {
    expect(parseLimitField(undefined, tFr)).toBeNull();
    expect(parseLimitField('0', tFr)).toBe(0);
    expect(parseLimitField('12', tFr)).toBe(12);
    expect(() => parseLimitField('100', tFr)).toThrow(PanelError);
    expect(() => parseLimitField('abc', tFr)).toThrow(PanelError);
    expect(moveRule(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveRule(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveRule(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
});
