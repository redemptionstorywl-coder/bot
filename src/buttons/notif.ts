import { GuildMember, MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { roleService } from '../services/RoleService';
import { embedService } from '../services/EmbedService';

/** Bouton `notif:toggle:<key>` → ajoute / retire le rôle de notification. */
export default defineButton({
  id: 'notif',
  module: 'notifications',
  cooldown: 2,
  async execute(interaction, args, ctx) {
    const [action, key] = args;
    const { t } = ctx;
    if (action !== 'toggle' || !key || !interaction.inGuild()) {
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild!.members.fetch(interaction.user.id);
    const result = await roleService.toggleNotification(member, key);
    if (!result) {
      await interaction.editReply({ embeds: [embedService.error(t('roles.notif.unknown'))] });
      return;
    }
    const label = `${result.row.emoji ?? '🔔'} ${result.row.label}`;
    if (result.action === 'blocked') await interaction.editReply({ embeds: [embedService.error(t('core.role_hierarchy'))] });
    else if (result.action === 'added') await interaction.editReply({ content: t('roles.notif.subscribed', { label }) });
    else await interaction.editReply({ content: t('roles.notif.unsubscribed', { label }) });
  },
});
