import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, trunc, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.MessageBulkDelete,
  async execute(_client, messages, channel) {
    const ctx = await logContext(channel.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const audit = await fetchAudit(channel.guild, AuditLogEvent.MessageBulkDelete, null, 5_000);
    const executor = audit?.executor ?? null;
    const authors = new Map<string, number>();
    for (const m of messages.values()) if (!m.partial && m.author) authors.set(m.author.id, (authors.get(m.author.id) ?? 0) + 1);
    const authorLines = [...authors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, n]) => `<@${id}> × ${n}`);
    const preview = messages
      .filter((m) => !m.partial && !!m.content)
      .first(5)
      .map((m) => `**${m.author?.username ?? '?'}** : ${trunc(m.content, 120)}`);
    const fields = [
      { name: t('core.channel'), value: `<#${channel.id}>`, inline: true },
      { name: t('logs.fields.count'), value: String(messages.size), inline: true },
    ];
    if (executor) fields.push({ name: t('core.moderator'), value: userLine(executor), inline: true });
    if (authorLines.length) fields.push({ name: t('logs.fields.authors'), value: trunc(authorLines.join('\n')), inline: false });
    if (preview.length) fields.push({ name: t('logs.fields.preview'), value: trunc(preview.join('\n')), inline: false });
    await loggingService.log({
      guildId: channel.guild.id,
      category: 'MESSAGE',
      action: 'message.bulk_delete',
      title: t('logs.message.bulk_title', { count: messages.size }),
      fields,
      actorId: executor?.id ?? null,
      color: BRAND.colors.danger,
      data: { channelId: channel.id, count: messages.size, authors: Object.fromEntries(authors) },
    });
  },
});
