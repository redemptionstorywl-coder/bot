import type { ButtonInteraction } from 'discord.js';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { roleService } from '../services/RoleService';
import { buildRoleMenuCreateModal } from './_rolemenuEditor';
import { attempt, show, toggleModule, unknownAction, type PanelNotice } from '../panels/_modulesKit';
import { TAB_MODULE, buildDelaysModal, buildNotificationModal, buildReactionRoleModal, isRolesTab, renderRoles, toggleNotifStyle, type RolesTab } from '../panels/_roles';

/**
 * Boutons du panneau `/config module:roles` (namespace `cfg-roles`, admin) :
 * `tab:<onglet>`, `module:<onglet>`, `delays` (modal), `menu-new` (modal `rolemenu:create`), `rr-add` / `nf-add` (modals),
 * `nf-defaults` (crée / associe les rôles de notification par défaut), `nf-style` (style du panneau publié).
 */
export default defineButton({
  id: 'cfg-roles',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', arg = ''] = args;
    await handle(interaction, action, arg, ctx);
  },
});

async function handle(interaction: ButtonInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  let config = ctx.config!;
  const guild = interaction.guild;
  const view = async (tab: RolesTab, notice?: PanelNotice) => show(interaction, await renderRoles(tab, { guild, config, t, userId: interaction.user.id, notice }));

  switch (action) {
    case 'tab':
      return view(isRolesTab(arg) ? arg : 'auto');
    case 'module': {
      const tab = isRolesTab(arg) ? arg : 'auto';
      const r = await toggleModule(config, TAB_MODULE[tab], t);
      config = r.config;
      return view(tab, r.notice);
    }
    case 'delays':
      return interaction.showModal(await buildDelaysModal(guild.id, t));
    case 'menu-new':
      return interaction.showModal(buildRoleMenuCreateModal(t));
    case 'rr-add':
      return interaction.showModal(buildReactionRoleModal(t));
    case 'nf-add':
      return interaction.showModal(buildNotificationModal(t));
    case 'nf-defaults': {
      await interaction.deferUpdate();
      const notice = await attempt(t, async () => {
        const { created, linked } = await roleService.setupDefaults(guild);
        return t('panels_modules.roles.notifs.defaults_done', { created: created.length, linked: linked.length });
      });
      return view('notifs', notice);
    }
    case 'nf-style': {
      const style = toggleNotifStyle(guild.id, interaction.user.id);
      return view('notifs', { type: 'success', text: t('panels_modules.roles.notifs.style_set', { style: style === 'SELECT' ? t('roles.rolemenu.style_select') : t('roles.rolemenu.style_buttons') }) });
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
