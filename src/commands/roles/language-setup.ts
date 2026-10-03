import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PanelStyle } from '@prisma/client';
import { defineCommand } from '../../structures';
import { languageService } from '../../services/LanguageService';
import { embedService } from '../../services/EmbedService';
import { welcomeService } from '../../services/WelcomeService';
import { getLanguage } from '../../config/constants';

/**
 * /language-setup — installe tout le système de langue en une commande :
 * rôles de langue (créés s'ils manquent), salon de choix de langue (créé s'il manque), panneau publié.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('language-setup')
    .setDescription('Installer le système de langue : rôles, salon de choix et panneau')
    .addChannelOption((o) => o.setName('channel').setDescription('Salon existant à utiliser (sinon un salon 🌍・langues est créé)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName('style').setDescription('Style du panneau').addChoices({ name: 'Boutons drapeaux', value: 'BUTTONS' }, { name: 'Menu déroulant', value: 'SELECT' }))
    .addBooleanOption((o) => o.setName('announcements').setDescription('Créer un salon d’annonces par langue, visible seulement par son rôle (défaut : oui)'))
    .addStringOption((o) => o.setName('channel_name').setDescription('Nom du salon à créer (défaut : 🌍・langues)').setMaxLength(100)),
  module: 'language',
  permissions: { internal: 'admin' },
  cooldown: 10,
  async execute(interaction, { t }) {
    if (!interaction.guild) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const me = await interaction.guild.members.fetchMe();
    if (!me.permissions.has(['ManageRoles', 'ManageChannels'])) {
      await interaction.editReply({ embeds: [embedService.error(t('core.bot_missing_permissions', { permissions: 'ManageRoles, ManageChannels' }))] });
      return;
    }
    try {
      const style = interaction.options.getString('style') === 'SELECT' ? PanelStyle.SELECT : PanelStyle.BUTTONS;
      const result = await languageService.setup(interaction.guild, {
        channelId: interaction.options.getChannel('channel')?.id,
        channelName: interaction.options.getString('channel_name') ?? undefined,
        style,
        announcements: interaction.options.getBoolean('announcements') ?? true,
      });
      welcomeService.invalidate(interaction.guild.id);
      const fmt = (codes: string[]) => codes.map((c) => `${getLanguage(c)?.flag ?? ''} ${getLanguage(c)?.nativeLabel ?? c}`).join(', ') || t('core.none');
      const embed = embedService
        .success(t('language.setup.done', { channel: `<#${result.channelId}>`, url: result.message.url }), t('language.setup.title'))
        .addFields(
          { name: t('language.setup.created_roles'), value: fmt(result.createdRoles) },
          { name: t('language.setup.reused_roles'), value: fmt(result.reusedRoles) },
          { name: t('language.setup.channel'), value: result.channelCreated ? t('language.setup.channel_created', { channel: `<#${result.channelId}>` }) : t('language.setup.channel_reused', { channel: `<#${result.channelId}>` }) },
          { name: t('language.setup.announcements'), value: interaction.options.getBoolean('announcements') === false ? t('core.disabled') : t('language.setup.announcements_value', { created: fmt(result.announcementChannels.created), reused: fmt(result.announcementChannels.reused) }) },
        )
        .setFooter({ text: t('language.setup.footer') });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const code = (err as { code?: number }).code;
      await interaction.editReply({ embeds: [embedService.error(code === 50013 ? t('core.role_hierarchy') : t('core.error'))] });
      throw err;
    }
  },
});
