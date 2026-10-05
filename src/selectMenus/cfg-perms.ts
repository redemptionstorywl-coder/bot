import { defineSelectMenu } from '../structures';
import { commandPermissionService } from '../services/CommandPermissionService';
import { guildConfigService } from '../services/GuildConfigService';
import { ko, ok, show, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { MAX_ALLOWED_ROLES, groupByCategory, permissionCatalog, renderPermissions, type PermissionsView } from '../panels/_permissions';

/**
 * Menus du panneau `/config permissions` (namespace `cfg-perms`, admin) :
 *  - `cfg-perms:cat`                  (StringSelect) → vue d'une catégorie
 *  - `cfg-perms:cmd`                  (StringSelect) → vue d'une commande
 *  - `cfg-perms:roles:<commande>`     (RoleSelect)   → rôles autorisés de la commande (vide = règle par défaut)
 *  - `cfg-perms:catroles:<catégorie>` (RoleSelect)   → mêmes rôles pour toutes les commandes modifiables de la catégorie
 */
export default defineSelectMenu({
  id: 'cfg-perms',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guild || !ctx.config) return;
    const guildId = interaction.guild.id;
    const [action = '', arg = ''] = args;
    const config = (await guildConfigService.get(guildId)) ?? ctx.config;
    const catalog = permissionCatalog(ctx.client.commands.values(), config.kind);
    let view: PermissionsView;
    let notice: PanelNotice | undefined;

    switch (action) {
      case 'cat': {
        if (!interaction.isStringSelectMenu()) return;
        view = { kind: 'category', category: interaction.values[0] ?? '' };
        break;
      }
      case 'cmd': {
        if (!interaction.isStringSelectMenu()) return;
        view = { kind: 'command', command: interaction.values[0] ?? '' };
        break;
      }
      case 'roles': {
        if (!interaction.isRoleSelectMenu()) return;
        const info = catalog.find((c) => c.name === arg);
        if (!info) return unknownAction(interaction, t, arg);
        view = { kind: 'command', command: info.name };
        if (info.locked) {
          notice = ko(t('permissions.panel.locked_notice', { command: info.name }));
          break;
        }
        const roleIds = [...interaction.values].slice(0, MAX_ALLOWED_ROLES);
        await commandPermissionService.set(guildId, info.name, { roleIds });
        notice = ok(roleIds.length ? t('permissions.panel.roles_set', { command: info.name, count: roleIds.length }) : t('permissions.panel.roles_cleared', { command: info.name }));
        break;
      }
      case 'catroles': {
        if (!interaction.isRoleSelectMenu()) return;
        const group = groupByCategory(catalog).find((g) => g.key === arg);
        if (!group) return unknownAction(interaction, t, arg);
        const names = group.commands.filter((c) => !c.locked).map((c) => c.name);
        const roleIds = [...interaction.values].slice(0, MAX_ALLOWED_ROLES);
        await commandPermissionService.set(guildId, names, { roleIds });
        view = { kind: 'category', category: group.key };
        notice = ok(roleIds.length ? t('permissions.panel.category_roles_set', { count: roleIds.length, commands: names.length }) : t('permissions.panel.category_roles_cleared', { commands: names.length }));
        break;
      }
      default:
        return unknownAction(interaction, t, action);
    }

    const rules = await commandPermissionService.rules(guildId);
    await show(interaction, renderPermissions({ guild: interaction.guild, config, t, commands: ctx.client.commands.values(), rules, view, notice }));
  },
});
