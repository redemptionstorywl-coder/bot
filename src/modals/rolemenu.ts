import { MessageFlags } from 'discord.js';
import { defineModal } from '../structures';
import { roleService, roleMenuOptionSchema, type RoleMenuOption } from '../services/RoleService';
import { embedService, embedSpecSchema, type EmbedSpec } from '../services/EmbedService';
import { assertRoleMenuEditor, parseMenuId } from '../buttons/_rolemenuEditor';

/**
 * Modals du namespace `rolemenu` (admin) :
 *  - `rolemenu:create`                   → crée le menu puis ouvre l'éditeur
 *  - `rolemenu:edit:<menuId>`            → nom / titre / description / placeholder
 *  - `rolemenu:option:<menuId>:<roleId>` → label / emoji / description / style d'une option
 */
export default defineModal({
  id: 'rolemenu',
  module: 'rolemenu',
  async execute(interaction, args, ctx) {
    const [action, a, b] = args;
    const { t } = ctx;
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ embeds: [embedService.error(t('core.guild_only'))], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!(await assertRoleMenuEditor(interaction, ctx))) return;
    const field = (id: string) => interaction.fields.getTextInputValue(id)?.trim() ?? '';

    if (action === 'create') {
      const name = field('name') || t('roles.rolemenu.default_name');
      const embed: EmbedSpec = { title: field('title') || name, description: field('description') || undefined };
      const menu = await roleService.createRoleMenu(interaction.guildId, { name, embed });
      await interaction.reply({ ...roleService.buildRoleMenuEditor(menu, interaction.guild, t, t('roles.rolemenu.created', { name })), flags: MessageFlags.Ephemeral });
      return;
    }

    const menuId = parseMenuId(a);
    const menu = menuId ? await roleService.getRoleMenu(menuId) : null;
    if (!menu || menu.guildId !== interaction.guildId) {
      await interaction.reply({ embeds: [embedService.error(t('roles.rolemenu.not_found'))], flags: MessageFlags.Ephemeral });
      return;
    }

    const respond = async (payload: ReturnType<typeof roleService.buildRoleMenuEditor>) => {
      if (interaction.isFromMessage()) await interaction.update(payload);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    };

    if (action === 'edit') {
      const current = embedSpecSchema.safeParse(menu.embed);
      const embed: EmbedSpec = { ...(current.success ? current.data : {}), title: field('title') || undefined, description: field('description') || undefined };
      if (!embed.title && !embed.description) embed.title = field('name') || menu.name;
      const updated = await roleService.updateRoleMenu(menu.id, { name: field('name') || menu.name, embed, placeholder: field('placeholder') || null });
      await roleService.refreshRoleMenu(menu.id).catch(() => false);
      await respond(roleService.buildRoleMenuEditor(updated, interaction.guild, t));
      return;
    }

    if (action === 'option' && b) {
      const options = roleService.getMenuOptions(menu);
      const index = options.findIndex((o) => o.roleId === b);
      if (index === -1) {
        await interaction.reply({ embeds: [embedService.error(t('core.role_not_found'))], flags: MessageFlags.Ephemeral });
        return;
      }
      const styleRaw = field('style').toLowerCase();
      const candidate: RoleMenuOption = {
        roleId: b,
        label: field('label') || undefined,
        emoji: field('emoji') || undefined,
        description: field('description') || undefined,
        style: (['primary', 'secondary', 'success', 'danger'] as const).find((s) => s === styleRaw),
      };
      const parsed = roleMenuOptionSchema.safeParse(candidate);
      if (!parsed.success) {
        await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: parsed.error.issues.map((i) => i.message).join(', ') }))], flags: MessageFlags.Ephemeral });
        return;
      }
      const next = [...options];
      next[index] = parsed.data;
      const updated = await roleService.updateRoleMenu(menu.id, { options: next });
      await roleService.refreshRoleMenu(menu.id).catch(() => false);
      await respond(roleService.buildRoleMenuEditor(updated, interaction.guild, t));
      return;
    }

    await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
  },
});
