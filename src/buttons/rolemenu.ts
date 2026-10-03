import { GuildMember, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { PanelStyle } from '@prisma/client';
import { defineButton } from '../structures';
import { roleService } from '../services/RoleService';
import { embedService, embedSpecSchema } from '../services/EmbedService';
import { buildCustomId } from '../utils/customId';
import { assertRoleMenuEditor, parseMenuId, PUBLIC_ROLEMENU_ACTIONS } from './_rolemenuEditor';

/**
 * Boutons du namespace `rolemenu` :
 *  - `rolemenu:toggle:<roleId>`           → ajoute / retire un rôle (générique, utilisé par l'Embed Builder)
 *  - `rolemenu:menu:<menuId>:<roleId>`    → bouton d'un RoleMenu publié
 *  - éditeur (admin) : `editor|style|exclusive|edit|publish|delete` + `<menuId>`
 */
export default defineButton({
  id: 'rolemenu',
  module: 'rolemenu',
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const [action, a, b] = args;
    const { t } = ctx;
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ embeds: [embedService.error(t('core.guild_only'))], flags: MessageFlags.Ephemeral });
      return;
    }

    // ───── Actions publiques ─────
    if (action === 'toggle' && a) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);
      const result = await roleService.toggleRole(member, a);
      await interaction.editReply({ content: toggleMessage(result.action, a, t) });
      return;
    }
    if (action === 'menu' && a && b) {
      const menuId = parseMenuId(a);
      const menu = menuId ? await roleService.getRoleMenu(menuId) : null;
      if (!menu || menu.guildId !== interaction.guildId) {
        await interaction.reply({ embeds: [embedService.error(t('roles.rolemenu.not_found'))], flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);
      const result = await roleService.toggleMenuRole(member, menu, b);
      const extra = result.removed.filter((r) => r !== b);
      let content = toggleMessage(result.action, b, t);
      if (extra.length) content += `\n${t('roles.common.roles_removed', { roles: extra.map((r) => `<@&${r}>`).join(' ') })}`;
      await interaction.editReply({ content });
      return;
    }
    if (PUBLIC_ROLEMENU_ACTIONS.has(action ?? '')) {
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
      return;
    }

    // ───── Éditeur (admin) ─────
    if (!(await assertRoleMenuEditor(interaction, ctx))) return;
    const menuId = parseMenuId(a);
    const menu = menuId ? await roleService.getRoleMenu(menuId) : null;
    if (!menu || menu.guildId !== interaction.guildId) {
      await interaction.reply({ embeds: [embedService.error(t('roles.rolemenu.not_found'))], flags: MessageFlags.Ephemeral });
      return;
    }

    switch (action) {
      case 'editor': {
        await interaction.update(roleService.buildRoleMenuEditor(menu, interaction.guild, t));
        return;
      }
      case 'style': {
        const updated = await roleService.updateRoleMenu(menu.id, { style: menu.style === PanelStyle.SELECT ? PanelStyle.BUTTONS : PanelStyle.SELECT });
        await roleService.refreshRoleMenu(menu.id).catch(() => false);
        await interaction.update(roleService.buildRoleMenuEditor(updated, interaction.guild, t));
        return;
      }
      case 'exclusive': {
        const updated = await roleService.updateRoleMenu(menu.id, { exclusive: !menu.exclusive });
        await roleService.refreshRoleMenu(menu.id).catch(() => false);
        await interaction.update(roleService.buildRoleMenuEditor(updated, interaction.guild, t));
        return;
      }
      case 'edit': {
        const spec = embedSpecSchema.safeParse(menu.embed);
        const current = spec.success ? spec.data : {};
        const modal = new ModalBuilder()
          .setCustomId(buildCustomId('rolemenu', 'edit', menu.id))
          .setTitle(t('roles.rolemenu.modal.edit_title').slice(0, 45))
          .addLabelComponents(
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.name')).setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(menu.name)),
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.title')).setTextInputComponent(new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(current.title ?? '')),
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.description')).setTextInputComponent(new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setValue(current.description ?? '')),
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.placeholder')).setTextInputComponent(new TextInputBuilder().setCustomId('placeholder').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(150).setValue(menu.placeholder ?? '')),
          );
        await interaction.showModal(modal);
        return;
      }
      case 'publish': {
        await interaction.update(roleService.buildChannelPicker(menu, t));
        return;
      }
      case 'delete': {
        await roleService.deleteRoleMenu(menu.id, true);
        await interaction.update({ content: t('roles.rolemenu.deleted', { name: menu.name }), embeds: [], components: [] });
        return;
      }
      default:
        await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
    }
  },
});

function toggleMessage(action: 'added' | 'removed' | 'blocked', roleId: string, t: (k: string, v?: Record<string, string>) => string): string {
  if (action === 'blocked') return t('core.role_hierarchy');
  return action === 'added' ? t('roles.common.role_added', { role: `<@&${roleId}>` }) : t('roles.common.role_removed', { role: `<@&${roleId}>` });
}
