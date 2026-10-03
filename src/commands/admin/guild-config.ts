import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { GuildKind, LogCategory } from '@prisma/client';
import { defineCommand } from '../../structures';
import { guildConfigService } from '../../services/GuildConfigService';
import { embedService } from '../../services/EmbedService';
import { GUILD_KIND_ALIASES, GUILD_KIND_LABELS, LANGUAGES, LOG_CATEGORY_LABELS, MODULE_KEYS, MODULE_LABELS } from '../../config/constants';
import { translationService } from '../../services/TranslationService';
import { env } from '../../config/env';

/**
 * /guild-config — configuration générale du serveur (type, langue, rôles staff/admin, logs, modules).
 * Tout est également modifiable depuis le dashboard.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('guild-config')
    .setDescription('Configurer ce serveur (type, langues, rôles, logs, modules)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName('type')
        .setDescription('Définir le type de serveur')
        .addStringOption((o) =>
          o
            .setName('kind')
            .setDescription('Type de serveur')
            .setRequired(true)
            .addChoices(
              { name: '🔒 Prison RP (Redemption Story WL)', value: 'prison' },
              { name: '⚔️ Battle Royale', value: 'battle-royale' },
              { name: '🎓 School RP', value: 'school' },
              { name: '🛒 Shop', value: 'shop' },
              { name: 'Générique', value: 'generic' },
            ),
        ),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Afficher la configuration actuelle'))
    .addSubcommand((s) =>
      s
        .setName('language')
        .setDescription('Définir la langue par défaut du serveur')
        .addStringOption((o) =>
          o
            .setName('code')
            .setDescription('Langue')
            .setRequired(true)
            .addChoices(...LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('languages')
        .setDescription('Activer ou désactiver une langue sur ce serveur')
        .addStringOption((o) =>
          o
            .setName('code')
            .setDescription('Langue')
            .setRequired(true)
            .addChoices(...LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }))),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('staff-role')
        .setDescription('Ajouter / retirer un rôle staff')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))
        .addBooleanOption((o) => o.setName('remove').setDescription('Retirer le rôle de la liste')),
    )
    .addSubcommand((s) =>
      s
        .setName('admin-role')
        .setDescription('Ajouter / retirer un rôle administrateur du bot')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))
        .addBooleanOption((o) => o.setName('remove').setDescription('Retirer le rôle de la liste')),
    )
    .addSubcommand((s) =>
      s
        .setName('log-channel')
        .setDescription('Définir le salon d’une catégorie de logs')
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Catégorie')
            .setRequired(true)
            .addChoices(...Object.values(LogCategory).map((c) => ({ name: LOG_CATEGORY_LABELS[c] ?? c, value: c }))),
        )
        .addChannelOption((o) => o.setName('channel').setDescription('Salon (vide = désactiver)').addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) =>
      s
        .setName('module')
        .setDescription('Activer / désactiver un module')
        .addStringOption((o) =>
          o
            .setName('module')
            .setDescription('Module')
            .setRequired(true)
            .addChoices(...MODULE_KEYS.map((k) => ({ name: MODULE_LABELS[k], value: k }))),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('brand-color')
        .setDescription('Couleur par défaut des embeds')
        .addStringOption((o) => o.setName('hex').setDescription('Ex: #7C3AED').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('translation-mode')
        .setDescription('Mode de diffusion multilingue des annonces')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Mode')
            .setRequired(true)
            .addChoices({ name: 'Salons séparés par langue', value: 'CHANNELS' }, { name: 'Plusieurs messages contrôlés par permissions', value: 'PERMISSIONS' }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('language-channel')
        .setDescription('Associer un salon à une langue (mode salons séparés)')
        .addStringOption((o) =>
          o
            .setName('code')
            .setDescription('Langue')
            .setRequired(true)
            .addChoices(...LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }))),
        )
        .addChannelOption((o) => o.setName('channel').setDescription('Salon (vide = retirer)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    ),
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.Administrator] },
  cooldown: 2,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;

    switch (sub) {
      case 'type': {
        const kind = GUILD_KIND_ALIASES[interaction.options.getString('kind', true)] ?? GuildKind.GENERIC;
        await guildConfigService.setKind(guildId, kind);
        await interaction.reply({ embeds: [embedService.success(t('admin.guild_config.kind_set', { kind: GUILD_KIND_LABELS[kind] }))], ...ephemeral });
        return;
      }
      case 'language': {
        const code = interaction.options.getString('code', true);
        const enabled = config.enabledLanguages.includes(code) ? config.enabledLanguages : [...config.enabledLanguages, code];
        await guildConfigService.updateSettings(guildId, { defaultLanguage: code, enabledLanguages: enabled });
        await interaction.reply({ embeds: [embedService.success(t('admin.guild_config.language_set', { language: code }))], ...ephemeral });
        return;
      }
      case 'languages': {
        const code = interaction.options.getString('code', true);
        const enabled = interaction.options.getBoolean('enabled', true);
        let list = config.enabledLanguages.filter((l) => l !== code);
        if (enabled) list = [...list, code];
        if (!list.includes(config.defaultLanguage)) list.push(config.defaultLanguage);
        await guildConfigService.updateSettings(guildId, { enabledLanguages: list });
        await interaction.reply({ embeds: [embedService.success(t('admin.guild_config.languages_updated', { languages: list.join(', ') }))], ...ephemeral });
        return;
      }
      case 'staff-role':
      case 'admin-role': {
        const role = interaction.options.getRole('role', true);
        const remove = interaction.options.getBoolean('remove') ?? false;
        const key = sub === 'staff-role' ? 'staffRoleIds' : 'adminRoleIds';
        const current = sub === 'staff-role' ? config.staffRoleIds : config.adminRoleIds;
        const next = remove ? current.filter((r) => r !== role.id) : [...new Set([...current, role.id])];
        await guildConfigService.updateSettings(guildId, { [key]: next });
        await interaction.reply({ embeds: [embedService.success(t(remove ? 'admin.guild_config.role_removed' : 'admin.guild_config.role_added', { role: `<@&${role.id}>` }))], ...ephemeral });
        return;
      }
      case 'log-channel': {
        const category = interaction.options.getString('category', true) as LogCategory;
        const channel = interaction.options.getChannel('channel');
        await guildConfigService.setLogChannel(guildId, category, channel?.id ?? null);
        await interaction.reply({
          embeds: [embedService.success(channel ? t('admin.guild_config.log_set', { category, channel: `<#${channel.id}>` }) : t('admin.guild_config.log_removed', { category }))],
          ...ephemeral,
        });
        return;
      }
      case 'module': {
        const mod = interaction.options.getString('module', true) as (typeof MODULE_KEYS)[number];
        const enabled = interaction.options.getBoolean('enabled', true);
        await guildConfigService.setModule(guildId, mod, enabled);
        await interaction.reply({ embeds: [embedService.success(t('admin.guild_config.module_set', { module: MODULE_LABELS[mod], state: enabled ? '🟢 ' + t('core.enabled') : '🔴 ' + t('core.disabled') }))], ...ephemeral });
        return;
      }
      case 'brand-color': {
        const hex = interaction.options.getString('hex', true).trim();
        if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) {
          await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: hex }))], ...ephemeral });
          return;
        }
        await guildConfigService.updateSettings(guildId, { brandColor: hex.startsWith('#') ? hex : `#${hex}` });
        await interaction.reply({ embeds: [embedService.success(t('admin.guild_config.color_set', { color: hex }))], ...ephemeral });
        return;
      }
      case 'translation-mode': {
        const mode = interaction.options.getString('mode', true) as 'CHANNELS' | 'PERMISSIONS';
        await guildConfigService.updateSettings(guildId, { translationMode: mode });
        await interaction.reply({ embeds: [embedService.success(t('admin.guild_config.translation_mode_set', { mode }))], ...ephemeral });
        return;
      }
      case 'language-channel': {
        const code = interaction.options.getString('code', true);
        const channel = interaction.options.getChannel('channel');
        const map = { ...config.languageChannels };
        if (channel) map[code] = channel.id;
        else delete map[code];
        await guildConfigService.updateSettings(guildId, { languageChannels: map });
        await interaction.reply({ embeds: [embedService.success(t('admin.guild_config.language_channel_set', { language: code, channel: channel ? `<#${channel.id}>` : t('core.none') }))], ...ephemeral });
        return;
      }
      case 'show':
      default: {
        const fresh = (await guildConfigService.get(guildId)) ?? config;
        const modules = MODULE_KEYS.map((k) => `${fresh.modules[k] ? '🟢' : '🔴'} ${MODULE_LABELS[k]}`).join('\n');
        const logs = Object.entries(fresh.logChannels)
          .map(([c, ch]) => `${LOG_CATEGORY_LABELS[c] ?? c} → <#${ch}>`)
          .join('\n');
        const langStats = await translationService.countByLanguage(guildId);
        const embed = embedService
          .brand(t('admin.guild_config.title', { server: interaction.guild.name }))
          .addFields(
            { name: t('admin.guild_config.kind'), value: GUILD_KIND_LABELS[fresh.kind], inline: true },
            { name: t('admin.guild_config.default_language'), value: fresh.defaultLanguage, inline: true },
            { name: t('admin.guild_config.enabled_languages'), value: fresh.enabledLanguages.join(', ') || '—', inline: true },
            { name: t('admin.guild_config.admin_roles'), value: fresh.adminRoleIds.map((r) => `<@&${r}>`).join(' ') || '—', inline: true },
            { name: t('admin.guild_config.staff_roles'), value: fresh.staffRoleIds.map((r) => `<@&${r}>`).join(' ') || '—', inline: true },
            { name: t('admin.guild_config.translation_mode'), value: fresh.translationMode, inline: true },
            { name: t('admin.guild_config.modules'), value: modules, inline: false },
            { name: t('admin.guild_config.logs'), value: logs || '—', inline: false },
            { name: t('admin.guild_config.language_stats'), value: Object.entries(langStats).map(([l, n]) => `${l}: ${n}`).join(' • ') || '—', inline: false },
          )
          .setFooter({ text: `${t('admin.guild_config.dashboard')}: ${env().DASHBOARD_URL}/guilds/${guildId}` });
        await interaction.reply({ embeds: [embed], ...ephemeral });
      }
    }
  },
});
