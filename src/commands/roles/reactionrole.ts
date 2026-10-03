import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { roleService, parseEmojiInput, displayEmoji } from '../../services/RoleService';
import { embedService } from '../../services/EmbedService';
import { canManageRole } from '../../utils/permissions';

const MESSAGE_LINK = /(?:https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/)?(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/;

/** Parse un lien de message Discord (ou `guildId/channelId/messageId`). */
export function parseMessageLink(input: string): { guildId: string; channelId: string; messageId: string } | null {
  const m = input.trim().match(MESSAGE_LINK);
  if (!m) return null;
  return { guildId: m[1]!, channelId: m[2]!, messageId: m[3]! };
}

/** /reactionrole — rôles par réaction : create <lien> <emoji> <rôle> · remove · list */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Rôles attribués par réaction')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Associer une réaction d’un message à un rôle')
        .addStringOption((o) => o.setName('message_link').setDescription('Lien du message').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji (unicode ou custom)').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Retirer une association')
        .addStringOption((o) => o.setName('message_link').setDescription('Lien du message').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Lister les reaction roles')),
  module: 'reactionrole',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.ManageRoles], bot: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory] },
  cooldown: 2,
  async execute(interaction, { t }) {
    if (!interaction.guild || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const guild = interaction.guild;

    if (sub === 'list') {
      const rows = await roleService.listReactionRoles(interaction.guildId);
      const lines = rows.map((r) => `${displayEmoji(r.emoji)} → <@&${r.roleId}> · [${t('roles.reactionrole.message')}](https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId})`);
      await interaction.reply({ embeds: [embedService.brand(t('roles.reactionrole.list_title'), lines.join('\n').slice(0, 4000) || t('roles.reactionrole.empty'))], ...ephemeral });
      return;
    }

    const link = parseMessageLink(interaction.options.getString('message_link', true));
    const emoji = parseEmojiInput(interaction.options.getString('emoji', true));
    if (!link || link.guildId !== interaction.guildId) {
      await interaction.reply({ embeds: [embedService.error(t('roles.reactionrole.invalid_link'))], ...ephemeral });
      return;
    }
    if (!emoji) {
      await interaction.reply({ embeds: [embedService.error(t('roles.reactionrole.invalid_emoji'))], ...ephemeral });
      return;
    }

    if (sub === 'remove') {
      const row = await roleService.removeReactionRole({ messageId: link.messageId, emoji });
      if (row) {
        const channel = await guild.channels.fetch(link.channelId).catch(() => null);
        if (channel?.isTextBased() && 'messages' in channel) {
          const message = await channel.messages.fetch(link.messageId).catch(() => null);
          await message?.reactions.cache.find((r) => (r.emoji.id ? emoji.endsWith(r.emoji.id) : r.emoji.name === emoji))?.users.remove(guild.members.me?.id).catch(() => null);
        }
      }
      await interaction.reply({ embeds: [row ? embedService.success(t('roles.reactionrole.removed', { emoji: displayEmoji(emoji), role: `<@&${row.roleId}>` })) : embedService.warning(t('core.not_found'))], ...ephemeral });
      return;
    }

    // create
    const role = interaction.options.getRole('role', true);
    if (!canManageRole(guild.members.me, role.id)) {
      await interaction.reply({ embeds: [embedService.error(t('core.role_hierarchy'))], ...ephemeral });
      return;
    }
    await interaction.deferReply(ephemeral);
    const channel = await guild.channels.fetch(link.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) {
      await interaction.editReply({ embeds: [embedService.error(t('core.channel_not_found'))] });
      return;
    }
    const message = await channel.messages.fetch(link.messageId).catch(() => null);
    if (!message) {
      await interaction.editReply({ embeds: [embedService.error(t('roles.reactionrole.message_not_found'))] });
      return;
    }
    try {
      await message.react(emoji);
    } catch {
      await interaction.editReply({ embeds: [embedService.error(t('roles.reactionrole.react_failed'))] });
      return;
    }
    await roleService.addReactionRole({ guildId: interaction.guildId, channelId: link.channelId, messageId: link.messageId, emoji, roleId: role.id });
    await interaction.editReply({ embeds: [embedService.success(t('roles.reactionrole.created', { emoji: displayEmoji(emoji), role: `<@&${role.id}>`, url: message.url }))] });
  },
});
