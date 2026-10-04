import type { AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { roleService } from '../services/RoleService';
import { PanelError, attempt, ko, show, unknownAction, type PanelNotice } from '../panels/_modulesKit';
import { getNotifStyle, isPanelAutoRoleType, removeReactionRole, renderRoles, saveAutoRoles, type RolesTab } from '../panels/_roles';

/**
 * Menus du panneau `/config module:roles` (namespace `cfg-roles`, admin) :
 *  - `auto:<JOIN|BOT|VERIFIED>` (RoleSelect)  → rôles automatiques du déclencheur
 *  - `menu` (StringSelect)                    → ouvre l'éditeur du role menu (namespace `rolemenu`)
 *  - `rr-del` (StringSelect)                  → supprime un reaction role
 *  - `nf-del` (StringSelect)                  → retire une notification
 *  - `nf-publish` (ChannelSelect)             → publie le panneau de notifications
 */
export default defineSelectMenu({
  id: 'cfg-roles',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', arg = ''] = args;
    await handle(interaction, action, arg, ctx);
  },
});

async function handle(interaction: AnySelectMenuInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const config = ctx.config!;
  const guild = interaction.guild;
  const view = async (tab: RolesTab, notice?: PanelNotice) => show(interaction, await renderRoles(tab, { guild, config, t, userId: interaction.user.id, notice }));

  switch (action) {
    case 'auto': {
      if (!interaction.isRoleSelectMenu() || !isPanelAutoRoleType(arg)) return;
      const notice = await attempt(t, () => saveAutoRoles(guild, arg, [...interaction.values], t));
      return view('auto', notice);
    }
    case 'menu': {
      if (!interaction.isStringSelectMenu()) return;
      const menu = await roleService.getRoleMenu(Number(interaction.values[0]));
      if (!menu || menu.guildId !== guild.id) return view('menus', ko(t('roles.rolemenu.not_found')));
      return interaction.update(roleService.buildRoleMenuEditor(menu, guild, t));
    }
    case 'rr-del': {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferUpdate();
      const notice = await attempt(t, () => removeReactionRole(guild, Number(interaction.values[0]), t));
      return view('reactions', notice);
    }
    case 'nf-del': {
      if (!interaction.isStringSelectMenu()) return;
      const key = interaction.values[0] ?? '';
      const notice = await attempt(t, async () => {
        const n = await roleService.removeNotificationRole(guild.id, key);
        if (!n) throw new PanelError('core.not_found');
        return t('roles.notif.removed', { key });
      });
      return view('notifs', notice);
    }
    case 'nf-publish': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      if (!channelId) return;
      await interaction.deferUpdate();
      const notice = await attempt(t, async () => {
        if (!(await roleService.listNotificationRoles(guild.id)).some((r) => r.enabled)) throw new PanelError('roles.notif.none_configured');
        const message = await roleService.publishNotificationPanel(guild.id, channelId, getNotifStyle(guild.id, interaction.user.id)).catch((err: unknown) => {
          if (err instanceof Error && err.name === 'Error') throw new PanelError('core.channel_not_found');
          throw err;
        });
        return t('roles.notif.panel_published', { channel: `<#${channelId}>`, url: message.url });
      });
      return view('notifs', notice);
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
