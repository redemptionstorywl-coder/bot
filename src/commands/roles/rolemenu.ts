import { ChannelType, LabelBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { defineCommand } from '../../structures';
import { roleService, type RoleMenuOption } from '../../services/RoleService';
import { embedService } from '../../services/EmbedService';
import { buildCustomId } from '../../utils/customId';
import { canManageRole } from '../../utils/permissions';

/**
 * /rolemenu — menus de rôles (boutons ou select) :
 * create (session interactive) · add-role · remove-role · publish · edit · delete · list
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('rolemenu')
    .setDescription('Menus de rôles (boutons / menu déroulant)')
    .addSubcommand((s) => s.setName('create').setDescription('Créer un menu de rôles (éditeur interactif)'))
    .addSubcommand((s) =>
      s
        .setName('add-role')
        .setDescription('Ajouter un rôle à un menu')
        .addIntegerOption((o) => o.setName('menu').setDescription('ID du menu').setRequired(true).setAutocomplete(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))
        .addStringOption((o) => o.setName('label').setDescription('Libellé').setMaxLength(80))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setMaxLength(64))
        .addStringOption((o) => o.setName('description').setDescription('Description (menu déroulant)').setMaxLength(100))
        .addStringOption((o) => o.setName('style').setDescription('Style du bouton').addChoices({ name: 'Primary (violet)', value: 'primary' }, { name: 'Secondary (gris)', value: 'secondary' }, { name: 'Success', value: 'success' }, { name: 'Danger', value: 'danger' })),
    )
    .addSubcommand((s) =>
      s
        .setName('remove-role')
        .setDescription('Retirer un rôle d’un menu')
        .addIntegerOption((o) => o.setName('menu').setDescription('ID du menu').setRequired(true).setAutocomplete(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('publish')
        .setDescription('Publier le menu dans un salon')
        .addIntegerOption((o) => o.setName('menu').setDescription('ID du menu').setRequired(true).setAutocomplete(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Salon').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) => s.setName('edit').setDescription('Ouvrir l’éditeur d’un menu').addIntegerOption((o) => o.setName('menu').setDescription('ID du menu').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('delete').setDescription('Supprimer un menu (et son message)').addIntegerOption((o) => o.setName('menu').setDescription('ID du menu').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Lister les menus de rôles')),
  module: 'rolemenu',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageRoles], bot: [PermissionFlagsBits.ManageRoles] },
  cooldown: 2,
  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = interaction.options.getFocused().toString().toLowerCase();
    const menus = await roleService.listRoleMenus(interaction.guildId);
    await interaction.respond(
      menus
        .filter((m) => !focused || m.name.toLowerCase().includes(focused) || String(m.id).startsWith(focused))
        .slice(0, 25)
        .map((m) => ({ name: `#${m.id} · ${m.name}`.slice(0, 100), value: m.id })),
    );
  },
  async execute(interaction, { t }) {
    if (!interaction.guild || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const guild = interaction.guild;

    if (sub === 'create') {
      const modal = new ModalBuilder()
        .setCustomId(buildCustomId('rolemenu', 'create'))
        .setTitle(t('roles.rolemenu.modal.create_title').slice(0, 45))
        .addLabelComponents(
          new LabelBuilder().setLabel(t('roles.rolemenu.modal.name')).setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
          new LabelBuilder().setLabel(t('roles.rolemenu.modal.title')).setTextInputComponent(new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)),
          new LabelBuilder().setLabel(t('roles.rolemenu.modal.description')).setTextInputComponent(new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000)),
        );
      await interaction.showModal(modal);
      return;
    }

    if (sub === 'list') {
      const menus = await roleService.listRoleMenus(interaction.guildId);
      const lines = menus.map((m) => `**#${m.id}** · ${m.name} — ${m.style === 'SELECT' ? t('roles.rolemenu.style_select') : t('roles.rolemenu.style_buttons')} · ${roleService.getMenuOptions(m).length} ${t('roles.rolemenu.roles_word')}${m.exclusive ? ' · 🔒' : ''}${m.channelId ? ` · <#${m.channelId}>` : ''}`);
      await interaction.reply({ embeds: [embedService.brand(t('roles.rolemenu.list_title'), lines.join('\n') || t('roles.rolemenu.empty'))], ...ephemeral });
      return;
    }

    const menuId = interaction.options.getInteger('menu', true);
    const menu = await roleService.getRoleMenu(menuId);
    if (!menu || menu.guildId !== interaction.guildId) {
      await interaction.reply({ embeds: [embedService.error(t('roles.rolemenu.not_found'))], ...ephemeral });
      return;
    }

    switch (sub) {
      case 'add-role': {
        const role = interaction.options.getRole('role', true);
        if (!canManageRole(guild.members.me, role.id)) {
          await interaction.reply({ embeds: [embedService.error(t('core.role_hierarchy'))], ...ephemeral });
          return;
        }
        const options = roleService.getMenuOptions(menu).filter((o) => o.roleId !== role.id);
        if (options.length >= 25) {
          await interaction.reply({ embeds: [embedService.error(t('roles.rolemenu.full'))], ...ephemeral });
          return;
        }
        const option: RoleMenuOption = {
          roleId: role.id,
          label: interaction.options.getString('label') ?? role.name.slice(0, 80),
          emoji: interaction.options.getString('emoji') ?? undefined,
          description: interaction.options.getString('description') ?? undefined,
          style: (interaction.options.getString('style') as RoleMenuOption['style']) ?? undefined,
        };
        await roleService.updateRoleMenu(menu.id, { options: [...options, option] });
        const refreshed = await roleService.refreshRoleMenu(menu.id).catch(() => false);
        await interaction.reply({ embeds: [embedService.success(t('roles.rolemenu.role_added', { role: `<@&${role.id}>`, name: menu.name }) + (refreshed ? `\n${t('roles.rolemenu.message_updated')}` : ''))], ...ephemeral });
        return;
      }
      case 'remove-role': {
        const role = interaction.options.getRole('role', true);
        const options = roleService.getMenuOptions(menu);
        if (!options.some((o) => o.roleId === role.id)) {
          await interaction.reply({ embeds: [embedService.warning(t('core.not_found'))], ...ephemeral });
          return;
        }
        await roleService.updateRoleMenu(menu.id, { options: options.filter((o) => o.roleId !== role.id) });
        await roleService.refreshRoleMenu(menu.id).catch(() => false);
        await interaction.reply({ embeds: [embedService.success(t('roles.rolemenu.role_removed', { role: `<@&${role.id}>`, name: menu.name }))], ...ephemeral });
        return;
      }
      case 'publish': {
        const channel = interaction.options.getChannel('channel', true);
        if (!roleService.getMenuOptions(menu).length) {
          await interaction.reply({ embeds: [embedService.error(t('roles.rolemenu.no_options'))], ...ephemeral });
          return;
        }
        await interaction.deferReply(ephemeral);
        const updated = await roleService.publishRoleMenu(menu.id, channel.id);
        await interaction.editReply({ embeds: [embedService.success(t('roles.rolemenu.published', { channel: `<#${updated.channelId}>` }))] });
        return;
      }
      case 'edit': {
        await interaction.reply({ ...roleService.buildRoleMenuEditor(menu, guild, t), ...ephemeral });
        return;
      }
      case 'delete': {
        await interaction.deferReply(ephemeral);
        await roleService.deleteRoleMenu(menu.id, true);
        await interaction.editReply({ embeds: [embedService.success(t('roles.rolemenu.deleted', { name: menu.name }))] });
        return;
      }
      default:
        await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: sub }))], ...ephemeral });
    }
  },
});
