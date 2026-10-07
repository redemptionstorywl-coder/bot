import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, userLine } from './_logs.helpers';

/** Invitation supprimée (révoquée ou expirée) — route hub : member.invites. */
export default defineEvent({
  name: Events.InviteDelete,
  async execute(_client, invite) {
    if (!invite.guild) return;
    const ctx = await logContext(invite.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const guild = 'members' in invite.guild ? invite.guild : null;
    const audit = guild ? await fetchAudit(guild, AuditLogEvent.InviteDelete) : null;
    await loggingService.log({
      guildId: invite.guild.id,
      category: 'CHANNEL',
      action: 'invite.delete',
      title: t('logs.invite.deleted_title'),
      fields: [
        { name: t('logs.invite.code'), value: `\`${invite.code}\``, inline: true },
        { name: t('core.channel'), value: invite.channelId ? `<#${invite.channelId}>` : t('core.none'), inline: true },
        { name: t('logs.fields.changed_by'), value: audit?.executor ? userLine(audit.executor) : t('logs.invite.expired_or_unknown'), inline: true },
      ],
      actorId: audit?.executor?.id ?? null,
      color: BRAND.colors.anthracite,
      data: { code: invite.code, channelId: invite.channelId },
    });
  },
});
