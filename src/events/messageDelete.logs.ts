import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, trunc, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.MessageDelete,
  async execute(client, message) {
    if (!message.inGuild()) return;
    if (message.author?.id === client.user?.id) return;
    const ctx = await logContext(message.guildId);
    if (!ctx) return;
    const { t } = ctx;
    const author = message.partial ? null : message.author;
    const audit = await fetchAudit(message.guild, AuditLogEvent.MessageDelete, author?.id ?? null, 5_000);
    const extra = audit?.entry.extra as { channel?: { id: string } } | undefined;
    const deleter = audit && extra?.channel?.id === message.channelId ? audit.executor : null;
    const attachments = message.attachments.map((a) => `[${a.name}](${a.url})`);
    const fields = [
      { name: t('logs.fields.author'), value: author ? userLine(author) : t('logs.message.unknown_author'), inline: true },
      { name: t('core.channel'), value: `<#${message.channelId}>`, inline: true },
    ];
    if (deleter && deleter.id !== author?.id) fields.push({ name: t('logs.message.deleted_by'), value: userLine(deleter), inline: true });
    fields.push({ name: t('logs.fields.content'), value: message.partial ? t('logs.message.content_unavailable') : trunc(message.content) || t('logs.message.no_content'), inline: false });
    if (attachments.length) fields.push({ name: t('logs.fields.attachments', { count: attachments.length }), value: trunc(attachments.join('\n')), inline: false });
    if (!message.partial && message.embeds.length) fields.push({ name: t('logs.fields.embeds'), value: String(message.embeds.length), inline: true });
    await loggingService.log({
      guildId: message.guildId,
      category: 'MESSAGE',
      action: 'message.delete',
      title: t('logs.message.deleted_title'),
      fields,
      actorId: deleter?.id ?? author?.id ?? null,
      targetId: author?.id ?? null,
      color: BRAND.colors.danger,
      data: { messageId: message.id, channelId: message.channelId, content: message.partial ? null : trunc(message.content, 1500), attachments: message.attachments.map((a) => a.url), deletedBy: deleter?.id ?? null },
    });
  },
});
