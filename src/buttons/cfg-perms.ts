import { defineButton } from '../structures';
import { commandPermissionService } from '../services/CommandPermissionService';
import { guildConfigService } from '../services/GuildConfigService';
import { ko, ok, show, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { groupByCategory, permissionCatalog, renderPermissions, type PermissionsView } from '../panels/_permissions';

/**
 * Boutons du panneau `/config permissions` (namespace `cfg-perms`, admin) :
 *  - `cfg-perms:view:main` · `cfg-perms:view:resetall` · `cfg-perms:view:cat:<catégorie>:<page>` → change de vue
 *  - `cfg-perms:toggle:<commande>`    → active / désactive la commande
 *  - `cfg-perms:reset:<commande>`     → revient au comportement par défaut
 *  - `cfg-perms:catreset:<catégorie>` → remet toute la catégorie par défaut
 *  - `cfg-perms:resetall`             → supprime toutes les règles du serveur (après confirmation)
 */
export default defineButton({
  id: 'cfg-perms',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guild || !ctx.config) return;
    const guildId = interaction.guild.id;
    const [action = '', a1 = '', a2 = '', a3 = ''] = args;
    const config = (await guildConfigService.get(guildId)) ?? ctx.config;
    const catalog = permissionCatalog(ctx.client.commands.values(), config.kind);
    let view: PermissionsView = { kind: 'main' };
    let notice: PanelNotice | undefined;

    switch (action) {
      case 'view':
        if (a1 === 'cat') view = { kind: 'category', category: a2, page: Number(a3) || 0 };
        else if (a1 === 'resetall') view = { kind: 'resetall' };
        break;
      case 'toggle':
      case 'reset': {
        const info = catalog.find((c) => c.name === a1);
        if (!info) return unknownAction(interaction, t, a1);
        view = { kind: 'command', command: info.name };
        if (info.locked) {
          notice = ko(t('permissions.panel.locked_notice', { command: info.name }));
          break;
        }
        if (action === 'reset') {
          await commandPermissionService.reset(guildId, info.name);
          notice = ok(t('permissions.panel.reset_done', { command: info.name }));
          break;
        }
        const enabled = !((await commandPermissionService.get(guildId, info.name))?.enabled ?? true);
        await commandPermissionService.set(guildId, info.name, { enabled });
        notice = ok(t(enabled ? 'permissions.panel.toggled_on' : 'permissions.panel.toggled_off', { command: info.name }));
        break;
      }
      case 'catreset': {
        const group = groupByCategory(catalog).find((g) => g.key === a1);
        if (!group) return unknownAction(interaction, t, a1);
        const count = await commandPermissionService.reset(guildId, group.commands.filter((c) => !c.locked).map((c) => c.name));
        view = { kind: 'category', category: group.key };
        notice = ok(t('permissions.panel.category_reset_done', { count }));
        break;
      }
      case 'resetall': {
        const count = await commandPermissionService.reset(guildId);
        notice = ok(t('permissions.panel.reset_all_done', { count }));
        break;
      }
      default:
        return unknownAction(interaction, t, action);
    }

    const rules = await commandPermissionService.rules(guildId);
    await show(interaction, renderPermissions({ guild: interaction.guild, config, t, commands: ctx.client.commands.values(), rules, view, notice }));
  },
});
