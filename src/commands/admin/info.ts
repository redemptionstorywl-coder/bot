import { ChannelType, MessageFlags, SlashCommandBuilder, type CategoryChannel, type GuildBasedChannel } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { paginate } from '../../utils/pagination';
import { GUILD_KIND_LABELS } from '../../config/constants';
import { discordTimestamp } from '../../utils/time';

const CHANNEL_ICONS: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: '#',
  [ChannelType.GuildVoice]: '🔊',
  [ChannelType.GuildAnnouncement]: '📢',
  [ChannelType.GuildForum]: '💬',
  [ChannelType.GuildStageVoice]: '🎙️',
  [ChannelType.GuildMedia]: '🖼️',
};

function channelLine(c: GuildBasedChannel): string {
  const icon = CHANNEL_ICONS[c.type] ?? '•';
  return `${icon} ${c.name} · \`${c.id}\``;
}

/**
 * /info — fiche complète du serveur : statistiques, catégories avec leurs salons, rôles (avec IDs).
 * Paginé : page 1 = résumé, pages suivantes = catégories/salons, puis rôles.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Informations du serveur : catégories, salons et rôles')
    .addBooleanOption((o) => o.setName('public').setDescription('Afficher pour tout le monde (défaut : seulement vous)')),
  permissions: { internal: 'staff' },
  cooldown: 10,
  async execute(interaction, { t, config }) {
    const guild = interaction.guild;
    if (!guild) return;
    const isPublic = interaction.options.getBoolean('public') ?? false;
    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
    await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
    const owner = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
    const brand = config?.brandColor;
    const pages = [];

    // Page 1 : résumé
    const counts = {
      text: channels.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).size,
      voice: channels.filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice).size,
      categories: channels.filter((c) => c.type === ChannelType.GuildCategory).size,
      forums: channels.filter((c) => c.type === ChannelType.GuildForum || c.type === ChannelType.GuildMedia).size,
    };
    const summary = embedService
      .brand(t('admin.info.title', { server: guild.name }))
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: t('admin.info.id'), value: `\`${guild.id}\``, inline: true },
        { name: t('admin.info.owner'), value: owner ? `<@${owner.id}>` : '—', inline: true },
        { name: t('admin.info.created'), value: discordTimestamp(guild.createdAt, 'D'), inline: true },
        { name: t('admin.info.members'), value: String(guild.memberCount), inline: true },
        { name: t('admin.info.boosts'), value: `${guild.premiumSubscriptionCount ?? 0} (${t('admin.info.tier', { tier: guild.premiumTier })})`, inline: true },
        { name: t('admin.info.kind'), value: config ? GUILD_KIND_LABELS[config.kind] : '—', inline: true },
        { name: t('admin.info.channels'), value: t('admin.info.channels_value', { text: counts.text, voice: counts.voice, forums: counts.forums, categories: counts.categories }), inline: false },
        { name: t('admin.info.roles'), value: String(roles.length), inline: true },
        { name: t('admin.info.emojis'), value: String(guild.emojis.cache.size), inline: true },
      );
    if (brand) summary.setColor(brand);
    pages.push(summary);

    // Pages catégories + salons (une page toutes les ~1800 caractères)
    const categories = [...channels.filter((c): c is CategoryChannel => c.type === ChannelType.GuildCategory).values()].sort((a, b) => a.position - b.position);
    const orphans = [...channels.filter((c) => c.type !== ChannelType.GuildCategory && !c.parentId && !c.isThread()).values()].sort((a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0));
    const blocks: string[] = [];
    if (orphans.length) blocks.push(`**${t('admin.info.no_category')}**\n${orphans.map(channelLine).join('\n')}`);
    for (const cat of categories) {
      const children = [...cat.children.cache.values()].sort((a, b) => a.position - b.position);
      blocks.push(`**📁 ${cat.name}** · \`${cat.id}\`\n${children.length ? children.map(channelLine).join('\n') : `*${t('core.none')}*`}`);
    }
    let buffer = '';
    const flushChannels = () => {
      if (!buffer) return;
      const e = embedService.brand(t('admin.info.channels_title'), buffer);
      if (brand) e.setColor(brand);
      pages.push(e);
      buffer = '';
    };
    for (const block of blocks) {
      const piece = block.length > 1900 ? block.slice(0, 1890) + '…' : block;
      if (buffer.length + piece.length + 2 > 1900) flushChannels();
      buffer += (buffer ? '\n\n' : '') + piece;
    }
    flushChannels();

    // Pages rôles
    const roleLines = roles.map((r) => `${r.managed ? '🤖' : r.permissions.has('Administrator') ? '👑' : '•'} <@&${r.id}> · \`${r.id}\` · ${r.members.size} ${t('admin.info.role_members')}`);
    for (let i = 0; i < roleLines.length; i += 30) {
      const e = embedService.brand(t('admin.info.roles_title', { from: i + 1, to: Math.min(i + 30, roleLines.length), total: roleLines.length }), roleLines.slice(i, i + 30).join('\n'));
      if (brand) e.setColor(brand);
      pages.push(e);
    }

    pages.forEach((e, i) => e.setFooter({ text: t('core.page', { current: i + 1, total: pages.length }) }));
    await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: !isPublic, timeMs: 300_000 });
  },
});
