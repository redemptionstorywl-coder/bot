import { GuildMember, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { roleService, type RoleMenuOption } from '../services/RoleService';
import { embedService } from '../services/EmbedService';
import { buildCustomId } from '../utils/customId';
import { assertRoleMenuEditor, parseMenuId } from '../buttons/_rolemenuEditor';

/**
 * Select menus du namespace `rolemenu` :
 *  - `rolemenu:select:<menuId>`      → sélection publique des rôles d'un RoleMenu (style SELECT)
 *  - éditeur (admin) : `addroles` (RoleSelect), `option` (personnaliser), `removerole`, `channel` (publier)
 */
export default defineSelectMenu({
  id: 'rolemenu',
  module: 'rolemenu',
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const [action, a] = args;
    const { t } = ctx;
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ embeds: [embedService.error(t('core.guild_only'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const menuId = parseMenuId(a);
    const menu = menuId ? await roleService.getRoleMenu(menuId) : null;
    if (!menu || menu.guildId !== interaction.guildId) {
      await interaction.reply({ embeds: [embedService.error(t('roles.rolemenu.not_found'))], flags: MessageFlags.Ephemeral });
      return;
    }

    // ───── Public ─────
    if (action === 'select') {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);
      const result = await roleService.applyMenuSelection(member, menu, interaction.values);
      const lines: string[] = [];
      if (result.added.length) lines.push(t('roles.common.roles_added', { roles: result.added.map((r) => `<@&${r}>`).join(' ') }));
      if (result.removed.length) lines.push(t('roles.common.roles_removed', { roles: result.removed.map((r) => `<@&${r}>`).join(' ') }));
      if (result.blocked.length) lines.push(t('roles.common.roles_blocked', { roles: result.blocked.map((r) => `<@&${r}>`).join(' ') }));
      if (!lines.length) lines.push(t('roles.common.no_change'));
      await interaction.editReply({ content: lines.join('\n') });
      return;
    }

    // ───── Éditeur ─────
    if (!(await assertRoleMenuEditor(interaction, ctx))) return;
    const options = roleService.getMenuOptions(menu);

    switch (action) {
      case 'addroles': {
        if (!interaction.isRoleSelectMenu()) return;
        const me = interaction.guild.members.me;
        const skipped: string[] = [];
        const next: RoleMenuOption[] = [...options];
        for (const roleId of interaction.values) {
          const role = interaction.guild.roles.cache.get(roleId);
          if (next.some((o) => o.roleId === roleId)) continue;
          if (!role || role.managed || role.id === interaction.guild.id || (me && me.roles.highest.comparePositionTo(role) <= 0)) {
            skipped.push(roleId);
            continue;
          }
          if (next.length >= 25) break;
          next.push({ roleId: role.id, label: role.name.slice(0, 80), emoji: role.unicodeEmoji ?? undefined });
        }
        const updated = await roleService.updateRoleMenu(menu.id, { options: next });
        await roleService.refreshRoleMenu(menu.id).catch(() => false);
        const note = skipped.length ? t('roles.rolemenu.editor.skipped', { roles: skipped.map((r) => `<@&${r}>`).join(' ') }) : undefined;
        await interaction.update(roleService.buildRoleMenuEditor(updated, interaction.guild, t, note));
        return;
      }
      case 'removerole': {
        if (!interaction.isStringSelectMenu()) return;
        const remove = new Set(interaction.values);
        const updated = await roleService.updateRoleMenu(menu.id, { options: options.filter((o) => !remove.has(o.roleId)) });
        await roleService.refreshRoleMenu(menu.id).catch(() => false);
        await interaction.update(roleService.buildRoleMenuEditor(updated, interaction.guild, t));
        return;
      }
      case 'option': {
        if (!interaction.isStringSelectMenu()) return;
        const roleId = interaction.values[0];
        const option = options.find((o) => o.roleId === roleId);
        if (!roleId || !option) {
          await interaction.reply({ embeds: [embedService.error(t('core.role_not_found'))], flags: MessageFlags.Ephemeral });
          return;
        }
        const modal = new ModalBuilder()
          .setCustomId(buildCustomId('rolemenu', 'option', menu.id, roleId))
          .setTitle(t('roles.rolemenu.modal.option_title').slice(0, 45))
          .addLabelComponents(
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.label')).setTextInputComponent(new TextInputBuilder().setCustomId('label').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80).setValue(option.label ?? '')),
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.emoji')).setTextInputComponent(new TextInputBuilder().setCustomId('emoji').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(64).setValue(option.emoji ?? '')),
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.option_description')).setTextInputComponent(new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(option.description ?? '')),
            new LabelBuilder().setLabel(t('roles.rolemenu.modal.style')).setTextInputComponent(new TextInputBuilder().setCustomId('style').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(9).setPlaceholder('primary | secondary | success | danger').setValue(option.style ?? '')),
          );
        await interaction.showModal(modal);
        return;
      }
      case 'channel': {
        if (!interaction.isChannelSelectMenu()) return;
        const channelId = interaction.values[0];
        if (!channelId) return;
        await interaction.deferUpdate();
        try {
          const updated = await roleService.publishRoleMenu(menu.id, channelId);
          await interaction.editReply(roleService.buildRoleMenuEditor(updated, interaction.guild, t, t('roles.rolemenu.published', { channel: `<#${channelId}>` })));
        } catch (err) {
          await interaction.editReply(roleService.buildRoleMenuEditor(menu, interaction.guild, t, t('roles.rolemenu.publish_failed', { error: err instanceof Error ? err.message : String(err) })));
        }
        return;
      }
      default:
        await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
    }
  },
});
