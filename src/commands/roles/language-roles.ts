import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { languageService } from '../../services/LanguageService';
import { embedService } from '../../services/EmbedService';
import { LANGUAGES, getLanguage } from '../../config/constants';
import { canManageRole } from '../../utils/permissions';

const langChoices = LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }));

/** /language-roles — associer un rôle à chaque langue (set | remove | list | reset-defaults). */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('language-roles')
    .setDescription('Rôles attribués selon la langue choisie')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Associer un rôle à une langue')
        .addStringOption((o) => o.setName('language').setDescription('Langue').setRequired(true).addChoices(...langChoices))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Retirer l’association d’une langue').addStringOption((o) => o.setName('language').setDescription('Langue').setRequired(true).addChoices(...langChoices)))
    .addSubcommand((s) => s.setName('list').setDescription('Afficher les rôles de langue'))
    .addSubcommand((s) => s.setName('reset-defaults').setDescription('Réinitialiser avec les rôles par défaut (Battle Royale)')),
  module: 'language',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageRoles], bot: [PermissionFlagsBits.ManageRoles] },
  cooldown: 2,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;

    switch (sub) {
      case 'set': {
        const code = interaction.options.getString('language', true);
        const role = interaction.options.getRole('role', true);
        const def = getLanguage(code)!;
        if (!canManageRole(guild.members.me, role.id)) {
          await interaction.reply({ embeds: [embedService.error(t('core.role_hierarchy'))], ...ephemeral });
          return;
        }
        await languageService.setLanguageRole(guild.id, code, role.id, { emoji: def.flag, label: def.nativeLabel });
        await interaction.reply({ embeds: [embedService.success(t('language.roles.set', { flag: def.flag, language: def.nativeLabel, role: `<@&${role.id}>` }))], ...ephemeral });
        return;
      }
      case 'remove': {
        const code = interaction.options.getString('language', true);
        const def = getLanguage(code)!;
        const n = await languageService.removeLanguageRole(guild.id, code);
        await interaction.reply({ embeds: [n ? embedService.success(t('language.roles.removed', { flag: def.flag, language: def.nativeLabel })) : embedService.warning(t('core.not_found'))], ...ephemeral });
        return;
      }
      case 'reset-defaults': {
        await interaction.deferReply(ephemeral);
        const { configured, missing } = await languageService.resetDefaults(guild);
        const lines = Object.entries(configured).map(([code, roleId]) => `${getLanguage(code)?.flag ?? ''} ${getLanguage(code)?.nativeLabel ?? code} → <@&${roleId}>`);
        const embed = embedService.success(lines.length ? lines.join('\n') : t('language.roles.none_default'), t('language.roles.reset_title'));
        if (missing.length) embed.addFields({ name: t('language.roles.missing'), value: missing.map((c) => `${getLanguage(c)?.flag ?? ''} ${c}`).join(', ') });
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      case 'list':
      default: {
        const configured = await languageService.getLanguageRoleMap(guild.id);
        const effective = await languageService.getEffectiveRoleMap(guild);
        const usingDefaults = !Object.keys(configured).length && Object.keys(effective).length > 0;
        const lines = LANGUAGES.filter((l) => config.enabledLanguages.includes(l.code)).map((l) => {
          const roleId = effective[l.code];
          const state = roleId ? (guild.roles.cache.has(roleId) ? `<@&${roleId}>` : `⚠️ \`${roleId}\``) : '—';
          return `${l.flag} **${l.nativeLabel}** → ${state}`;
        });
        const embed = embedService.brand(t('language.roles.list_title'), lines.join('\n') || t('core.none'));
        if (usingDefaults) embed.setFooter({ text: t('language.roles.using_defaults') });
        await interaction.reply({ embeds: [embed], ...ephemeral });
      }
    }
  },
});
