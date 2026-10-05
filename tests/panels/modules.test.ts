import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, type Guild, type ModalBuilder } from 'discord.js';
import { Prisma } from '@prisma/client';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [], DASHBOARD_URL: 'https://bot.example.com/', FIVEM_API_KEY: 'global-key' }) }));

import { prisma as prismaClient } from '../../src/database/client';
import { MODULE_KEYS, type ModuleKey } from '../../src/config/constants';
import { translationService } from '../../src/services/TranslationService';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import type { PanelPayload } from '../../src/panels/_modulesKit';
import { PanelError, describeError, parseIntField } from '../../src/panels/_modulesKit';
import * as roles from '../../src/panels/_roles';
import * as fivem from '../../src/panels/_fivem';
import * as br from '../../src/panels/_battleroyale';
import * as wl from '../../src/panels/_whitelist';
import * as school from '../../src/panels/_school';
import * as shop from '../../src/panels/_shop';
import rolesPanel from '../../src/panels/roles';
import fivemPanel from '../../src/panels/fivem';
import brPanel from '../../src/panels/battleroyale';
import wlPanel from '../../src/panels/whitelist';
import schoolPanel from '../../src/panels/school';
import shopPanel from '../../src/panels/shop';
import { ShopError } from '../../src/services/ShopService';
import { buildRoleMenuCreateModal } from '../../src/buttons/_rolemenuEditor';
import { roleService } from '../../src/services/RoleService';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;

// ───────── Fixtures ─────────

const ROLE_A = '100000000000000001';
const ROLE_B = '100000000000000002';
const CHANNEL = '200000000000000001';
const VOICE = '200000000000000002';
const USER = '300000000000000001';

let guildSeq = 0;
/** Faux serveur (id unique par test : les services mettent leur config en cache par serveur). */
function fakeGuild(): Guild {
  guildSeq++;
  return {
    id: `9000000000000000${String(guildSeq).padStart(2, '0')}`,
    name: 'Redemption Story',
    roles: { cache: new Map([[ROLE_A, { name: 'Membre' }], [ROLE_B, { name: 'Staff' }]]) },
    channels: { cache: new Map([[CHANNEL, { name: 'général' }], [VOICE, { name: 'En ligne' }]]) },
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

const tFr = translationService.bind('fr');
const tEn = translationService.bind('en');

// ───────── Vérification des limites Discord ─────────

type Json = Record<string, unknown> & { type: number; custom_id?: string; components?: Json[] };

function checkPayload(payload: PanelPayload): Json[] {
  const rows = payload.components.map((r) => r.toJSON() as unknown as Json);
  expect(rows.length).toBeLessThanOrEqual(5);
  const ids = new Set<string>();
  const components: Json[] = [];
  for (const r of rows) {
    const cs = r.components ?? [];
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.length).toBeLessThanOrEqual(5);
    if (cs.some((c) => c.type !== ComponentType.Button)) expect(cs).toHaveLength(1);
    for (const c of cs) {
      components.push(c);
      if (c.custom_id) {
        expect(c.custom_id.length).toBeLessThanOrEqual(100);
        expect(ids.has(c.custom_id), `customId dupliqué ${c.custom_id}`).toBe(false);
        ids.add(c.custom_id);
      }
      if (c.type === ComponentType.Button) expect(String(c.label ?? '').length).toBeLessThanOrEqual(80);
      if (typeof c.placeholder === 'string') expect(c.placeholder.length).toBeLessThanOrEqual(150);
      const options = c.options as { label: string; value: string; description?: string; default?: boolean }[] | undefined;
      if (options) {
        expect(options.length).toBeGreaterThan(0);
        expect(options.length).toBeLessThanOrEqual(25);
        for (const o of options) {
          expect(o.label.length).toBeLessThanOrEqual(100);
          expect(o.value.length).toBeLessThanOrEqual(100);
          if (o.description) expect(o.description.length).toBeLessThanOrEqual(100);
        }
        expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
      }
      if (typeof c.max_values === 'number') {
        expect(c.max_values).toBeLessThanOrEqual(25);
        expect(Number(c.min_values ?? 1)).toBeLessThanOrEqual(c.max_values);
      }
    }
  }
  for (const e of payload.embeds.map((x) => x.toJSON())) {
    expect((e.title ?? '').length).toBeLessThanOrEqual(256);
    expect((e.description ?? '').length).toBeLessThanOrEqual(4096);
    expect((e.fields ?? []).length).toBeLessThanOrEqual(25);
    for (const f of e.fields ?? []) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.value.length).toBeGreaterThan(0);
      expect(f.value.length).toBeLessThanOrEqual(1024);
    }
  }
  // Aucune clé de traduction brute dans le rendu
  expect(JSON.stringify({ rows, embeds: payload.embeds })).not.toMatch(/panels_modules\.|"(roles|fivem|battleroyale|whitelist|school|shop|core)\.[a-z_]+\.[a-z_]/);
  return components;
}

function checkModal(m: ModalBuilder): Json[] {
  const json = m.toJSON() as unknown as { custom_id: string; title: string; components: Json[] };
  expect(json.custom_id.length).toBeLessThanOrEqual(100);
  expect(json.title.length).toBeGreaterThan(0);
  expect(json.title.length).toBeLessThanOrEqual(45);
  expect(json.components.length).toBeGreaterThan(0);
  expect(json.components.length).toBeLessThanOrEqual(5);
  for (const label of json.components) {
    expect(label.type).toBe(ComponentType.Label);
    expect(String(label.label).length).toBeLessThanOrEqual(45);
    if (label.description) expect(String(label.description).length).toBeLessThanOrEqual(100);
  }
  expect(JSON.stringify(json)).not.toMatch(/panels_modules\./);
  return json.components.map((l) => (l as unknown as { component: Json }).component);
}

const byId = (components: Json[], id: string) => components.find((c) => c.custom_id === id);
const defaults = (c: Json | undefined) => ((c?.default_values as { id: string }[] | undefined) ?? []).map((d) => d.id);
const defaultOptions = (c: Json | undefined) => ((c?.options as { value: string; default?: boolean }[] | undefined) ?? []).filter((o) => o.default).map((o) => o.value);

// ───────── Rendus ─────────

describe('panneaux /config — déclaration', () => {
  it('clés, ordres et types de serveur', () => {
    expect([rolesPanel, fivemPanel, brPanel, wlPanel, schoolPanel, shopPanel].map((p) => [p.key, p.order])).toEqual([
      ['roles', 7],
      ['fivem', 8],
      ['battleroyale', 9],
      ['whitelist', 10],
      ['school', 11],
      ['shop', 12],
    ]);
    expect(brPanel.guildKinds).toEqual(['BATTLE_ROYALE']);
    expect(wlPanel.guildKinds).toEqual(['PRISON', 'SCHOOL']);
    expect(schoolPanel.guildKinds).toEqual(['SCHOOL']);
    expect(shopPanel.guildKinds).toEqual(['SHOP']);
  });
});

describe('panneau roles', () => {
  beforeEach(() => {
    prisma.autoRole.findMany.mockResolvedValue([
      { id: 1, guildId: 'g', roleId: ROLE_A, type: 'JOIN', delaySeconds: 600, enabled: true, createdAt: new Date() },
      { id: 2, guildId: 'g', roleId: ROLE_B, type: 'VERIFIED', delaySeconds: 0, enabled: true, createdAt: new Date() },
    ]);
    prisma.roleMenu.findMany.mockResolvedValue([{ id: 3, guildId: 'g', name: 'Jeux', embed: { title: 'Jeux' }, style: 'SELECT', options: [{ roleId: ROLE_A, label: 'GTA' }], exclusive: true, placeholder: null, minValues: 0, maxValues: 25, channelId: CHANNEL, messageId: '400000000000000001' }]);
    prisma.reactionRole.findMany.mockResolvedValue([{ id: 5, guildId: 'g', channelId: CHANNEL, messageId: '400000000000000002', emoji: 'pepe:500000000000000001', roleId: ROLE_A }]);
    prisma.notificationRole.findMany.mockResolvedValue([{ id: 1, guildId: 'g', key: 'streams', roleId: ROLE_A, label: 'Streams', emoji: '📺', description: null, order: 0, enabled: true }]);
  });

  it('onglet auto-roles : 5 rangées, RoleSelect pré-remplis par déclencheur', async () => {
    const guild = fakeGuild();
    const payload = await roles.renderRoles('auto', { guild, config: fakeConfig(guild), t: tFr, userId: USER });
    const cs = checkPayload(payload);
    expect(payload.components).toHaveLength(5);
    expect(defaults(byId(cs, 'cfg-roles:auto:JOIN'))).toEqual([ROLE_A]);
    expect(defaults(byId(cs, 'cfg-roles:auto:BOT'))).toEqual([]);
    expect(defaults(byId(cs, 'cfg-roles:auto:VERIFIED'))).toEqual([ROLE_B]);
    expect(byId(cs, 'cfg-roles:auto:JOIN')?.min_values).toBe(0);
    expect(byId(cs, 'cfg-roles:tab:auto')?.disabled).toBe(true);
    expect(byId(cs, 'cfg-roles:module:auto')).toBeDefined();
  });

  it('onglets role menus / réactions / notifications', async () => {
    for (const tab of ['menus', 'reactions', 'notifs'] as const) {
      const guild = fakeGuild();
      const cs = checkPayload(await roles.renderRoles(tab, { guild, config: fakeConfig(guild, { [roles.TAB_MODULE[tab]]: false }), t: tEn, userId: USER }));
      expect(byId(cs, `cfg-roles:module:${tab}`)?.label).toMatch(/^Enable/);
    }
    const guild = fakeGuild();
    const cs = checkPayload(await roles.renderRoles('menus', { guild, config: fakeConfig(guild), t: tFr, userId: USER }));
    expect((byId(cs, 'cfg-roles:menu')?.options as { value: string }[]).map((o) => o.value)).toEqual(['3']);
  });

  it('modals : délais pré-remplis, reaction role (RoleSelect), notification, création de menu', async () => {
    const guild = fakeGuild();
    const delays = checkModal(await roles.buildDelaysModal(guild.id, tFr));
    expect(delays.map((c) => c.value ?? '')).toEqual(['10m', '', '']);
    const rr = checkModal(roles.buildReactionRoleModal(tFr));
    expect(rr[2]?.type).toBe(ComponentType.RoleSelect);
    checkModal(roles.buildNotificationModal(tFr));
    checkModal(buildRoleMenuCreateModal(tFr));
  });

  it('éditeur de role menu réutilisé : ≤ 5 rangées avec retour au panneau', () => {
    const menu = { id: 3, guildId: 'g', name: 'Jeux', embed: { title: 'Jeux' }, style: 'SELECT', options: [{ roleId: ROLE_A, label: 'GTA' }], exclusive: false, placeholder: null, minValues: 0, maxValues: 25, channelId: null, messageId: null };
    const editor = roleService.buildRoleMenuEditor(menu as never, fakeGuild(), tFr);
    const cs = checkPayload(editor);
    expect(editor.components).toHaveLength(5);
    expect(cs.at(-1)?.custom_id).toBe('cfg-roles:tab:menus');
    expect(editor.content).toBe('');
  });

  it('fonctions pures', () => {
    expect(roles.diffSelection([ROLE_A, ROLE_B], [ROLE_B, '3'])).toEqual({ add: ['3'], remove: [ROLE_A] });
    expect(roles.parseDelayInput('')).toBe(0);
    expect(roles.parseDelayInput('0')).toBe(0);
    expect(roles.parseDelayInput('1h30m')).toBe(5400);
    expect(roles.parseDelayInput(roles.formatDelay(5400))).toBe(5400);
    expect(() => roles.parseDelayInput('2d')).toThrow(PanelError);
    expect(() => roles.parseDelayInput('demain')).toThrow(PanelError);
    expect(roles.parseMessageLink('https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333')).toEqual({ guildId: '111111111111111111', channelId: '222222222222222222', messageId: '333333333333333333' });
    expect(roles.parseMessageLink('https://ptb.discord.com/channels/111111111111111111/222222222222222222/333333333333333333/')).not.toBeNull();
    expect(roles.parseMessageLink('pas un lien')).toBeNull();
  });
});

const server = {
  id: 1,
  guildId: 'g',
  key: 'br-principal-avec-une-cle-tres-longue-pour-tester-la-limite-64c',
  name: 'Redemption BR',
  framework: 'CUSTOM',
  host: 'http://1.2.3.4:30120',
  apiKey: null,
  statusChannelId: CHANNEL,
  statusMessageId: null,
  lastStatus: { online: true, players: 12, maxPlayers: 64, version: 'FXServer-master v1.0.0.7290', playerList: [] },
  lastSeenAt: new Date(),
  maintenance: false,
  enabled: true,
  syncBansToDiscord: true,
  syncBansToGame: false,
  syncKicks: false,
  syncNicknames: true,
  nicknameFormat: '[{id}] {name}',
  linkedRoleId: ROLE_A,
  onlineRoleId: null,
  playerCountChannelId: VOICE,
  requireDiscord: true,
  requireRoleId: null,
  requireWhitelist: false,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

describe('panneau fivem', () => {
  it('vue principale : liste avec statut 🟢 et URL d’installation', async () => {
    prisma.fiveMServer.findMany.mockResolvedValue([server]);
    const guild = fakeGuild();
    const payload = await fivem.renderMain({ guild, config: fakeConfig(guild), t: tFr });
    const cs = checkPayload(payload);
    const text = JSON.stringify(payload.embeds);
    expect(text).toContain('🟢');
    expect(text).toContain('12/64');
    expect(text).toContain('https://bot.example.com/api/fivem');
    expect((byId(cs, 'cfg-fivem:pick')?.options as { value: string }[])[0]?.value).toBe(server.key);
  });

  it('vue serveur : salons et options de synchronisation pré-remplis, customIds < 100', () => {
    const guild = fakeGuild();
    const payload = fivem.renderServer(server as never, { guild, config: fakeConfig(guild), t: tFr });
    const cs = checkPayload(payload);
    expect(payload.components).toHaveLength(5);
    expect(defaults(byId(cs, `cfg-fivem:status:${server.key}`))).toEqual([CHANNEL]);
    expect(defaults(byId(cs, `cfg-fivem:counter:${server.key}`))).toEqual([VOICE]);
    expect(defaultOptions(byId(cs, `cfg-fivem:sync:${server.key}`))).toEqual(['syncBansToDiscord', 'syncNicknames', 'requireDiscord']);
    expect(JSON.stringify(payload.embeds)).toContain(`\`${server.key}\``);
  });

  it('vue rôles et confirmation de suppression', () => {
    const guild = fakeGuild();
    const cs = checkPayload(fivem.renderRolesView(server as never, { guild, config: fakeConfig(guild), t: tEn }));
    expect(defaults(byId(cs, `cfg-fivem:role:linked:${server.key}`))).toEqual([ROLE_A]);
    expect(defaults(byId(cs, `cfg-fivem:role:online:${server.key}`))).toEqual([]);
    checkPayload(fivem.renderDeleteConfirm(server as never, tFr));
  });

  it('modals : ajout (framework en menu), édition, pseudo, liaison', () => {
    const add = checkModal(fivem.buildAddModal(tFr));
    expect(add.map((c) => c.custom_id)).toEqual(['key', 'name', 'framework', 'host', 'apiKey']);
    expect(add[2]?.type).toBe(ComponentType.StringSelect);
    const edit = checkModal(fivem.buildEditModal(server as never, tFr));
    expect(edit[0]?.value).toBe(server.name);
    expect(checkModal(fivem.buildNicknameModal(server as never, tFr))[0]?.value).toBe('[{id}] {name}');
    expect(checkModal(fivem.buildLinkModal(tFr))[0]?.type).toBe(ComponentType.UserSelect);
  });

  it('fonctions pures', () => {
    expect(fivem.syncPatchFromSelection(['syncKicks', 'requireWhitelist', 'inconnu'])).toEqual({ syncBansToDiscord: false, syncBansToGame: false, syncKicks: true, syncNicknames: false, requireDiscord: false, requireWhitelist: true });
    expect(fivem.normalizeHost('')).toBeNull();
    expect(fivem.normalizeHost('http://1.2.3.4:30120/')).toBe('http://1.2.3.4:30120');
    expect(() => fivem.normalizeHost('1.2.3.4:30120')).toThrow(PanelError);
    expect(fivem.parseFramework('ESX')).toBe('ESX');
    expect(fivem.parseFramework('autre')).toBe('CUSTOM');
    expect(fivem.isValidLicense('license:0123abcd4567')).toBe(true);
    expect(fivem.isValidLicense('steam:110000112345678')).toBe(false);
    expect(fivem.statusIcon({ online: true, maintenance: true })).toBe('🟠');
  });
});

describe('panneau battleroyale', () => {
  const pass = { id: 1, guildId: 'g', season: 2, name: 'Saison 2', startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2026-12-01T00:00:00Z'), tiers: [{ tier: 1, xpRequired: 1000, freeReward: '500 crédits', premiumReward: null }], active: true, createdAt: new Date() };

  it('vue principale : saison active pré-sélectionnée', async () => {
    prisma.battlePass.findMany.mockResolvedValue([pass, { ...pass, id: 2, season: 1, name: 'Saison 1', active: false }]);
    const guild = fakeGuild();
    const payload = await br.renderMain({ guild, config: fakeConfig(guild), t: tFr });
    const cs = checkPayload(payload);
    expect(defaultOptions(byId(cs, 'cfg-battleroyale:season'))).toEqual(['2']);
    expect(byId(cs, 'cfg-battleroyale:bp')?.disabled).toBe(false);
    expect(JSON.stringify(payload.embeds)).toMatch(/BATTLE_ROYALE/); // avertissement : serveur GENERIC
  });

  it('vue Battle Pass + modals', async () => {
    prisma.battlePass.findFirst.mockResolvedValue(pass);
    const guild = fakeGuild();
    checkPayload(await br.renderBattlePass({ guild, config: fakeConfig(guild), t: tEn }));
    expect(checkModal(br.buildTiersModal(pass as never, tFr))[0]?.value).toBe('1 | 1000 | 500 crédits | -');
    const season = checkModal(br.buildNewSeasonModal(tFr, new Date('2026-10-04T12:00:00Z')));
    expect(season.map((c) => c.value ?? '')).toEqual(['', '2026-10-04', '2027-01-02', '30', '1000']);
    expect((checkModal(br.buildStatModal(tFr))[1]?.options as unknown[]).length).toBe(br.STAT_CHOICES.length);
    checkModal(br.buildXpModal(tFr));
    checkModal(br.buildLinkModal(tFr));
    checkModal(br.buildGenerateModal(tFr));
  });

  it('parse les paliers multi-lignes', () => {
    const text = ['# palier | xp | gratuit | premium', '2 | 2 000 | - | Skin doré', '', '1 | 1000 | 500 crédits | -', '3 | 3000 | Caisse | Emote '].join('\n');
    const tiers = br.parseTierLines(text);
    expect(tiers).toEqual([
      { tier: 1, xpRequired: 1000, freeReward: '500 crédits', premiumReward: null },
      { tier: 2, xpRequired: 2000, freeReward: null, premiumReward: 'Skin doré' },
      { tier: 3, xpRequired: 3000, freeReward: 'Caisse', premiumReward: 'Emote' },
    ]);
    expect(br.parseTierLines(br.serializeTiers(tiers))).toEqual(tiers);
    expect(() => br.parseTierLines('1 | mille')).toThrow(/tier_invalid/);
    expect(() => br.parseTierLines('1 | 100\n1 | 200')).toThrow(/tier_duplicate/);
    expect(() => br.parseTierLines('1 | 500\n2 | 100')).toThrow(/tier_xp_order/);
    expect(() => br.parseTierLines('1 | 1 | a | b | c')).toThrow(/tier_invalid/);
    expect(() => br.parseTierLines(Array.from({ length: 101 }, (_, i) => `${i + 1} | ${i}`).join('\n'))).toThrow(/too_many_tiers/);
  });

  it('génération, dates, valeurs de stat', () => {
    const gen = br.generateTiers(3, 500, [{ tier: 2, xpRequired: 9, freeReward: 'Caisse', premiumReward: 'Skin' }]);
    expect(gen).toEqual([
      { tier: 1, xpRequired: 500, freeReward: null, premiumReward: null },
      { tier: 2, xpRequired: 1000, freeReward: 'Caisse', premiumReward: 'Skin' },
      { tier: 3, xpRequired: 1500, freeReward: null, premiumReward: null },
    ]);
    const fallback = new Date('2026-01-01T00:00:00Z');
    expect(br.parseDateInput('', fallback, 'Début')).toBe(fallback);
    expect(br.parseDateInput('2026-12-31', fallback, 'Fin').toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(br.parseDateInput('01/02/2027', fallback, 'Fin').toISOString()).toBe('2027-02-01T00:00:00.000Z');
    expect(() => br.parseDateInput('2026-02-30', fallback, 'Fin')).toThrow(PanelError);
    expect(br.parseStatValue('battlePassPremium', 'oui', 'v')).toBe(true);
    expect(br.parseStatValue('kills', '42', 'v')).toBe(42);
    expect(() => br.parseStatValue('kills', '-1', 'v')).toThrow(PanelError);
  });
});

describe('panneau whitelist', () => {
  it('rendu : salon / rôles pré-remplis, compteurs, questions', async () => {
    prisma.whitelistConfig.findUnique.mockResolvedValue({ guildId: 'g', questions: [{ id: 'q1', label: 'Âge du personnage', style: 'short', required: true }], reviewChannelId: CHANNEL, acceptedRoleId: ROLE_A, pendingRoleId: null, dmOnDecision: true, enabled: false });
    prisma.whitelist.groupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 3 } },
      { status: 'ACCEPTED', _count: { _all: 7 } },
    ]);
    const guild = fakeGuild();
    const payload = await wl.renderWhitelist({ guild, config: fakeConfig(guild), t: tFr, lang: 'fr' });
    const cs = checkPayload(payload);
    expect(defaults(byId(cs, 'cfg-whitelist:review'))).toEqual([CHANNEL]);
    expect(defaults(byId(cs, 'cfg-whitelist:accepted'))).toEqual([ROLE_A]);
    expect(defaults(byId(cs, 'cfg-whitelist:pending'))).toEqual([]);
    const text = JSON.stringify(payload.embeds);
    expect(text).toContain('⏳ 3 · ✅ 7 · ⛔ 0');
    expect(text).toContain('Âge du personnage');
    const modal = checkModal(await wl.buildQuestionsModal(guild.id, tFr));
    expect(modal).toHaveLength(5);
    expect(modal[0]?.value).toBe('Âge du personnage | short | required');
  });

  it('parse les questions (5 lignes)', () => {
    const qs = wl.parseWhitelistQuestionSlots(['Âge | court | obligatoire', '', 'Motivation | paragraph | optional | Expliquez…', undefined, '  ']);
    expect(qs).toEqual([
      { id: 'q1', label: 'Âge', style: 'short', required: true },
      { id: 'q3', label: 'Motivation', style: 'paragraph', required: false, placeholder: 'Expliquez…' },
    ]);
    expect(wl.parseWhitelistQuestionSlots(qs.map(wl.serializeWhitelistQuestion)).map((q) => q.label)).toEqual(['Âge', 'Motivation']);
    expect(wl.parseWhitelistQuestionSlots(['Seulement un libellé'])[0]).toMatchObject({ style: 'paragraph', required: true });
    expect(() => wl.parseWhitelistQuestionSlots(['x'.repeat(46)])).toThrow(/invalid_question/);
  });
});

describe('panneau school', () => {
  beforeEach(() => {
    prisma.schoolConfig.findUnique.mockResolvedValue({ guildId: 'g', applicationChannelId: CHANNEL, announceChannelId: null, studentRoleId: ROLE_A, teacherRoleId: null, staffRoleId: ROLE_B });
    prisma.schoolClass.findMany.mockResolvedValue([{ id: 1, guildId: 'g', name: '6e A', teacherId: USER, roleId: ROLE_A, channelId: CHANNEL, capacity: 30, _count: { students: 12 } }]);
    prisma.schoolClass.findFirst.mockResolvedValue({ id: 1, guildId: 'g', name: '6e A', teacherId: USER, roleId: ROLE_A, channelId: CHANNEL, capacity: 30, _count: { students: 12 } });
    prisma.schoolHouse.findMany.mockResolvedValue([{ id: 2, guildId: 'g', name: 'Lions', emoji: '🦁', color: '#C0392B', roleId: null, points: 120, _count: { members: 4 } }]);
    prisma.schoolClub.findMany.mockResolvedValue([]);
    prisma.schoolClub.findFirst.mockResolvedValue({ id: 3, guildId: 'g', name: 'Théâtre', description: 'Impro', leaderId: null, roleId: null, maxMembers: null, _count: { members: 0 } });
  });

  it('onglets : salons et rôles pré-remplis, listes', async () => {
    const guild = fakeGuild();
    const config = fakeConfig(guild, { school: false });
    let cs = checkPayload(await school.renderSchool('config', { guild, config, t: tFr }));
    expect(defaults(byId(cs, 'cfg-school:apps'))).toEqual([CHANNEL]);
    expect(defaults(byId(cs, 'cfg-school:announce'))).toEqual([]);
    expect(byId(cs, 'cfg-school:module')?.label).toMatch(/^Activer/);
    cs = checkPayload(await school.renderSchool('roles', { guild, config, t: tFr }));
    expect(defaults(byId(cs, 'cfg-school:role:STUDENT'))).toEqual([ROLE_A]);
    expect(defaults(byId(cs, 'cfg-school:role:STAFF'))).toEqual([ROLE_B]);
    for (const tab of ['classes', 'houses', 'clubs'] as const) checkPayload(await school.renderSchool(tab, { guild, config, t: tEn }));
    cs = checkPayload(await school.renderSchool('classes', { guild, config, t: tFr }));
    expect(byId(cs, 'cfg-school:class-del')).toBeDefined();
    cs = checkPayload(await school.renderSchool('clubs', { guild, config, t: tFr }));
    expect(byId(cs, 'cfg-school:club')).toBeUndefined();
  });

  it('fiches : classe (rôle / salon / prof pré-remplis), maison, club', async () => {
    const guild = fakeGuild();
    const opts = { guild, config: fakeConfig(guild), t: tFr };
    const cs = checkPayload(await school.renderEntity('class', 1, opts));
    expect(defaults(byId(cs, 'cfg-school:set:class:role:1'))).toEqual([ROLE_A]);
    expect(defaults(byId(cs, 'cfg-school:set:class:channel:1'))).toEqual([CHANNEL]);
    expect(defaults(byId(cs, 'cfg-school:set:class:teacher:1'))).toEqual([USER]);
    expect(byId(cs, 'cfg-school:assign:class:1')?.max_values).toBe(25);
    checkPayload(await school.renderEntity('house', 2, opts));
    checkPayload(await school.renderEntity('club', 3, opts));
    // Entité disparue → retour à la liste avec notice
    const back = await school.renderEntityOrList('house', 99, opts);
    expect(JSON.stringify(back.embeds)).toContain('❌');
  });

  it('modals et couleur', () => {
    for (const kind of school.ENTITY_KINDS) checkModal(school.buildEntityModal(kind, tFr));
    const edit = checkModal(school.buildEntityModal('house', tFr, { id: 2, guildId: 'g', name: 'Lions', emoji: '🦁', color: '#C0392B', roleId: null, points: 0 }));
    expect(edit.map((c) => c.value)).toEqual(['Lions', '🦁', '#C0392B']);
    expect(school.normalizeColor('7c3aed')).toBe('#7C3AED');
    expect(school.normalizeColor('')).toBeNull();
    expect(() => school.normalizeColor('violet')).toThrow(PanelError);
  });
});

describe('panneau shop', () => {
  const category = { id: 4, guildId: 'g', name: 'VIP', description: 'Grades', emoji: '⭐', order: 0 };
  const product = (id: number) => ({ id, guildId: 'g', categoryId: 4, name: `Grade ${id}`, description: null, price: new Prisma.Decimal('9.99'), currency: 'EUR', imageUrl: null, tebexPackageId: null, tebexUrl: null, stock: id % 2 ? null : 3, enabled: id !== 2, createdAt: new Date(), updatedAt: new Date(), category });

  it('liste paginée (10 par page) + navigation', async () => {
    prisma.shopProduct.findMany.mockResolvedValue(Array.from({ length: 23 }, (_, i) => product(i + 1)));
    prisma.shopCategory.findMany.mockResolvedValue([category]);
    const guild = fakeGuild();
    const opts = { guild, config: fakeConfig(guild), t: tFr, userId: USER };
    let cs = checkPayload(await shop.renderProducts(0, opts));
    expect((byId(cs, 'cfg-shop:product')?.options as unknown[]).length).toBe(10);
    expect(byId(cs, 'cfg-shop:main:-1')?.disabled).toBe(true);
    const last = await shop.renderProducts(99, opts);
    cs = checkPayload(last);
    expect((byId(cs, 'cfg-shop:product')?.options as unknown[]).length).toBe(3);
    expect(byId(cs, 'cfg-shop:main:3')?.disabled).toBe(true);
    expect(JSON.stringify(last.embeds)).toContain('3/3');
  });

  it('fiche produit : catégorie pré-sélectionnée ; catégories ; annonce', async () => {
    prisma.shopCategory.findMany.mockResolvedValue([category]);
    prisma.shopProduct.findMany.mockResolvedValue([product(1)]);
    const guild = fakeGuild();
    const opts = { guild, config: fakeConfig(guild), t: tFr, userId: USER };
    const cs = checkPayload(await shop.renderProduct(product(1) as never, opts));
    expect(defaultOptions(byId(cs, 'cfg-shop:cat:1'))).toEqual(['4']);
    checkPayload(shop.renderDeleteConfirm(product(1) as never, tFr));
    checkPayload(await shop.renderCategories(opts));
    shop.setAnnounceDraft(guild.id, USER, { productId: 1, channelId: CHANNEL });
    const ann = checkPayload(await shop.renderAnnounce(opts));
    expect(defaultOptions(byId(ann, 'cfg-shop:ann-product'))).toEqual(['1']);
    expect(defaults(byId(ann, 'cfg-shop:ann-channel'))).toEqual([CHANNEL]);
    expect(byId(ann, 'cfg-shop:ann-send')?.disabled).toBe(false);
  });

  it('modals produit / description / Tebex / catégorie', () => {
    expect(checkModal(shop.buildProductModal(tFr)).map((c) => c.custom_id)).toEqual(['name', 'price', 'currency', 'stock', 'image']);
    expect(checkModal(shop.buildProductModal(tFr, product(2) as never)).map((c) => c.value ?? '')).toEqual(['Grade 2', '9.99', 'EUR', '3', '']);
    checkModal(shop.buildDescriptionModal(product(1) as never, tFr));
    checkModal(shop.buildTebexModal(product(1) as never, tFr));
    checkModal(shop.buildCategoryModal(tFr));
  });

  it('parse le formulaire produit et le lien Tebex', () => {
    const labels = { name: 'Nom', stock: 'Stock' };
    expect(shop.parseProductForm({ name: ' Grade VIP ', price: '9,9', currency: 'usd', stock: '', image: 'https://cdn.example.com/vip.png' }, labels)).toEqual({ name: 'Grade VIP', price: '9.90', currency: 'USD', stock: null, imageUrl: 'https://cdn.example.com/vip.png' });
    expect(shop.parseProductForm({ name: 'Caisse', price: '5', stock: '12' }, labels)).toMatchObject({ price: '5.00', currency: 'EUR', stock: 12, imageUrl: null });
    expect(shop.parseProductForm({ name: 'Caisse', price: '5', stock: '∞' }, labels).stock).toBeNull();
    expect(() => shop.parseProductForm({ name: '', price: '5' }, labels)).toThrow(/required_field/);
    expect(() => shop.parseProductForm({ name: 'x', price: 'gratuit' }, labels)).toThrow(ShopError);
    expect(() => shop.parseProductForm({ name: 'x', price: '1', currency: 'EUR€' }, labels)).toThrow(/invalid_currency/);
    expect(() => shop.parseProductForm({ name: 'x', price: '1', stock: '-5' }, labels)).toThrow(/out_of_range/);
    expect(() => shop.parseProductForm({ name: 'x', price: '1', image: 'ftp://x' }, labels)).toThrow(/invalid_url/);
    expect(shop.parseTebexForm({ packageId: '6512345', url: 'https://store.tebex.io/package/6512345' })).toEqual({ tebexPackageId: '6512345', tebexUrl: 'https://store.tebex.io/package/6512345' });
    expect(shop.parseTebexForm({})).toEqual({ tebexPackageId: null, tebexUrl: null });
    expect(() => shop.parseTebexForm({ packageId: 'a b' })).toThrow(/invalid_package/);
  });
});

describe('kit', () => {
  it('describeError traduit les erreurs connues et laisse passer les autres', () => {
    expect(describeError(new PanelError('core.not_found'), tFr)).toBe('Introuvable.');
    expect(describeError(new ShopError('invalid_price'), tFr)).toContain('Prix invalide');
    expect(describeError(new Error('boom'), tFr)).toBeNull();
  });

  it('parseIntField', () => {
    expect(parseIntField('42', 'n')).toBe(42);
    expect(parseIntField('-3', 'n', { min: -5 })).toBe(-3);
    expect(parseIntField(undefined, 'n', { allowEmpty: true })).toBeNull();
    expect(() => parseIntField(undefined, 'n')).toThrow(/required_field/);
    expect(() => parseIntField('1.5', 'n')).toThrow(/invalid_number/);
    expect(() => parseIntField('7', 'n', { max: 5 })).toThrow(/out_of_range/);
  });
});
