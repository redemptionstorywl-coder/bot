import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { discordTimestamp } from '../utils/time';
import { logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.InviteCreate,
  async execute(_client, invite) {
    if (!invite.guild) return;
    const ctx = await logContext(invite.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    await loggingService.log({
      guildId: invite.guild.id,
      category: 'CHANNEL',
      action: 'invite.create',
      title: t('logs.invite.created_title'),
      fields: [
        { name: t('logs.invite.code'), value: `[${invite.code}](${invite.url})`, inline: true },
        { name: t('logs.invite.inviter'), value: invite.inviter ? userLine(invite.inviter) : t('logs.unknown'), inline: true },
        { name: t('core.channel'), value: invite.channelId ? `<#${invite.channelId}>` : t('core.none'), inline: true },
        { name: t('logs.invite.max_uses'), value: invite.maxUses ? String(invite.maxUses) : '∞', inline: true },
        { name: t('logs.invite.expires'), value: invite.expiresAt ? discordTimestamp(invite.expiresAt, 'R') : t('logs.invite.never'), inline: true },
        { name: t('logs.invite.temporary'), value: invite.temporary ? t('core.yes') : t('core.no'), inline: true },
      ],
      actorId: invite.inviterId ?? null,
      color: BRAND.colors.primary,
      data: { code: invite.code, channelId: invite.channelId, maxUses: invite.maxUses, maxAge: invite.maxAge, temporary: invite.temporary },
    });
  },
});
