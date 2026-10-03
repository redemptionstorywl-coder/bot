import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AutoRoleType } from '@prisma/client';
import { defineCommand } from '../../structures';
import { roleService, MAX_AUTOROLE_DELAY_SECONDS } from '../../services/RoleService';
import { embedService } from '../../services/EmbedService';
import { canManageRole } from '../../utils/permissions';
import { formatDuration, parseDuration } from '../../utils/time';

const typeChoices = Object.values(AutoRoleType).map((v) => ({ name: v, value: v }));

/** /autorole — rôles automatiques (JOIN, BOT, VERIFIED, MEMBER, LANGUAGE, SPECIAL) avec délai optionnel. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Rôles attribués automatiquement')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Ajouter un rôle automatique')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))
        .addStringOption((o) => o.setName('type').setDescription('Déclencheur').setRequired(true).addChoices(...typeChoices))
        .addStringOption((o) => o.setName('delay').setDescription('Délai (ex. 10m, 1h — max 24h)')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Retirer un rôle automatique')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))
        .addStringOption((o) => o.setName('type').setDescription('Déclencheur (vide = tous)').addChoices(...typeChoices)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Lister les rôles automatiques')),
  module: 'autorole',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageRoles], bot: [PermissionFlagsBits.ManageRoles] },
  cooldown: 2,
  async execute(interaction, { t, lang }) {
    if (!interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const role = interaction.options.getRole('role', true);
      const type = interaction.options.getString('type', true) as AutoRoleType;
      const delayRaw = interaction.options.getString('delay');
      let delay = 0;
      if (delayRaw) {
        const parsed = parseDuration(delayRaw);
        if (parsed === null) {
          await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: delayRaw }))], ...ephemeral });
          return;
        }
        delay = Math.min(parsed, MAX_AUTOROLE_DELAY_SECONDS);
      }
      if (!canManageRole(interaction.guild.members.me, role.id)) {
        await interaction.reply({ embeds: [embedService.error(t('core.role_hierarchy'))], ...ephemeral });
        return;
      }
      await roleService.addAutoRole(guildId, role.id, type, delay);
      await interaction.reply({ embeds: [embedService.success(t('roles.autorole.added', { role: `<@&${role.id}>`, type, delay: delay ? formatDuration(delay, lang) : t('roles.autorole.immediate') }))], ...ephemeral });
      return;
    }
    if (sub === 'remove') {
      const role = interaction.options.getRole('role', true);
      const type = (interaction.options.getString('type') as AutoRoleType | null) ?? undefined;
      const n = await roleService.removeAutoRole(guildId, role.id, type);
      await interaction.reply({ embeds: [n ? embedService.success(t('roles.autorole.removed', { role: `<@&${role.id}>`, count: n })) : embedService.warning(t('core.not_found'))], ...ephemeral });
      return;
    }
    const rows = await roleService.listAutoRoles(guildId);
    const lines = rows.map((r) => `${r.enabled ? '🟢' : '🔴'} <@&${r.roleId}> — \`${r.type}\`${r.delaySeconds ? ` · ⏱️ ${formatDuration(r.delaySeconds, lang)}` : ''}`);
    await interaction.reply({ embeds: [embedService.brand(t('roles.autorole.list_title'), lines.join('\n') || t('roles.autorole.empty')).addFields({ name: t('roles.autorole.types_title'), value: t('roles.autorole.types_help') })], ...ephemeral });
  },
});
