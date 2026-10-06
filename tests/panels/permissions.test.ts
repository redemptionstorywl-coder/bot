import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type Guild } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [], DASHBOARD_URL: 'http://localhost' }) }));
vi.mock('../../src/services/GuildConfigService', () => ({ guildConfigService: { get: vi.fn(async () => null), on: vi.fn(), emit: vi.fn(), invalidate: vi.fn() } }));

import { MODULE_KEYS, type ModuleKey } from '../../src/config/constants';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import { commandPermissionService, type CommandRule } from '../../src/services/CommandPermissionService';
import { translationService } from '../../src/services/TranslationService';
import type { Command, InteractionContext } from '../../src/structures/types';
import type { PanelPayload } from '../../src/panels/_coreKit';
import { COMMANDS_PER_PAGE, commonRoles, groupByCategory, permissionCatalog, renderPermissions } from '../../src/panels/_permissions';
import permissionsPanel from '../../src/panels/permissions';
import permsButtons from '../../src/buttons/cfg-perms';
import permsSelects from '../../src/selectMenus/cfg-perms';
import { prisma as prismaModule } from '../../src/database/client';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;
const t = translationService.bind('fr');

const ROLE_A = '111111111111111111';
const ROLE_B = '222222222222222221';
const GONE_ROLE = '999999999999999999';
const guild = {
  id: '444444444444444444',
  name: 'Redemption Story',
  roles: { cache: new Map([[ROLE_A, { id: ROLE_A }], [ROLE_B, { id: ROLE_B }]]) },
  channels: { cache: new Map() },
  members: { me: null },
} as unknown as Guild;

function guildConfig(overrides: Partial<ResolvedGuildConfig> = {}): ResolvedGuildConfig {
  const modules = Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<ModuleKey, boolean>;
  return { guildId: guild.id, kind: 'PRISON', name: guild.name, defaultLanguage: 'fr', timezone: 'Europe/Paris', brandColor: 0x2f8bff, adminRoleIds: [], staffRoleIds: [], modules, logChannels: {}, footerText: null, footerIconUrl: null, raw: {} as never, ...overrides };
}

const cmd = (name: string, category: string, internal?: 'everyone' | 'staff' | 'admin', extra: Partial<Command> = {}): Command =>
  ({ data: new SlashCommandBuilder().setName(name).setDescription(`Description de ${name}`), category, permissions: internal ? { internal } : undefined, execute: vi.fn(), ...extra }) as Command;

const LONG = 'a'.repeat(32);
const COMMANDS: Command[] = [
  cmd('config', 'admin', 'admin'),
  cmd('help', 'admin'),
  cmd('info', 'admin', 'staff'),
  cmd('ban', 'moderation', 'staff'),
  cmd('kick', 'moderation', 'staff'),
  cmd('lockdown', 'moderation', 'admin'),
  cmd('unban-all', 'moderation', 'admin'),
  cmd(LONG, 'battle-royale', 'staff'),
  cmd('shop', 'shop', 'everyone', { guildKinds: ['SHOP'] }),
  { ...cmd('status', 'admin', 'staff'), data: new SlashCommandBuilder().setName('status').setDescription('status').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) } as Command,
  ...Array.from({ length: 30 }, (_, i) => cmd(`evt-${String(i).padStart(2, '0')}`, 'events', 'staff')),
];
const rules = (entries: [string, CommandRule][] = []) => new Map(entries);
const RULES = rules([
  ['ban', { roleIds: [ROLE_A, GONE_ROLE], enabled: true }],
  ['kick', { roleIds: [], enabled: false }],
  ['lockdown', { roleIds: [GONE_ROLE], enabled: true }],
]);

type Json = { type: number; custom_id?: string; label?: string; placeholder?: string; options?: { value: string; label: string; description?: string; default?: boolean }[]; max_values?: number; min_values?: number; default_values?: { id: string; type: string }[]; style?: number; disabled?: boolean };
const SELECT_TYPES = new Set([3, 5, 6, 7, 8]);

/** Limites Discord : 5 rangées, 5 composants/rangée, 1 menu seul, 25 options, customIds < 100 et uniques, embed ≤ 6000. */
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
        expect(new Set(c.options.map((o) => o.value)).size).toBe(c.options.length);
        for (const o of c.options) expect((o.description ?? '').length).toBeLessThanOrEqual(100);
      }
      if (c.max_values !== undefined) expect(c.max_values).toBeLessThanOrEqual(25);
    }
  }
  const ids = rows.flat().map((c) => c.custom_id).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of payload.embeds) {
    const json = e.toJSON();
    expect((json.title ?? '').length).toBeLessThanOrEqual(256);
    expect((json.description ?? '').length).toBeLessThanOrEqual(4096);
    expect((json.fields ?? []).length).toBeLessThanOrEqual(25);
    let total = (json.title ?? '').length + (json.description ?? '').length + (json.footer?.text ?? '').length;
    for (const f of json.fields ?? []) {
      expect(f.value.length).toBeGreaterThan(0);
      expect(f.value.length).toBeLessThanOrEqual(1024);
      total += f.name.length + f.value.length;
    }
    expect(total).toBeLessThanOrEqual(6000);
  }
  return rows;
}

const render = (view?: Parameters<typeof renderPermissions>[0]['view'], r: ReadonlyMap<string, CommandRule> = RULES, config = guildConfig()) => renderPermissions({ guild, config, t, commands: COMMANDS, rules: r, view });
const byId = (rows: Json[][], id: string) => rows.flat().find((c) => c.custom_id === id);

describe('panneau permissions — rendus', () => {
  it('catalogue : commandes d’un autre type de serveur masquées, catégories ordonnées', () => {
    expect(permissionCatalog(COMMANDS, 'PRISON').map((c) => c.name)).not.toContain('shop');
    expect(permissionCatalog(COMMANDS, 'SHOP').map((c) => c.name)).toContain('shop');
    expect(groupByCategory(permissionCatalog(COMMANDS, 'PRISON')).map((g) => g.key)).toEqual(['admin', 'moderation', 'events', 'battle-royale']);
  });

  it('vue principale : résumé par catégorie (🔒 niveau / 👥 rôles / ⛔ désactivée / 🔐 verrouillée)', () => {
    const payload = render();
    const rows = checkPayload(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]!.custom_id).toBe('cfg-perms:cat');
    expect(rows[0]![0]!.options!.map((o) => o.value)).toEqual(['admin', 'moderation', 'events', 'battle-royale']);
    expect(byId(rows, 'cfg-perms:view:resetall')!.disabled).toBe(false);
    const fields = payload.embeds[0]!.toJSON().fields!;
    const moderation = fields[1]!.value;
    expect(fields[1]!.name).toContain('3/4');
    expect(moderation).toContain(`👥 \`/ban\` → <@&${ROLE_A}>`);
    expect(moderation).not.toContain(GONE_ROLE);
    expect(moderation).toContain('⛔ `/kick`');
    expect(moderation).toContain('👥 `/lockdown` → ⚠️');
    expect(moderation).toContain('🔒 **Admin** · `/unban-all`');
    expect(fields[0]!.value).toContain('🔐 `/config` `/help`');
    expect(fields[0]!.value).toContain('🔒 **Staff** · `/info`');
  });

  it('vue principale sans règle : « tout réinitialiser » désactivé', () => {
    expect(byId(checkPayload(render(undefined, rules())), 'cfg-perms:view:resetall')!.disabled).toBe(true);
  });

  it('vue principale : reste sous 6000 caractères même avec 25 rôles par commande', () => {
    const many = Array.from({ length: 25 }, (_, i) => String(300000000000000000n + BigInt(i)));
    const bigGuild = { ...guild, roles: { cache: new Map(many.map((id) => [id, { id }])) } } as unknown as Guild;
    const r = rules(permissionCatalog(COMMANDS, 'PRISON').filter((c) => !c.locked).map((c) => [c.name, { roleIds: many, enabled: true }]));
    checkPayload(renderPermissions({ guild: bigGuild, config: guildConfig(), t, commands: COMMANDS, rules: r }));
  });

  it('vue catégorie : menu des commandes, rôles « toute la catégorie », pagination au-delà de 25', () => {
    const rows = checkPayload(render({ kind: 'category', category: 'events' }));
    expect(rows).toHaveLength(3);
    expect(rows[0]![0]!.custom_id).toBe('cfg-perms:cmd');
    expect(rows[0]![0]!.options).toHaveLength(COMMANDS_PER_PAGE);
    expect(rows[1]![0]!.custom_id).toBe('cfg-perms:catroles:events');
    expect(rows[1]![0]!.min_values).toBe(0);
    expect(rows[1]![0]!.default_values).toBeUndefined();
    expect(rows[2]!.map((c) => c.custom_id)).toEqual(['cfg-perms:catreset:events', 'cfg-perms:view:cat:events:-1', 'cfg-perms:view:cat:events:1', 'cfg-perms:view:main']);
    expect(byId(rows, 'cfg-perms:view:cat:events:-1')!.disabled).toBe(true);
    expect(byId(rows, 'cfg-perms:view:cat:events:1')!.disabled).toBe(false);
    expect(byId(rows, 'cfg-perms:catreset:events')!.disabled).toBe(true); // aucune règle dans la catégorie

    const last = checkPayload(render({ kind: 'category', category: 'events', page: 99 }));
    expect(last[0]![0]!.options!.map((o) => o.value)).toEqual(['evt-25', 'evt-26', 'evt-27', 'evt-28', 'evt-29']);
    expect(byId(last, 'cfg-perms:view:cat:events:2')!.disabled).toBe(true);
  });

  it('vue catégorie : pré-remplit les rôles communs (rôles supprimés ignorés), commandes verrouillées affichées', () => {
    const r = rules([
      ['info', { roleIds: [ROLE_A, ROLE_B, GONE_ROLE], enabled: true }],
      ['status', { roleIds: [GONE_ROLE, ROLE_B, ROLE_A], enabled: true }],
    ]);
    const rows = checkPayload(render({ kind: 'category', category: 'admin' }, r));
    expect(rows[1]![0]!.default_values).toEqual([
      { id: ROLE_A, type: 'role' },
      { id: ROLE_B, type: 'role' },
    ]);
    const options = rows[0]![0]!.options!;
    expect(options.map((o) => o.value)).toEqual(['config', 'help', 'info', 'status']);
    expect(options.find((o) => o.value === 'config')!.description).toContain('verrouillée');
    expect(commonRoles(permissionCatalog(COMMANDS, 'PRISON').filter((c) => c.category === 'moderation'), RULES)).toEqual([]);
  });

  it('vue commande : rôles pré-remplis (existants), bascule, retour au défaut, phrase d’effet', () => {
    const payload = render({ kind: 'command', command: 'ban' });
    const rows = checkPayload(payload);
    expect(rows[0]![0]!.custom_id).toBe('cfg-perms:roles:ban');
    expect(rows[0]![0]!.default_values).toEqual([{ id: ROLE_A, type: 'role' }]);
    expect(rows[0]![0]!.min_values).toBe(0);
    expect(rows[0]![0]!.max_values).toBe(25);
    expect(rows[1]!.map((c) => c.custom_id)).toEqual(['cfg-perms:toggle:ban', 'cfg-perms:reset:ban', 'cfg-perms:view:cat:moderation:0']);
    expect(byId(rows, 'cfg-perms:toggle:ban')!.style).toBe(3); // Success = activée
    expect(byId(rows, 'cfg-perms:reset:ban')!.disabled).toBe(false);
    expect(payload.embeds[0]!.toJSON().description).toContain('même sans être staff');

    const kick = render({ kind: 'command', command: 'kick' });
    const kickRows = checkPayload(kick);
    expect(byId(kickRows, 'cfg-perms:toggle:kick')!.style).toBe(4); // Danger = désactivée
    expect(kick.embeds[0]!.toJSON().description).toContain('sauf le propriétaire');

    const def = checkPayload(render({ kind: 'command', command: 'unban-all' }));
    expect(def[0]![0]!.default_values).toBeUndefined();
    expect(byId(def, 'cfg-perms:reset:unban-all')!.disabled).toBe(true);
  });

  it('commande masquée par Discord (permissions par défaut) : avertissement quand des rôles sont autorisés', () => {
    const r = rules([['status', { roleIds: [ROLE_A], enabled: true }]]);
    expect(render({ kind: 'command', command: 'status' }, r).embeds[0]!.toJSON().description).toContain('Intégrations');
    expect(render({ kind: 'command', command: 'status' }, rules()).embeds[0]!.toJSON().description).not.toContain('Intégrations');
    expect(render({ kind: 'command', command: 'ban' }).embeds[0]!.toJSON().description).not.toContain('Intégrations');
  });

  it('commande verrouillée : non modifiable', () => {
    const payload = render({ kind: 'command', command: 'config' });
    const rows = checkPayload(payload);
    expect(rows[0]![0]!.disabled).toBe(true);
    expect(byId(rows, 'cfg-perms:toggle:config')!.disabled).toBe(true);
    expect(byId(rows, 'cfg-perms:reset:config')!.disabled).toBe(true);
    expect(payload.embeds[0]!.toJSON().description).toContain('verrouillée');
  });

  it('customIds < 100 avec un nom de commande de 32 caractères ; vue inconnue → vue principale', () => {
    const rows = checkPayload(render({ kind: 'command', command: LONG }));
    expect(byId(rows, `cfg-perms:toggle:${LONG}`)).toBeDefined();
    expect(byId(rows, 'cfg-perms:view:cat:battle-royale:0')).toBeDefined();
    expect(checkPayload(render({ kind: 'command', command: 'inconnue' }))[0]![0]!.custom_id).toBe('cfg-perms:cat');
    expect(checkPayload(render({ kind: 'category', category: 'inconnue' }))[0]![0]!.custom_id).toBe('cfg-perms:cat');
    expect(checkPayload(render({ kind: 'resetall' }))[0]!.map((c) => c.custom_id)).toEqual(['cfg-perms:resetall', 'cfg-perms:view:main']);
  });
});

// ─────────────────────────── Ouverture + handlers ───────────────────────────

describe('panneau permissions — ouverture et actions', () => {
  const client = { commands: new Collection(COMMANDS.map((c) => [c.data.name, c])) };
  const ctx = { client, t, lang: 'fr', config: guildConfig() } as unknown as InteractionContext;
  let rows: { commandName: string; roleIds: unknown; enabled: boolean }[];

  beforeEach(() => {
    rows = [{ commandName: 'ban', roleIds: [ROLE_A], enabled: true }];
    commandPermissionService.invalidate(guild.id);
    prisma.commandPermission!.findMany!.mockImplementation(async () => rows);
    prisma.commandPermission!.deleteMany!.mockResolvedValue({ count: 1 });
    prisma.commandPermission!.upsert!.mockResolvedValue({});
  });

  const component = (extra: Record<string, unknown>) => ({ guild, deferred: false, replied: false, update: vi.fn(), reply: vi.fn(), followUp: vi.fn(), isRoleSelectMenu: () => false, isStringSelectMenu: () => false, ...extra }) as never;
  const updated = (i: { update: ReturnType<typeof vi.fn> }) => i.update.mock.calls[0]![0] as PanelPayload;

  it('déclaration et ouverture : réponse éphémère conforme', async () => {
    expect([permissionsPanel.key, permissionsPanel.order, permissionsPanel.emoji]).toEqual(['permissions', 2, '🔐']);
    const reply = vi.fn();
    await permissionsPanel.open({ guild, reply } as unknown as ChatInputCommandInteraction, ctx);
    const payload = reply.mock.calls[0]![0] as PanelPayload & { flags: number };
    expect(payload.flags).toBe(64);
    checkPayload(payload);
    expect(payload.embeds[0]!.toJSON().fields![1]!.value).toContain(`<@&${ROLE_A}>`);
  });

  it('RoleSelect d’une commande : enregistre les rôles et re-rend la vue commande', async () => {
    const i = component({ isRoleSelectMenu: () => true, values: [ROLE_B] });
    await permsSelects.execute(i, ['roles', 'kick'], ctx);
    expect(prisma.commandPermission!.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId_commandName: { guildId: guild.id, commandName: 'kick' } }, create: expect.objectContaining({ roleIds: [ROLE_B], enabled: true }) }));
    const payload = updated(i as never);
    expect(payload.embeds[0]!.toJSON().description).toMatch(/^✅/);
    expect(payload.components[0]!.toJSON().components[0]).toMatchObject({ custom_id: 'cfg-perms:roles:kick' });
  });

  it('RoleSelect vidé : retour à la règle par défaut (ligne supprimée)', async () => {
    const i = component({ isRoleSelectMenu: () => true, values: [] });
    await permsSelects.execute(i, ['roles', 'ban'], ctx);
    expect(prisma.commandPermission!.deleteMany).toHaveBeenCalledWith({ where: { guildId: guild.id, commandName: 'ban' } });
  });

  it('rôles pour toute la catégorie : commandes verrouillées ignorées', async () => {
    const i = component({ isRoleSelectMenu: () => true, values: [ROLE_A] });
    await permsSelects.execute(i, ['catroles', 'admin'], ctx);
    const names = prisma.commandPermission!.upsert!.mock.calls.map((call: unknown[]) => (call[0] as { create: { commandName: string } }).create.commandName);
    expect(names).toEqual(['info', 'status']);
  });

  it('bouton désactiver puis « tout remettre par défaut » de la catégorie', async () => {
    const toggle = component({});
    await permsButtons.execute(toggle, ['toggle', 'ban'], ctx);
    expect(prisma.commandPermission!.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { roleIds: [ROLE_A], enabled: false } }));
    const reset = component({});
    await permsButtons.execute(reset, ['catreset', 'moderation'], ctx);
    expect(prisma.commandPermission!.deleteMany).toHaveBeenCalledWith({ where: { guildId: guild.id, commandName: { in: ['ban', 'kick', 'lockdown', 'unban-all'] } } });
    expect(updated(reset as never).components[0]!.toJSON().components[0]).toMatchObject({ custom_id: 'cfg-perms:cmd' });
  });

  it('commande verrouillée : action refusée sans écriture', async () => {
    const i = component({});
    await permsButtons.execute(i, ['toggle', 'config'], ctx);
    expect(prisma.commandPermission!.upsert).not.toHaveBeenCalled();
    expect(updated(i as never).embeds[0]!.toJSON().description).toMatch(/^❌/);
  });

  it('tout réinitialiser (après confirmation)', async () => {
    const i = component({});
    await permsButtons.execute(i, ['resetall'], ctx);
    expect(prisma.commandPermission!.deleteMany).toHaveBeenCalledWith({ where: { guildId: guild.id } });
  });
});
