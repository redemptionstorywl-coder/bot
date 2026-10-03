import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { PanelStyle } from '@prisma/client';
import { defineCommand } from '../../structures';
import { roleService, DEFAULT_NOTIFICATIONS } from '../../services/RoleService';
import { embedService } from '../../services/EmbedService';
import { canManageRole } from '../../utils/permissions';

/** /notifications — rôles de notification : setup · panel · add · remove · list */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Rôles de notification (annonces, événements, streams…)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName('setup').setDescription('Créer / associer les rôles de notification par défaut'))
    .addSubcommand((s) =>
      s
        .setName('panel')
        .setDescription('Publier le panneau de notifications')
        .addChannelOption((o) => o.setName('channel').setDescription('Salon').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName('style').setDescription('Style').addChoices({ name: 'Menu déroulant (multi)', value: 'SELECT' }, { name: 'Boutons', value: 'BUTTONS' })),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Ajouter / modifier une notification')
        .addStringOption((o) => o.setName('key').setDescription('Clé (ex. streams)').setRequired(true).setMaxLength(64))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))
        .addStringOption((o) => o.setName('label').setDescription('Libellé').setMaxLength(100))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setMaxLength(64))
        .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(100))
        .addIntegerOption((o) => o.setName('order').setDescription('Ordre d’affichage').setMinValue(0).setMaxValue(100)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Retirer une notification').addStringOption((o) => o.setName('key').setDescription('Clé').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Lister les notifications')),
  module: 'notifications',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageRoles], bot: [PermissionFlagsBits.ManageRoles] },
  cooldown: 2,
  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = interaction.options.getFocused().toString().toLowerCase();
    const rows = await roleService.listNotificationRoles(interaction.guildId);
    await interaction.respond(rows.filter((r) => !focused || r.key.includes(focused) || r.label.toLowerCase().includes(focused)).slice(0, 25).map((r) => ({ name: `${r.emoji ?? '🔔'} ${r.label} (${r.key})`.slice(0, 100), value: r.key })));
  },
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !interaction.guildId || !config) return;
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const guild = interaction.guild;

    switch (sub) {
      case 'setup': {
        await interaction.deferReply(ephemeral);
        const { created, linked } = await roleService.setupDefaults(guild);
        const rows = await roleService.listNotificationRoles(interaction.guildId);
        const embed = embedService.success(rows.map((r) => `${r.emoji ?? '🔔'} **${r.label}** → <@&${r.roleId}>`).join('\n'), t('roles.notif.setup_title'));
        embed.addFields({ name: t('roles.notif.setup_created'), value: String(created.length), inline: true }, { name: t('roles.notif.setup_linked'), value: String(linked.length), inline: true });
        embed.setFooter({ text: t('roles.notif.setup_footer', { count: DEFAULT_NOTIFICATIONS.length }) });
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      case 'panel': {
        const channel = interaction.options.getChannel('channel', true);
        const style = interaction.options.getString('style') === 'BUTTONS' ? PanelStyle.BUTTONS : PanelStyle.SELECT;
        const rows = await roleService.listNotificationRoles(interaction.guildId);
        if (!rows.filter((r) => r.enabled).length) {
          await interaction.reply({ embeds: [embedService.error(t('roles.notif.none_configured'))], ...ephemeral });
          return;
        }
        await interaction.deferReply(ephemeral);
        const message = await roleService.publishNotificationPanel(interaction.guildId, channel.id, style);
        await interaction.editReply({ embeds: [embedService.success(t('roles.notif.panel_published', { channel: `<#${channel.id}>`, url: message.url }))] });
        return;
      }
      case 'add': {
        const role = interaction.options.getRole('role', true);
        const key = interaction.options.getString('key', true);
        if (!canManageRole(guild.members.me, role.id)) {
          await interaction.reply({ embeds: [embedService.error(t('core.role_hierarchy'))], ...ephemeral });
          return;
        }
        const row = await roleService.upsertNotificationRole(interaction.guildId, {
          key,
          roleId: role.id,
          label: interaction.options.getString('label') ?? role.name,
          emoji: interaction.options.getString('emoji'),
          description: interaction.options.getString('description'),
          order: interaction.options.getInteger('order') ?? undefined,
        });
        await interaction.reply({ embeds: [embedService.success(t('roles.notif.added', { emoji: row.emoji ?? '🔔', label: row.label, role: `<@&${row.roleId}>`, key: row.key }))], ...ephemeral });
        return;
      }
      case 'remove': {
        const key = interaction.options.getString('key', true);
        const n = await roleService.removeNotificationRole(interaction.guildId, key);
        await interaction.reply({ embeds: [n ? embedService.success(t('roles.notif.removed', { key })) : embedService.warning(t('core.not_found'))], ...ephemeral });
        return;
      }
      case 'list':
      default: {
        const rows = await roleService.listNotificationRoles(interaction.guildId);
        const lines = rows.map((r) => `${r.enabled ? '🟢' : '🔴'} ${r.emoji ?? '🔔'} **${r.label}** (\`${r.key}\`) → <@&${r.roleId}>${r.description ? `\n> ${r.description}` : ''}`);
        await interaction.reply({ embeds: [embedService.brand(t('roles.notif.list_title'), lines.join('\n') || t('roles.notif.none_configured'))], ...ephemeral });
      }
    }
  },
});
