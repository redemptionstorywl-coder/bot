import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { PanelStyle } from '@prisma/client';
import { defineCommand } from '../../structures';
import { languageService } from '../../services/LanguageService';
import { embedService } from '../../services/EmbedService';

/** /language-panel — publier / mettre à jour / prévisualiser le panneau « 🌍 CHOOSE YOUR LANGUAGE ». */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('language-panel')
    .setDescription('Panneau de sélection de langue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('publish')
        .setDescription('Publier (ou déplacer) le panneau dans un salon')
        .addChannelOption((o) => o.setName('channel').setDescription('Salon').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName('style').setDescription('Style').addChoices({ name: 'Boutons drapeaux', value: 'BUTTONS' }, { name: 'Menu déroulant', value: 'SELECT' })),
    )
    .addSubcommand((s) =>
      s
        .setName('refresh')
        .setDescription('Mettre à jour le panneau déjà publié (langues activées, style)')
        .addStringOption((o) => o.setName('style').setDescription('Style').addChoices({ name: 'Boutons drapeaux', value: 'BUTTONS' }, { name: 'Menu déroulant', value: 'SELECT' })),
    )
    .addSubcommand((s) => s.setName('preview').setDescription('Aperçu éphémère du panneau')),
  module: 'language',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageGuild], bot: [PermissionFlagsBits.ManageRoles] },
  cooldown: 3,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const styleOpt = interaction.options.getString('style');
    const style = styleOpt === 'SELECT' ? PanelStyle.SELECT : styleOpt === 'BUTTONS' ? PanelStyle.BUTTONS : undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'publish') {
      const channel = interaction.options.getChannel('channel', true);
      const message = await languageService.publishPanel(interaction.guild, channel.id, style ?? PanelStyle.BUTTONS);
      await interaction.editReply({ embeds: [embedService.success(t('language.panel.published', { channel: `<#${channel.id}>`, url: message.url }))] });
      return;
    }
    if (sub === 'refresh') {
      const ok = await languageService.refreshPanel(interaction.guild, style);
      await interaction.editReply({ embeds: [ok ? embedService.success(t('language.panel.refreshed')) : embedService.warning(t('language.panel.not_published'))] });
      return;
    }
    const panel = languageService.buildPanel(config, config.defaultLanguage, style ?? PanelStyle.BUTTONS);
    await interaction.editReply({ content: t('language.panel.preview_note'), embeds: panel.embeds, components: panel.components });
  },
});
