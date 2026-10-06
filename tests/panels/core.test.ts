import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction, Guild } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [], DASHBOARD_URL: 'http://localhost' }) }));

import { MODULE_KEYS, type ModuleKey } from '../../src/config/constants';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import { DEFAULT_ANTI_RAID, DEFAULT_WARN_THRESHOLDS, type ResolvedModerationConfig } from '../../src/services/ModerationService';
import type { InteractionContext } from '../../src/structures/types';
import type { PanelPayload } from '../../src/panels/_coreKit';
import { buildFooterModal, buildHexModal, modulesFromSelection, parseFooter, parseHexColor, renderGeneral } from '../../src/panels/_general';
import { LOG_CATEGORIES, privateLogOverwrites, renderLogs } from '../../src/panels/_logs';
import {
  MOD_TABS,
  activeProtections,
  addThreshold,
  buildAntiRaidSettingsModal,
  buildDomainsModal,
  buildHoneypotWindowModal,
  buildNukeThresholdsModal,
  buildThresholdModal,
  parseAntiRaidSettings,
  parseDomains,
  parseNukeThresholds,
  parseWarnThreshold,
  parseWindowMinutes,
  protectionsPatch,
  renderHoneypotRemoveConfirm,
  renderLockdownConfirm,
  renderModeration,
  serializeNukeThresholds,
} from '../../src/panels/_moderation';
import general from '../../src/panels/general';
import logs from '../../src/panels/logs';
import bienvenue from '../../src/panels/bienvenue';
import tickets from '../../src/panels/tickets';
import moderation from '../../src/panels/moderation';

const t = (key: string, vars: Record<string, unknown> = {}) => `${key}${Object.keys(vars).length ? `[${Object.values(vars).join(',')}]` : ''}`;

const ROLE_A = '111111111111111111';
const ROLE_B = '222222222222222221';
const GONE_ROLE = '999999999999999999';
const CHANNEL = '333333333333333333';
const guild = {
  id: '444444444444444444',
  name: 'Redemption Story',
  roles: { cache: new Map([[ROLE_A, { id: ROLE_A, name: 'Admin' }], [ROLE_B, { id: ROLE_B, name: 'Staff' }]]), everyone: { id: '444444444444444444' } },
  channels: { cache: new Map([[CHANNEL, { id: CHANNEL, name: 'logs', type: 0 }]]) },
  members: { me: null },
} as unknown as Guild;

function guildConfig(overrides: Partial<ResolvedGuildConfig> = {}): ResolvedGuildConfig {
  const modules = Object.fromEntries(MODULE_KEYS.map((k) => [k, ['welcome', 'tickets', 'moderation', 'logs'].includes(k)])) as Record<ModuleKey, boolean>;
  return {
    guildId: guild.id,
    kind: 'PRISON',
    name: guild.name,
    defaultLanguage: 'en',
    timezone: 'Europe/Paris',
    brandColor: 0x2f8bff,
    adminRoleIds: [ROLE_A, GONE_ROLE],
    staffRoleIds: [ROLE_B],
    modules,
    logChannels: { MODERATION: CHANNEL },
    footerText: 'Footer',
    footerIconUrl: null,
    raw: {} as never,
    ...overrides,
  };
}

function modConfig(overrides: Partial<ResolvedModerationConfig> = {}): ResolvedModerationConfig {
  return { guildId: guild.id, warnThresholds: DEFAULT_WARN_THRESHOLDS, muteRoleId: ROLE_B, dmOnSanction: true, antiRaid: DEFAULT_ANTI_RAID, lockdownActive: false, lockdownState: null, updatedAt: null, ...overrides };
}

type Json = { type: number; custom_id?: string; label?: string; placeholder?: string; options?: { value: string; label: string; default?: boolean }[]; max_values?: number; min_values?: number; default_values?: { id: string; type: string }[]; style?: number; disabled?: boolean };
const SELECT_TYPES = new Set([3, 5, 6, 7, 8]);

/** Vérifie les limites Discord d'un panneau et renvoie ses composants à plat (par rangée). */
function checkPayload(payload: PanelPayload): Json[][] {
  expect(payload.components.length).toBeGreaterThan(0);
  expect(payload.components.length).toBeLessThanOrEqual(5);
  const rows = payload.components.map((r) => r.toJSON().components as Json[]);
  for (const comps of rows) {
    expect(comps.length).toBeGreaterThan(0);
    expect(comps.length).toBeLessThanOrEqual(5);
    if (comps.some((c) => SELECT_TYPES.has(c.type))) expect(comps).toHaveLength(1);
    for (const c of comps) {
      if (c.custom_id) expect(c.custom_id.length).toBeLessThan(100);
      if (c.label) expect(c.label.length).toBeLessThanOrEqual(80);
      if (c.placeholder) expect(c.placeholder.length).toBeLessThanOrEqual(150);
      if (c.options) {
        expect(c.options.length).toBeGreaterThan(0);
        expect(c.options.length).toBeLessThanOrEqual(25);
        expect(c.max_values ?? 1).toBeLessThanOrEqual(c.options.length);
        expect(new Set(c.options.map((o) => o.value)).size).toBe(c.options.length);
      }
      if (c.max_values !== undefined) expect(c.max_values).toBeLessThanOrEqual(25);
    }
  }
  const ids = rows.flat().map((c) => c.custom_id).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of payload.embeds) {
    const json = e.toJSON();
    expect((json.description ?? '').length).toBeLessThanOrEqual(4096);
    expect((json.fields ?? []).length).toBeLessThanOrEqual(25);
    for (const f of json.fields ?? []) {
      expect(f.value.length).toBeGreaterThan(0);
      expect(f.value.length).toBeLessThanOrEqual(1024);
    }
  }
  return rows;
}

function checkModal(m: { toJSON(): unknown }, customId: string): { custom_id: string; component: { custom_id: string; value?: string; type: number } }[] {
  const json = m.toJSON() as { custom_id: string; title: string; components: { type: number; label: string; component: { custom_id: string; value?: string; type: number } }[] };
  expect(json.custom_id).toBe(customId);
  expect(json.title.length).toBeLessThanOrEqual(45);
  expect(json.components.length).toBeGreaterThan(0);
  expect(json.components.length).toBeLessThanOrEqual(5);
  for (const c of json.components) expect(c.label.length).toBeLessThanOrEqual(45);
  return json.components.map((c) => ({ custom_id: c.component.custom_id, component: c.component }));
}

const findById = (rows: Json[][], id: string) => rows.flat().find((c) => c.custom_id === id);

// ─────────────────────────── Ouverture des panneaux ───────────────────────────

describe('ouverture des panneaux (/config)', () => {
  const ctx = { client: {} as never, t, lang: 'en', config: guildConfig() } as unknown as InteractionContext;
  const panels = [general, logs, bienvenue, tickets, moderation];

  it('clés, ordre et emoji', () => {
    expect(panels.map((p) => [p.key, p.order])).toEqual([
      ['general', 1],
      ['logs', 3],
      ['bienvenue', 4],
      ['tickets', 5],
      ['moderation', 6],
    ]);
    for (const p of panels) expect(p.emoji).toBeTruthy();
  });

  for (const panel of panels) {
    it(`${panel.key} : réponse éphémère conforme aux limites Discord`, async () => {
      const reply = vi.fn();
      const interaction = { guild, inCachedGuild: () => true, reply } as unknown as ChatInputCommandInteraction;
      await panel.open(interaction, ctx);
      expect(reply).toHaveBeenCalledTimes(1);
      const payload = reply.mock.calls[0]![0] as PanelPayload & { flags: number };
      expect(payload.flags).toBe(64); // Ephemeral
      checkPayload(payload);
    });
  }
});

// ─────────────────────────── Général ───────────────────────────

describe('panneau general', () => {
  it('vue principale : 5 rangées, sélecteurs pré-remplis (type, langue, rôles existants)', () => {
    const rows = checkPayload(renderGeneral({ guild, config: guildConfig(), t, notice: { type: 'success', text: 'OK' } }));
    expect(rows).toHaveLength(5);
    expect(rows[0]![0]!.custom_id).toBe('cfg-general:kind');
    expect(rows[0]![0]!.options!.find((o) => o.default)!.value).toBe('PRISON');
    expect(rows[1]![0]!.options!.find((o) => o.default)!.value).toBe('en');
    expect(rows[2]![0]!.custom_id).toBe('cfg-general:admins');
    expect(rows[2]![0]!.default_values).toEqual([{ id: ROLE_A, type: 'role' }]); // rôle supprimé ignoré
    expect(rows[2]![0]!.min_values).toBe(0);
    expect(rows[3]![0]!.default_values).toEqual([{ id: ROLE_B, type: 'role' }]);
    expect(rows[4]!.map((c) => c.custom_id)).toEqual(['cfg-general:view:modules', 'cfg-general:view:color', 'cfg-general:footer', 'cfg-general:autotr', 'cfg-general:trlayout']);
  });

  it('vue modules : un select multi avec les modules actifs cochés', () => {
    const config = guildConfig();
    const rows = checkPayload(renderGeneral({ guild, config, t, view: 'modules' }));
    const select = rows[0]![0]!;
    expect(select.custom_id).toBe('cfg-general:modules');
    expect(select.options).toHaveLength(MODULE_KEYS.length);
    expect(select.min_values).toBe(0);
    expect(select.options!.filter((o) => o.default).map((o) => o.value).sort()).toEqual(MODULE_KEYS.filter((k) => config.modules[k]).sort());
    expect(rows[1]![0]!.custom_id).toBe('cfg-general:view:main');
  });

  it('vue couleur : palette pré-sélectionnée sur la couleur actuelle', () => {
    const rows = checkPayload(renderGeneral({ guild, config: guildConfig(), t, view: 'color' }));
    expect(rows[0]![0]!.options!.find((o) => o.default)!.value).toBe('brand_blue');
    expect(rows[1]!.map((c) => c.custom_id)).toEqual(['cfg-general:hex', 'cfg-general:view:main']);
  });

  it('modals couleur / footer pré-remplis', () => {
    const hex = checkModal(buildHexModal(guildConfig(), t), 'cfg-general:hex');
    expect(hex[0]!.component.value).toBe('#2F8BFF');
    const footer = checkModal(buildFooterModal(guildConfig(), t), 'cfg-general:footer');
    expect(footer.map((c) => c.custom_id)).toEqual(['text', 'icon']);
    expect(footer[0]!.component.value).toBe('Footer');
  });

  it('parseHexColor / parseFooter / modulesFromSelection', () => {
    expect(parseHexColor('#7c3aed')).toBe('#7C3AED');
    expect(parseHexColor('abc')).toBe('#AABBCC');
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('red')).toBeNull();
    expect(parseFooter('  Texte ', 'https://cdn.example.com/i.png')).toEqual({ ok: true, footerText: 'Texte', footerIconUrl: 'https://cdn.example.com/i.png' });
    expect(parseFooter(undefined, undefined)).toEqual({ ok: true, footerText: null, footerIconUrl: null });
    expect(parseFooter('x', 'ftp://nope').ok).toBe(false);
    const modules = modulesFromSelection(['tickets', 'logs', 'inconnu']);
    expect(Object.keys(modules).sort()).toEqual([...MODULE_KEYS].sort());
    expect(modules.tickets && modules.logs).toBe(true);
    expect(modules.welcome).toBe(false);
  });
});

// ─────────────────────────── Logs ───────────────────────────

describe('panneau logs', () => {
  it('vue principale : select des catégories (≤ 25), boutons globaux + module', () => {
    const rows = checkPayload(renderLogs({ guild, config: guildConfig(), t }));
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]!.options).toHaveLength(LOG_CATEGORIES.length);
    expect(rows[1]!.map((c) => c.custom_id)).toEqual(['cfg-logs:view:all', 'cfg-logs:create', 'cfg-logs:module']);
  });

  it('catégorie choisie : menu salon pré-rempli et bouton « Désactiver »', () => {
    const rows = checkPayload(renderLogs({ guild, config: guildConfig(), t, picked: 'MODERATION' }));
    expect(rows).toHaveLength(3);
    expect(rows[0]![0]!.options!.find((o) => o.default)!.value).toBe('MODERATION');
    expect(rows[1]![0]!.custom_id).toBe('cfg-logs:set:MODERATION');
    expect(rows[1]![0]!.default_values).toEqual([{ id: CHANNEL, type: 'channel' }]);
    expect(findById(rows, 'cfg-logs:off:MODERATION')!.disabled).toBe(false);
    const empty = checkPayload(renderLogs({ guild, config: guildConfig(), t, picked: 'VOICE' }));
    expect(empty[1]![0]!.default_values).toBeUndefined();
    expect(findById(empty, 'cfg-logs:off:VOICE')!.disabled).toBe(true);
  });

  it('vue « tout dans un salon » et salon privé (invisible pour @everyone)', () => {
    const rows = checkPayload(renderLogs({ guild, config: guildConfig(), t, view: 'all' }));
    expect(rows[0]![0]!.custom_id).toBe('cfg-logs:allset');
    expect(rows[1]!.map((c) => c.custom_id)).toEqual(['cfg-logs:alloff', 'cfg-logs:view:main']);
    const overwrites = privateLogOverwrites(guild, guildConfig(), '555555555555555555');
    expect(overwrites[0]!.id).toBe(guild.id);
    expect(overwrites.map((o) => o.id)).toEqual(expect.arrayContaining([ROLE_A, ROLE_B, '555555555555555555']));
    expect(overwrites.map((o) => o.id)).not.toContain(GONE_ROLE);
  });
});

// ─────────────────────────── Modération ───────────────────────────

describe('panneau moderation', () => {
  const base = { guild, t, lang: 'en', modules: { moderation: true, antiraid: false } };

  for (const tab of MOD_TABS) {
    it(`onglet ${tab} : limites Discord, onglet actif en Primary`, () => {
      const rows = checkPayload(renderModeration({ ...base, cfg: modConfig(), tab, honeypot: tab === 'honeypot' ? { channelId: CHANNEL, enabled: true, deleteWindowMinutes: 60 } : null }));
      expect(rows[0]!.map((c) => c.custom_id)).toEqual(MOD_TABS.map((k) => `cfg-mod:tab:${k}`));
      expect(findById(rows, `cfg-mod:tab:${tab}`)!.style).toBe(1);
    });
  }

  it('sanctions : rôle mute pré-rempli, suppression des seuils, module', () => {
    const rows = checkPayload(renderModeration({ ...base, cfg: modConfig(), tab: 'sanctions' }));
    expect(findById(rows, 'cfg-mod:muterole')!.default_values).toEqual([{ id: ROLE_B, type: 'role' }]);
    expect(findById(rows, 'cfg-mod:thdel')!.options!.map((o) => o.value)).toEqual(['3', '5', '7']);
    expect(findById(rows, 'cfg-mod:dm')!.style).toBe(3);
    expect(findById(rows, 'cfg-mod:module:sanctions')!.style).toBe(3);
    const none = checkPayload(renderModeration({ ...base, cfg: modConfig({ warnThresholds: [] }), tab: 'sanctions' }));
    expect(findById(none, 'cfg-mod:thdel')).toBeUndefined();
  });

  it('anti-raid : protections actives cochées, exemptions pré-remplies, avertissement module', () => {
    const antiRaid = { ...DEFAULT_ANTI_RAID, exemptRoleIds: [ROLE_A], exemptChannelIds: [CHANNEL] };
    const payload = renderModeration({ ...base, cfg: modConfig({ antiRaid }), tab: 'antiraid' });
    const rows = checkPayload(payload);
    expect(rows).toHaveLength(5);
    const prot = findById(rows, 'cfg-mod:arprot')!;
    expect(prot.options!.filter((o) => o.default).map((o) => o.value)).toEqual(activeProtections(antiRaid));
    expect(findById(rows, 'cfg-mod:arroles')!.default_values).toEqual([{ id: ROLE_A, type: 'role' }]);
    expect(findById(rows, 'cfg-mod:archans')!.default_values).toEqual([{ id: CHANNEL, type: 'channel' }]);
    expect(findById(rows, 'cfg-mod:module:antiraid')!.style).toBe(4); // module anti-raid désactivé
    expect(payload.embeds[0]!.toJSON().description).toContain('panels_core.common.module_off_warning');
  });

  it('anti-nuke : punition, liste blanche, bascules', () => {
    const antiRaid = { ...DEFAULT_ANTI_RAID, antiNuke: { ...DEFAULT_ANTI_RAID.antiNuke, punishment: 'BAN' as const, whitelistUserIds: ['666666666666666666'], restoreBans: false } };
    const rows = checkPayload(renderModeration({ ...base, cfg: modConfig({ antiRaid }), tab: 'antinuke' }));
    expect(findById(rows, 'cfg-mod:nkpun')!.options!.find((o) => o.default)!.value).toBe('BAN');
    expect(findById(rows, 'cfg-mod:nkwl')!.default_values).toEqual([{ id: '666666666666666666', type: 'user' }]);
    expect(findById(rows, 'cfg-mod:nk:restore')!.style).toBe(2);
    expect(findById(rows, 'cfg-mod:nk:enabled')!.style).toBe(3);
  });

  it('lockdown / salon piège / confirmations', () => {
    const on = checkPayload(renderModeration({ ...base, cfg: modConfig({ lockdownActive: true }), tab: 'lockdown' }));
    expect(findById(on, 'cfg-mod:lock:off')).toBeDefined();
    const off = checkPayload(renderModeration({ ...base, cfg: modConfig(), tab: 'lockdown' }));
    expect(findById(off, 'cfg-mod:lock:on')).toBeDefined();
    expect(checkPayload(renderLockdownConfirm({ t, enable: true }))[0]!.map((c) => c.custom_id)).toEqual(['cfg-mod:lockok:on', 'cfg-mod:tab:lockdown']);

    const empty = checkPayload(renderModeration({ ...base, cfg: modConfig(), tab: 'honeypot', honeypot: null }));
    expect(findById(empty, 'cfg-mod:hpcreate')!.disabled).toBeFalsy();
    for (const id of ['cfg-mod:hptoggle', 'cfg-mod:hpwin', 'cfg-mod:hpremove']) expect(findById(empty, id)!.disabled).toBe(true);
    expect(findById(empty, 'cfg-mod:module:honeypot')).toBeUndefined();
    const set = checkPayload(renderModeration({ ...base, cfg: modConfig(), tab: 'honeypot', honeypot: { channelId: CHANNEL, enabled: false, deleteWindowMinutes: 30 } }));
    expect(findById(set, 'cfg-mod:hpchan')!.default_values).toEqual([{ id: CHANNEL, type: 'channel' }]);
    expect(findById(set, 'cfg-mod:hptoggle')!.style).toBe(2);
    expect(checkPayload(renderHoneypotRemoveConfirm({ t, channelId: CHANNEL }))[0]!.map((c) => c.custom_id)).toEqual(['cfg-mod:hpremoveok', 'cfg-mod:tab:honeypot']);
  });

  it('modals : identifiants, ≤ 5 champs, labels ≤ 45, pré-remplissage', () => {
    expect(checkModal(buildThresholdModal(t), 'cfg-mod:thadd').map((c) => c.custom_id)).toEqual(['count', 'action', 'duration']);
    const settings = checkModal(buildAntiRaidSettingsModal(DEFAULT_ANTI_RAID, t, 'en'), 'cfg-mod:arset');
    expect(settings.map((c) => [c.custom_id, c.component.value])).toEqual([
      ['spam', '6/5'],
      ['mentions', '5'],
      ['age', '7'],
      ['joins', '10/10'],
      ['timeout', '10m'],
    ]);
    checkModal(buildDomainsModal({ ...DEFAULT_ANTI_RAID, antiLink: { ...DEFAULT_ANTI_RAID.antiLink, whitelistDomains: ['youtube.com', 'twitch.tv'] } }, t), 'cfg-mod:ardom');
    const nuke = checkModal(buildNukeThresholdsModal(DEFAULT_ANTI_RAID.antiNuke, t), 'cfg-mod:nkth');
    expect(nuke[0]!.component.value).toBe(serializeNukeThresholds(DEFAULT_ANTI_RAID.antiNuke.thresholds));
    expect(checkModal(buildHoneypotWindowModal(30, t), 'cfg-mod:hpwin')[0]!.component.value).toBe('30');
  });
});

// ─────────────────────────── Parsing des modals (pur) ───────────────────────────

describe('parseWarnThreshold / addThreshold', () => {
  it('nombre | action | durée, alias et durées par défaut', () => {
    expect(parseWarnThreshold({ count: '3', action: 'TIMEOUT', duration: '2h' })).toEqual({ ok: true, value: { count: 3, action: 'TIMEOUT', duration: 7200 } });
    expect(parseWarnThreshold({ count: '4', action: 'timeout' })).toEqual({ ok: true, value: { count: 4, action: 'TIMEOUT', duration: 3600 } });
    expect(parseWarnThreshold({ count: '6', action: 'tempban' })).toEqual({ ok: true, value: { count: 6, action: 'TEMPBAN', duration: 86400 } });
    expect(parseWarnThreshold({ count: '5', action: 'expulser', duration: '1h' })).toEqual({ ok: true, value: { count: 5, action: 'KICK' } });
    expect(parseWarnThreshold({ count: '8', action: 'Bannir' })).toEqual({ ok: true, value: { count: 8, action: 'BAN' } });
  });

  it('erreurs : nombre, action, durée hors bornes', () => {
    expect(parseWarnThreshold({ count: '0', action: 'BAN' })).toMatchObject({ ok: false, field: 'count' });
    expect(parseWarnThreshold({ count: '101', action: 'BAN' })).toMatchObject({ ok: false, field: 'count' });
    expect(parseWarnThreshold({ count: 'abc', action: 'BAN' })).toMatchObject({ ok: false, field: 'count' });
    expect(parseWarnThreshold({ count: '3', action: 'warn' })).toMatchObject({ ok: false, field: 'action' });
    expect(parseWarnThreshold({ count: '3', action: 'TIMEOUT', duration: '30d' })).toMatchObject({ ok: false, field: 'duration' });
    expect(parseWarnThreshold({ count: '3', action: 'TIMEOUT', duration: '30s' })).toMatchObject({ ok: false, field: 'duration' });
    expect(parseWarnThreshold({ count: '3', action: 'TEMPBAN', duration: 'demain' })).toMatchObject({ ok: false, field: 'duration' });
  });

  it('ajout : remplace le même nombre, trie, 25 max', () => {
    const r = addThreshold(DEFAULT_WARN_THRESHOLDS, { count: 5, action: 'BAN' });
    expect(r).toEqual({ ok: true, value: [DEFAULT_WARN_THRESHOLDS[0], { count: 5, action: 'BAN' }, DEFAULT_WARN_THRESHOLDS[2]] });
    const full = Array.from({ length: 25 }, (_, i) => ({ count: i + 1, action: 'KICK' as const }));
    expect(addThreshold(full, { count: 30, action: 'BAN' }).ok).toBe(false);
    expect(addThreshold(full, { count: 2, action: 'BAN' }).ok).toBe(true);
  });
});

describe('parseAntiRaidSettings', () => {
  it('champs vides = inchangé', () => {
    expect(parseAntiRaidSettings({}, DEFAULT_ANTI_RAID)).toEqual({ ok: true, value: {} });
  });

  it('spam, mentions, âge, raid et timeout', () => {
    const r = parseAntiRaidSettings({ spam: '8 / 4', mentions: '10', age: '14j', joins: '20/30s', timeout: '15m' }, DEFAULT_ANTI_RAID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.antiSpam).toMatchObject({ maxMessages: 8, intervalSeconds: 4, timeoutSeconds: 900, enabled: DEFAULT_ANTI_RAID.antiSpam.enabled });
    expect(r.value.antiMassMention).toMatchObject({ maxMentions: 10, timeoutSeconds: 900 });
    expect(r.value.antiNewAccount).toMatchObject({ minAgeDays: 14 });
    expect(r.value.antiMassJoin).toMatchObject({ maxJoins: 20, intervalSeconds: 30, lockdown: DEFAULT_ANTI_RAID.antiMassJoin.lockdown });
    expect(r.value.antiLink).toMatchObject({ timeoutSeconds: 900, whitelistDomains: [] });
  });

  it('valeurs hors bornes : champ fautif signalé', () => {
    expect(parseAntiRaidSettings({ spam: '1/5' }, DEFAULT_ANTI_RAID)).toMatchObject({ ok: false, field: 'spam' });
    expect(parseAntiRaidSettings({ spam: '6' }, DEFAULT_ANTI_RAID)).toMatchObject({ ok: false, field: 'spam' });
    expect(parseAntiRaidSettings({ mentions: '1' }, DEFAULT_ANTI_RAID)).toMatchObject({ ok: false, field: 'mentions' });
    expect(parseAntiRaidSettings({ age: '400' }, DEFAULT_ANTI_RAID)).toMatchObject({ ok: false, field: 'age' });
    expect(parseAntiRaidSettings({ joins: '10/601' }, DEFAULT_ANTI_RAID)).toMatchObject({ ok: false, field: 'joins' });
    expect(parseAntiRaidSettings({ timeout: '29d' }, DEFAULT_ANTI_RAID)).toMatchObject({ ok: false, field: 'timeout' });
  });
});

describe('parseDomains', () => {
  it('normalise, dédoublonne, accepte lignes / virgules', () => {
    expect(parseDomains('https://www.YouTube.com/watch?v=1\ntwitch.tv, youtube.com')).toEqual({ ok: true, value: ['youtube.com', 'twitch.tv'] });
    expect(parseDomains('')).toEqual({ ok: true, value: [] });
    expect(parseDomains(undefined)).toEqual({ ok: true, value: [] });
  });

  it('refuse un domaine invalide', () => {
    expect(parseDomains('youtube.com\nnot a domain')).toMatchObject({ ok: false });
    expect(parseDomains('localhost')).toMatchObject({ ok: false, error: 'localhost' });
  });
});

describe('parseNukeThresholds', () => {
  const current = DEFAULT_ANTI_RAID.antiNuke.thresholds;

  it('aller-retour avec la sérialisation, lignes partielles', () => {
    expect(parseNukeThresholds(serializeNukeThresholds(current), current)).toEqual({ ok: true, value: current });
    const r = parseNukeThresholds('BAN | 5 | 30\nchanneldelete 1 5s', current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ban).toEqual({ max: 5, intervalSeconds: 30 });
    expect(r.value.channelDelete).toEqual({ max: 1, intervalSeconds: 5 });
    expect(r.value.kick).toEqual(current.kick);
  });

  it('refuse action inconnue ou bornes dépassées', () => {
    expect(parseNukeThresholds('nuke | 1 | 10', current)).toMatchObject({ ok: false, error: 'nuke | 1 | 10' });
    expect(parseNukeThresholds('ban | 0 | 10', current).ok).toBe(false);
    expect(parseNukeThresholds('ban | 3 | 601', current).ok).toBe(false);
    expect(parseNukeThresholds('ban | 3', current).ok).toBe(false);
  });
});

describe('protections anti-raid', () => {
  it('cases cochées ↔ configuration', () => {
    const patch = protectionsPatch(['spam', 'invites', 'raid_lockdown'], DEFAULT_ANTI_RAID);
    expect(patch.antiSpam!.enabled).toBe(true);
    expect(patch.antiMassMention!.enabled).toBe(false);
    expect(patch.antiLink).toMatchObject({ enabled: true, blockInvites: true, blockLinks: false });
    expect(patch.antiMassJoin).toMatchObject({ enabled: false, lockdown: true });
    const merged = { ...DEFAULT_ANTI_RAID, ...patch } as typeof DEFAULT_ANTI_RAID;
    expect(activeProtections(merged)).toEqual(['spam', 'invites', 'raid_lockdown']);
    expect(protectionsPatch([], DEFAULT_ANTI_RAID).antiLink).toMatchObject({ enabled: false, blockInvites: false, blockLinks: false });
  });
});

describe('parseWindowMinutes', () => {
  it('5–1440 minutes', () => {
    expect(parseWindowMinutes('60')).toEqual({ ok: true, value: 60 });
    expect(parseWindowMinutes(' 120 min ')).toEqual({ ok: true, value: 120 });
    expect(parseWindowMinutes('4').ok).toBe(false);
    expect(parseWindowMinutes('1441').ok).toBe(false);
    expect(parseWindowMinutes('').ok).toBe(false);
  });
});
