import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { welcomeService } from '../../services/WelcomeService';
import { embedService } from '../../services/EmbedService';
import { isHttpUrl, languageChoices, onOff, openValueModal, summarizeLocalized } from './_welcomeShared';

/** /leave-config — message de départ : salon, texte / embed multilingues, image, logs, test, aperçu. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('leave-config')
    .setDescription('Configurer le message de départ')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('enable').setDescription('Activer / désactiver le message de départ').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('channel').setDescription('Salon des départs').addChannelOption((o) => o.setName('channel').setDescription('Salon').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('message').setDescription('Texte (modal) — {username} {displayName} {memberCount} {joinedAt}').addStringOption((o) => o.setName('language').setDescription('Version pour une langue précise').addChoices(...languageChoices)))
    .addSubcommand((s) => s.setName('embed-json').setDescription('Embed (JSON EmbedSpec, modal)').addStringOption((o) => o.setName('language').setDescription('Version pour une langue précise').addChoices(...languageChoices)))
    .addSubcommand((s) =>
      s
        .setName('image')
        .setDescription('Image de départ générée')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true))
        .addStringOption((o) => o.setName('background_url').setDescription('URL du fond (vide = fond sombre)')),
    )
    .addSubcommand((s) => s.setName('logs').setDescription('Journaliser les départs (catégorie MEMBER)').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('test').setDescription('Simuler votre départ'))
    .addSubcommand((s) => s.setName('show').setDescription('Afficher la configuration')),
  module: 'leave',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageGuild] },
  cooldown: 2,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const lang = interaction.options.getString('language');

    switch (sub) {
      case 'enable': {
        const enabled = interaction.options.getBoolean('enabled', true);
        await welcomeService.updateLeaveConfig(guildId, { enabled });
        await interaction.reply({ embeds: [embedService.success(t('welcome.leave.config.enabled_set', { state: onOff(enabled, t) }))], ...ephemeral });
        return;
      }
      case 'channel': {
        const channel = interaction.options.getChannel('channel', true);
        await welcomeService.updateLeaveConfig(guildId, { channelId: channel.id, enabled: true });
        await interaction.reply({ embeds: [embedService.success(t('welcome.leave.config.channel_set', { channel: `<#${channel.id}>` }))], ...ephemeral });
        return;
      }
      case 'message':
      case 'embed-json': {
        const current = await welcomeService.getLeaveConfig(guildId);
        const action = sub === 'message' ? 'message' : 'embed';
        await openValueModal(interaction, t, { action, target: 'leave', lang, current: current?.[action], fallbackLang: config.defaultLanguage });
        return;
      }
      case 'image': {
        const enabled = interaction.options.getBoolean('enabled', true);
        const background = interaction.options.getString('background_url');
        if (background && !isHttpUrl(background)) {
          await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: background }))], ...ephemeral });
          return;
        }
        await welcomeService.updateLeaveConfig(guildId, { imageEnabled: enabled, ...(background !== null ? { imageBackgroundUrl: background || null } : {}) });
        await interaction.reply({ embeds: [embedService.success(t('welcome.leave.config.image_set', { state: onOff(enabled, t) }))], ...ephemeral });
        return;
      }
      case 'logs': {
        const enabled = interaction.options.getBoolean('enabled', true);
        await welcomeService.updateLeaveConfig(guildId, { logEnabled: enabled });
        await interaction.reply({ embeds: [embedService.success(t('welcome.leave.config.logs_set', { state: onOff(enabled, t) }))], ...ephemeral });
        return;
      }
      case 'test': {
        await interaction.deferReply(ephemeral);
        const current = await welcomeService.getLeaveConfig(guildId);
        if (!current) {
          await interaction.editReply({ embeds: [embedService.warning(t('welcome.leave.config.not_configured'))] });
          return;
        }
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const payload = await welcomeService.buildLeave(member, current);
        const channel = current.channelId ? await interaction.guild.channels.fetch(current.channelId).catch(() => null) : null;
        if (channel?.isTextBased() && 'send' in channel) {
          await channel.send({ content: payload.content, embeds: payload.embeds, files: payload.files });
          await interaction.editReply({ embeds: [embedService.success(t('welcome.leave.config.test_sent', { channel: `<#${channel.id}>` }))] });
        } else {
          await interaction.editReply({ content: payload.content, embeds: payload.embeds, files: payload.files });
        }
        return;
      }
      case 'show':
      default: {
        const c = await welcomeService.getLeaveConfig(guildId);
        const embed = embedService.brand(t('welcome.leave.config.show_title', { server: interaction.guild.name }));
        if (!c) embed.setDescription(t('welcome.leave.config.not_configured'));
        else
          embed.addFields(
            { name: t('welcome.config.field_enabled'), value: onOff(c.enabled, t), inline: true },
            { name: t('core.channel'), value: c.channelId ? `<#${c.channelId}>` : '—', inline: true },
            { name: t('welcome.leave.config.field_logs'), value: onOff(c.logEnabled, t), inline: true },
            { name: t('welcome.config.kind_message'), value: summarizeLocalized(c.message, t), inline: true },
            { name: t('welcome.config.kind_embed'), value: summarizeLocalized(c.embed, t), inline: true },
            { name: t('welcome.config.field_image'), value: `${onOff(c.imageEnabled, t)}${c.imageBackgroundUrl ? `\n[${t('welcome.config.background')}](${c.imageBackgroundUrl})` : ''}`, inline: true },
          );
        embed.addFields({ name: t('welcome.config.variables'), value: '`{username}` `{displayName}` `{memberCount}` `{joinedAt}` `{server}` `{tag}`' });
        await interaction.reply({ embeds: [embed], ...ephemeral });
      }
    }
  },
});
