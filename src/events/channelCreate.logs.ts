import { AuditLogEvent, ChannelType, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { moderationService } from '../services/ModerationService';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.ChannelCreate,
  async execute(_client, channel) {
    // Salons recréés par /clear serveur : pas de log par salon (rapport unique).
    if (moderationService.isNukingGuild(channel.guild.id)) return;
    const ctx = await logContext(channel.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const audit = await fetchAudit(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    await loggingService.log({
      guildId: channel.guild.id,
      category: 'CHANNEL',
      action: 'channel.create',
      title: t('logs.channel.created_title'),
      fields: [
        { name: t('core.channel'), value: `<#${channel.id}> • ${channel.name} (\`${channel.id}\`)`, inline: true },
        { name: t('logs.fields.type'), value: ChannelType[channel.type] ?? String(channel.type), inline: true },
        { name: t('logs.fields.category'), value: channel.parent ? channel.parent.name : t('core.none'), inline: true },
        { name: t('logs.fields.changed_by'), value: audit?.executor ? userLine(audit.executor) : t('logs.unknown'), inline: true },
      ],
      actorId: audit?.executor?.id ?? null,
      color: BRAND.colors.primary,
      data: { channelId: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId },
    });
  },
});
