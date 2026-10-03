import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { welcomeService } from '../../services/WelcomeService';
import { embedService } from '../../services/EmbedService';
import { TEMPLATE_VARIABLES } from '../../config/constants';
import { isHttpUrl, languageChoices, onOff, openValueModal, summarizeLocalized } from './_welcomeShared';

/**
 * /welcome-config — message de bienvenue : salon, texte / embed multilingues (modals), image générée,
 * DM, boutons, bouton « Choisir ma langue », test, aperçu de la configuration.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('welcome-config')
    .setDescription('Configurer le message de bienvenue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('enable').setDescription('Activer / désactiver la bienvenue').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('channel').setDescription('Salon de bienvenue').addChannelOption((o) => o.setName('channel').setDescription('Salon').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('message').setDescription('Texte du message (modal) — variables {user} {server} {memberCount}…').addStringOption((o) => o.setName('language').setDescription('Version pour une langue précise').addChoices(...languageChoices)))
    .addSubcommand((s) => s.setName('embed-json').setDescription('Embed du message (JSON EmbedSpec, modal)').addStringOption((o) => o.setName('language').setDescription('Version pour une langue précise').addChoices(...languageChoices)))
    .addSubcommand((s) =>
      s
        .setName('image')
        .setDescription('Image de bienvenue générée')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true))
        .addStringOption((o) => o.setName('background_url').setDescription('URL du fond (vide = fond sombre)'))
        .addStringOption((o) => o.setName('title').setDescription('Titre (ex. BIENVENUE)').setMaxLength(60))
        .addStringOption((o) => o.setName('subtitle').setDescription('Sous-titre (ex. {username} · membre #{memberCount})').setMaxLength(120)),
    )
    .addSubcommand((s) => s.setName('dm').setDescription('Activer / désactiver le DM de bienvenue').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('dm-message').setDescription('Texte du DM (modal)').addStringOption((o) => o.setName('language').setDescription('Version pour une langue précise').addChoices(...languageChoices)))
    .addSubcommand((s) => s.setName('dm-embed').setDescription('Embed du DM (JSON, modal)').addStringOption((o) => o.setName('language').setDescription('Version pour une langue précise').addChoices(...languageChoices)))
    .addSubcommand((s) => s.setName('buttons').setDescription('Boutons du message (JSON ButtonSpec[], modal)').addBooleanOption((o) => o.setName('clear').setDescription('Supprimer tous les boutons')))
    .addSubcommand((s) => s.setName('language-prompt').setDescription('Bouton « 🌍 Choisir ma langue » sur le message').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('test').setDescription('Simuler votre arrivée'))
    .addSubcommand((s) => s.setName('show').setDescription('Afficher la configuration')),
  module: 'welcome',
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
        await welcomeService.updateConfig(guildId, { enabled });
        await interaction.reply({ embeds: [embedService.success(t('welcome.config.enabled_set', { state: onOff(enabled, t) }))], ...ephemeral });
        return;
      }
      case 'channel': {
        const channel = interaction.options.getChannel('channel', true);
        await welcomeService.updateConfig(guildId, { channelId: channel.id, enabled: true });
        await interaction.reply({ embeds: [embedService.success(t('welcome.config.channel_set', { channel: `<#${channel.id}>` }))], ...ephemeral });
        return;
      }
      case 'message':
      case 'embed-json':
      case 'dm-message':
      case 'dm-embed': {
        const current = await welcomeService.getConfig(guildId);
        const target = sub.startsWith('dm') ? 'dm' : 'welcome';
        const action = sub.endsWith('message') ? 'message' : 'embed';
        const key = target === 'dm' ? (action === 'message' ? 'dmMessage' : 'dmEmbed') : action;
        await openValueModal(interaction, t, { action, target, lang, current: current?.[key], fallbackLang: config.defaultLanguage });
        return;
      }
      case 'buttons': {
        if (interaction.options.getBoolean('clear')) {
          await welcomeService.updateConfig(guildId, { buttons: [] });
          await interaction.reply({ embeds: [embedService.success(t('welcome.config.buttons_cleared'))], ...ephemeral });
          return;
        }
        const current = await welcomeService.getConfig(guildId);
        await openValueModal(interaction, t, { action: 'buttons', target: 'welcome', lang: null, current: Array.isArray(current?.buttons) && current.buttons.length ? current.buttons : undefined, fallbackLang: config.defaultLanguage });
        return;
      }
      case 'image': {
        const enabled = interaction.options.getBoolean('enabled', true);
        const background = interaction.options.getString('background_url');
        if (background && !isHttpUrl(background)) {
          await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: background }))], ...ephemeral });
          return;
        }
        const title = interaction.options.getString('title');
        const subtitle = interaction.options.getString('subtitle');
        await welcomeService.updateConfig(guildId, {
          imageEnabled: enabled,
          ...(background !== null ? { imageBackgroundUrl: background || null } : {}),
          ...(title ? { imageTitle: title } : {}),
          ...(subtitle ? { imageSubtitle: subtitle } : {}),
        });
        await interaction.reply({ embeds: [embedService.success(t('welcome.config.image_set', { state: onOff(enabled, t) }))], ...ephemeral });
        return;
      }
      case 'dm': {
        const enabled = interaction.options.getBoolean('enabled', true);
        await welcomeService.updateConfig(guildId, { dmEnabled: enabled });
        await interaction.reply({ embeds: [embedService.success(t('welcome.config.dm_set', { state: onOff(enabled, t) }))], ...ephemeral });
        return;
      }
      case 'language-prompt': {
        const enabled = interaction.options.getBoolean('enabled', true);
        await welcomeService.updateConfig(guildId, { languagePromptEnabled: enabled });
        await interaction.reply({ embeds: [embedService.success(t('welcome.config.language_prompt_set', { state: onOff(enabled, t) }))], ...ephemeral });
        return;
      }
      case 'test': {
        await interaction.deferReply(ephemeral);
        const current = await welcomeService.getConfig(guildId);
        if (!current) {
          await interaction.editReply({ embeds: [embedService.warning(t('welcome.config.not_configured'))] });
          return;
        }
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const payload = await welcomeService.buildWelcome(member, current);
        const channel = current.channelId ? await interaction.guild.channels.fetch(current.channelId).catch(() => null) : null;
        if (channel?.isTextBased() && 'send' in channel) {
          await channel.send({ content: payload.content, embeds: payload.embeds, files: payload.files, components: payload.components });
          await interaction.editReply({ embeds: [embedService.success(t('welcome.config.test_sent', { channel: `<#${channel.id}>` }))] });
        } else {
          await interaction.editReply({ content: payload.content, embeds: payload.embeds, files: payload.files, components: payload.components });
        }
        return;
      }
      case 'show':
      default: {
        const c = await welcomeService.getConfig(guildId);
        const embed = embedService.brand(t('welcome.config.show_title', { server: interaction.guild.name }));
        if (!c) {
          embed.setDescription(t('welcome.config.not_configured'));
        } else {
          const buttons = Array.isArray(c.buttons) ? c.buttons.length : 0;
          embed.addFields(
            { name: t('welcome.config.field_enabled'), value: onOff(c.enabled, t), inline: true },
            { name: t('core.channel'), value: c.channelId ? `<#${c.channelId}>` : '—', inline: true },
            { name: t('welcome.config.field_language_prompt'), value: onOff(c.languagePromptEnabled, t), inline: true },
            { name: t('welcome.config.kind_message'), value: summarizeLocalized(c.message, t), inline: true },
            { name: t('welcome.config.kind_embed'), value: summarizeLocalized(c.embed, t), inline: true },
            { name: t('welcome.config.field_buttons'), value: String(buttons), inline: true },
            { name: t('welcome.config.field_image'), value: `${onOff(c.imageEnabled, t)}\n**${c.imageTitle}** — ${c.imageSubtitle}${c.imageBackgroundUrl ? `\n[${t('welcome.config.background')}](${c.imageBackgroundUrl})` : ''}`, inline: false },
            { name: t('welcome.config.field_dm'), value: `${onOff(c.dmEnabled, t)} · ${t('welcome.config.kind_message')} : ${summarizeLocalized(c.dmMessage, t)} · ${t('welcome.config.kind_embed')} : ${summarizeLocalized(c.dmEmbed, t)}`, inline: false },
          );
        }
        embed.addFields({ name: t('welcome.config.variables'), value: Object.keys(TEMPLATE_VARIABLES).map((v) => `\`${v}\``).join(' ') });
        await interaction.reply({ embeds: [embed], ...ephemeral });
      }
    }
  },
});
