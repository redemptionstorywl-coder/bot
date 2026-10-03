import { GuildMember, MessageFlags } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { roleService } from '../services/RoleService';
import { embedService } from '../services/EmbedService';

/** Select multi `notif:select` → synchronise les rôles de notification avec la sélection. */
export default defineSelectMenu({
  id: 'notif',
  module: 'notifications',
  cooldown: 2,
  async execute(interaction, args, ctx) {
    const [action] = args;
    const { t } = ctx;
    if (action !== 'select' || !interaction.isStringSelectMenu() || !interaction.inGuild()) {
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild!.members.fetch(interaction.user.id);
    const result = await roleService.applyNotificationSelection(member, interaction.values);
    const lines: string[] = [];
    if (result.added.length) lines.push(t('roles.common.roles_added', { roles: result.added.map((r) => `<@&${r}>`).join(' ') }));
    if (result.removed.length) lines.push(t('roles.common.roles_removed', { roles: result.removed.map((r) => `<@&${r}>`).join(' ') }));
    if (result.blocked.length) lines.push(t('roles.common.roles_blocked', { roles: result.blocked.map((r) => `<@&${r}>`).join(' ') }));
    if (!lines.length) lines.push(t('roles.common.no_change'));
    await interaction.editReply({ content: lines.join('\n') });
  },
});
