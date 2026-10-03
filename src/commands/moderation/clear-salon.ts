import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { buildCustomId } from '../../utils/customId';
import { EPHEMERAL, MOD_PERMS } from './_shared';

/**
 * /clear-salon — supprime TOUS les messages du salon.
 * Discord ne permet pas de supprimer en masse les messages de plus de 14 jours : le salon est donc
 * recréé à l'identique (nom, sujet, permissions, position, mode lent, NSFW) puis l'ancien est supprimé.
 * Une confirmation par bouton est demandée (bouton `mod:nuke:<channelId>`).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('clear-salon')
    .setDescription('Supprimer tous les messages du salon (le salon est recréé à l’identique)')
    .addChannelOption((o) => o.setName('channel').setDescription('Salon à vider (défaut : salon actuel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  module: 'moderation',
  permissions: { ...MOD_PERMS.channels, internal: 'admin' },
  cooldown: 10,
  async execute(interaction, { t }) {
    if (!interaction.guild) return;
    const target = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!target || !('guild' in target) || (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement)) {
      await interaction.reply({ embeds: [embedService.error(t('core.channel_not_found'))], ...EPHEMERAL });
      return;
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId('mod', 'nuke', target.id)).setLabel(t('moderation.clear_channel.btn_confirm')).setStyle(ButtonStyle.Danger).setEmoji('🧨'),
      new ButtonBuilder().setCustomId(buildCustomId('mod', 'cancel')).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      embeds: [embedService.warning(t('moderation.clear_channel.confirm', { channel: `<#${target.id}>` }), t('moderation.clear_channel.title'))],
      components: [row],
      ...EPHEMERAL,
    });
  },
});
