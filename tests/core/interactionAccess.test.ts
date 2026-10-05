import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, GuildMember, PermissionFlagsBits, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

const OWNER = '700000000000000001';
const BOT_OWNER = '700000000000000002';
vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [BOT_OWNER], DASHBOARD_URL: 'http://localhost' }) }));

const GUILD = '444444444444444444';
const STAFF_ROLE = '111111111111111111';
const HELPER = '222222222222222222';
vi.mock('../../src/services/GuildConfigService', () => {
  const config = {
    guildId: '444444444444444444',
    kind: 'PRISON',
    defaultLanguage: 'fr',
    brandColor: 0x7c3aed,
    adminRoleIds: [],
    staffRoleIds: ['111111111111111111'],
    modules: { moderation: true },
    logChannels: {},
  };
  return { guildConfigService: { getOrCreate: vi.fn(async () => config), get: vi.fn(async () => config), on: vi.fn() } };
});

import interactionCreate, { invalidateCommandPermissions, resolveCommandAccess } from '../../src/events/interactionCreate';
import { commandPermissionService } from '../../src/services/CommandPermissionService';
import { prisma as prismaModule } from '../../src/database/client';
import type { ButtonHandler, Command } from '../../src/structures/types';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;
type Rule = { commandName: string; roleIds: string[]; enabled: boolean };
let rules: Rule[] = [];

const command = (name: string, permissions: Command['permissions']): Command & { execute: ReturnType<typeof vi.fn> } =>
  ({ data: new SlashCommandBuilder().setName(name).setDescription(name), module: 'moderation', permissions, execute: vi.fn() }) as never;
const ban = command('ban', { internal: 'staff', discord: [PermissionFlagsBits.BanMembers], bot: [PermissionFlagsBits.BanMembers] });
const config = command('config', { internal: 'admin' });
const unbanAll = command('unban-all', { internal: 'admin', bot: [PermissionFlagsBits.BanMembers] });
const clear = command('clear', { internal: 'staff', discord: [PermissionFlagsBits.ManageMessages] });
const unbanAllButtons: ButtonHandler & { execute: ReturnType<typeof vi.fn> } = { id: 'unbanall', module: 'moderation', command: 'unban-all', permissions: { internal: 'admin' }, execute: vi.fn() } as never;
const modButtons: ButtonHandler & { execute: ReturnType<typeof vi.fn> } = { id: 'mod', module: 'moderation', permissions: { internal: 'staff' }, execute: vi.fn() } as never;

const client = {
  commands: new Collection<string, Command>([ban, config, unbanAll, clear].map((c) => [c.data.name, c])),
  contextMenus: new Collection(),
  buttons: new Collection<string, ButtonHandler>([
    ['unbanall', unbanAllButtons],
    ['mod', modButtons],
  ]),
  selectMenus: new Collection(),
  modals: new Collection(),
  cooldowns: { consume: () => 0 },
};

interface Who {
  userId?: string;
  roles?: string[];
  perms?: bigint[];
  botPerms?: bigint[];
}

function fakeGuild(botPerms: bigint[]) {
  return { id: GUILD, ownerId: OWNER, members: { me: { permissions: new PermissionsBitField(botPerms) } }, roles: { cache: new Map([STAFF_ROLE, HELPER].map((id) => [id, { id, name: id }])) } };
}

function fakeMember(guild: ReturnType<typeof fakeGuild>, who: Who): GuildMember {
  const roles = new Collection((who.roles ?? []).map((id) => [id, { id, name: `role-${id}` }]));
  return Object.defineProperties(Object.create(GuildMember.prototype), {
    id: { value: who.userId ?? '600000000000000001' },
    guild: { value: guild },
    roles: { value: { cache: roles } },
    permissions: { value: new PermissionsBitField(who.perms ?? []) },
  }) as GuildMember;
}

function base(who: Who) {
  const guild = fakeGuild(who.botPerms ?? [PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageMessages]);
  return {
    guildId: GUILD,
    guild,
    user: { id: who.userId ?? '600000000000000001' },
    member: fakeMember(guild, who),
    memberPermissions: new PermissionsBitField(who.perms ?? []),
    locale: 'fr',
    deferred: false,
    replied: false,
    reply: vi.fn(async () => null),
    followUp: vi.fn(async () => null),
    editReply: vi.fn(async () => null),
    inGuild: () => true,
    isRepliable: () => true,
    isAutocomplete: () => false,
  };
}

function slash(name: string, who: Who = {}) {
  return { ...base(who), commandName: name, isChatInputCommand: () => true, isContextMenuCommand: () => false, isMessageComponent: () => false, isModalSubmit: () => false };
}

function button(customId: string, who: Who = {}, parentCommand?: string) {
  return {
    ...base(who),
    customId,
    message: parentCommand ? { interaction: { commandName: parentCommand } } : { interaction: null },
    isChatInputCommand: () => false,
    isContextMenuCommand: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isButton: () => true,
    isAnySelectMenu: () => false,
  };
}

async function run(interaction: ReturnType<typeof slash> | ReturnType<typeof button>): Promise<string | null> {
  await interactionCreate.execute(client as never, interaction as never);
  const call = interaction.reply.mock.calls[0] as unknown as [{ embeds: { data: { description?: string } }[] }] | undefined;
  return call ? (call[0].embeds[0]!.data.description ?? '') : null;
}

beforeEach(() => {
  rules = [];
  invalidateCommandPermissions(GUILD);
  prisma.commandPermission!.findMany!.mockImplementation(async () => rules);
});

describe('permissions par rôle dans le routeur d’interactions', () => {
  it('commande staff refusée par défaut à un membre sans rôle', async () => {
    const error = await run(slash('ban', { roles: [HELPER] }));
    expect(error).toContain('Permissions manquantes');
    expect(ban.execute).not.toHaveBeenCalled();
  });

  it('un rôle configuré donne accès à une commande staff (sans niveau ni permission Discord)', async () => {
    rules = [{ commandName: 'ban', roleIds: [HELPER], enabled: true }];
    expect(await run(slash('ban', { roles: [HELPER] }))).toBeNull();
    expect(ban.execute).toHaveBeenCalledTimes(1);
  });

  it('… mais les permissions du BOT restent vérifiées', async () => {
    rules = [{ commandName: 'ban', roleIds: [HELPER], enabled: true }];
    expect(await run(slash('ban', { roles: [HELPER], botPerms: [] }))).toContain('Il me manque');
    expect(ban.execute).not.toHaveBeenCalled();
  });

  it('rôles configurés : les autres membres (même staff) sont refusés, avec les rôles autorisés cités', async () => {
    rules = [{ commandName: 'ban', roleIds: [HELPER], enabled: true }];
    const error = await run(slash('ban', { roles: [STAFF_ROLE], perms: [PermissionFlagsBits.BanMembers] }));
    expect(error).toContain(`<@&${HELPER}>`);
    expect(error).toContain('/ban');
    expect(ban.execute).not.toHaveBeenCalled();
  });

  it('administrateur Discord : passe les restrictions par rôle', async () => {
    rules = [{ commandName: 'ban', roleIds: [HELPER], enabled: true }];
    expect(await run(slash('ban', { perms: [PermissionFlagsBits.Administrator] }))).toBeNull();
    expect(ban.execute).toHaveBeenCalled();
  });

  it('commande désactivée : refusée, même au staff et aux administrateurs Discord', async () => {
    rules = [{ commandName: 'ban', roleIds: [], enabled: false }];
    expect(await run(slash('ban', { roles: [STAFF_ROLE], perms: [PermissionFlagsBits.BanMembers] }))).toContain('désactivée');
    expect(await run(slash('ban', { perms: [PermissionFlagsBits.Administrator] }))).toContain('désactivée');
    expect(ban.execute).not.toHaveBeenCalled();
  });

  it('le propriétaire du serveur et OWNER_IDS passent toujours', async () => {
    rules = [{ commandName: 'ban', roleIds: [HELPER], enabled: false }];
    expect(await run(slash('ban', { userId: OWNER }))).toBeNull();
    expect(await run(slash('ban', { userId: BOT_OWNER }))).toBeNull();
    expect(ban.execute).toHaveBeenCalledTimes(2);
  });

  it('commande verrouillée (/config) : une règle ne la restreint jamais', async () => {
    rules = [{ commandName: 'config', roleIds: [HELPER], enabled: false }];
    expect(await run(slash('config', { perms: [PermissionFlagsBits.Administrator] }))).toBeNull();
    expect(config.execute).toHaveBeenCalled();
    expect(await resolveCommandAccess(slash('config', { roles: [HELPER] }) as never, 'config')).toBe('default');
  });

  it('/unban-all : admin par défaut, accessible à un rôle configuré', async () => {
    expect(await run(slash('unban-all', { roles: [STAFF_ROLE] }))).toContain('Niveau requis');
    rules = [{ commandName: 'unban-all', roleIds: [HELPER], enabled: true }];
    invalidateCommandPermissions(GUILD);
    expect(await run(slash('unban-all', { roles: [HELPER] }))).toBeNull();
    expect(unbanAll.execute).toHaveBeenCalledTimes(1);
  });

  it('composants rattachés explicitement (`command`) : règle appliquée (accès et refus)', async () => {
    rules = [{ commandName: 'unban-all', roleIds: [HELPER], enabled: true }];
    expect(await run(button('unbanall:status', { roles: [HELPER] }))).toBeNull();
    expect(unbanAllButtons.execute).toHaveBeenCalledTimes(1);
    expect(await run(button('unbanall:status', { roles: [STAFF_ROLE] }))).toContain(`<@&${HELPER}>`);
    expect(unbanAllButtons.execute).toHaveBeenCalledTimes(1);
  });

  it('composants d’une réponse de commande : le rôle autorisé suffit ; un refus retombe sur les vérifications par défaut', async () => {
    rules = [{ commandName: 'clear', roleIds: [HELPER], enabled: true }];
    expect(await run(button('mod:nuke:1', { roles: [HELPER] }, 'clear salon'))).toBeNull();
    expect(modButtons.execute).toHaveBeenCalledTimes(1);
    // Sans rattachement (message sans commande) : vérifications par défaut
    expect(await run(button('mod:nuke:1', { roles: [HELPER] }))).toContain('Niveau requis');
    rules = [{ commandName: 'clear', roleIds: [], enabled: false }];
    invalidateCommandPermissions(GUILD);
    expect(await run(button('mod:cancel', { roles: [STAFF_ROLE] }, 'clear salon'))).toBeNull();
    expect(modButtons.execute).toHaveBeenCalledTimes(2);
  });

  it('invalidateCommandPermissions délègue au service', () => {
    const spy = vi.spyOn(commandPermissionService, 'invalidate');
    invalidateCommandPermissions('123');
    expect(spy).toHaveBeenCalledWith('123');
  });
});
