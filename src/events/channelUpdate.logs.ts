import { AuditLogEvent, Events, type GuildChannel, type PermissionOverwrites } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { formatDuration } from '../utils/time';
import { fetchAudit, logContext, trunc, userLine, type LogCtx } from './_logs.helpers';

function overwriteLabel(ow: PermissionOverwrites): string {
  return ow.type === 0 ? `<@&${ow.id}>` : `<@${ow.id}>`;
}

/** Diff des permission overwrites : cibles ajoutées / retirées / modifiées. */
function overwriteDiff(oldC: GuildChannel, newC: GuildChannel, ctx: LogCtx): string[] {
  const { t } = ctx;
  const out: string[] = [];
  for (const ow of newC.permissionOverwrites.cache.values()) {
    const prev = oldC.permissionOverwrites.cache.get(ow.id);
    if (!prev) out.push(t('logs.channel.overwrite_added', { target: overwriteLabel(ow) }));
    else if (prev.allow.bitfield !== ow.allow.bitfield || prev.deny.bitfield !== ow.deny.bitfield) {
      const allowAdded = ow.allow.toArray().filter((p) => !prev.allow.has(p));
      const denyAdded = ow.deny.toArray().filter((p) => !prev.deny.has(p));
      const reset = [...prev.allow.toArray().filter((p) => !ow.allow.has(p) && !ow.deny.has(p)), ...prev.deny.toArray().filter((p) => !ow.allow.has(p) && !ow.deny.has(p))];
      const parts: string[] = [];
      if (allowAdded.length) parts.push(`✅ ${allowAdded.join(', ')}`);
      if (denyAdded.length) parts.push(`⛔ ${denyAdded.join(', ')}`);
      if (reset.length) parts.push(`➖ ${reset.join(', ')}`);
      out.push(t('logs.channel.overwrite_changed', { target: overwriteLabel(ow), changes: parts.join(' • ') }));
    }
  }
  for (const prev of oldC.permissionOverwrites.cache.values()) if (!newC.permissionOverwrites.cache.has(prev.id)) out.push(t('logs.channel.overwrite_removed', { target: overwriteLabel(prev) }));
  return out;
}

export default defineEvent({
  name: Events.ChannelUpdate,
  async execute(_client, oldChannel, newChannel) {
    if (oldChannel.isDMBased() || newChannel.isDMBased()) return;
    const ctx = await logContext(newChannel.guild.id);
    if (!ctx) return;
    const { t, lang } = ctx;
    const changes: { name: string; value: string; inline?: boolean }[] = [];
    if (oldChannel.name !== newChannel.name) changes.push({ name: t('logs.fields.name'), value: `${oldChannel.name} → ${newChannel.name}`, inline: true });
    if (oldChannel.parentId !== newChannel.parentId) changes.push({ name: t('logs.fields.category'), value: `${oldChannel.parent?.name ?? t('core.none')} → ${newChannel.parent?.name ?? t('core.none')}`, inline: true });
    if ('topic' in oldChannel && 'topic' in newChannel && oldChannel.topic !== newChannel.topic) changes.push({ name: t('logs.channel.topic'), value: `${trunc(oldChannel.topic, 400) || t('core.none')} → ${trunc(newChannel.topic, 400) || t('core.none')}`, inline: false });
    if ('nsfw' in oldChannel && 'nsfw' in newChannel && oldChannel.nsfw !== newChannel.nsfw) changes.push({ name: 'NSFW', value: newChannel.nsfw ? t('core.yes') : t('core.no'), inline: true });
    if ('rateLimitPerUser' in oldChannel && 'rateLimitPerUser' in newChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) changes.push({ name: t('logs.channel.slowmode'), value: `${formatDuration(oldChannel.rateLimitPerUser ?? 0, lang)} → ${formatDuration(newChannel.rateLimitPerUser ?? 0, lang)}`, inline: true });
    if ('bitrate' in oldChannel && 'bitrate' in newChannel && oldChannel.bitrate !== newChannel.bitrate) changes.push({ name: t('logs.channel.bitrate'), value: `${oldChannel.bitrate / 1000} → ${newChannel.bitrate / 1000} kbps`, inline: true });
    if ('userLimit' in oldChannel && 'userLimit' in newChannel && oldChannel.userLimit !== newChannel.userLimit) changes.push({ name: t('logs.channel.user_limit'), value: `${oldChannel.userLimit} → ${newChannel.userLimit}`, inline: true });
    const ow = overwriteDiff(oldChannel, newChannel, ctx);
    if (ow.length) changes.push({ name: t('logs.channel.overwrites'), value: trunc(ow.join('\n')), inline: false });
    if (!changes.length) return; // position uniquement
    const audit = (await fetchAudit(newChannel.guild, ow.length ? AuditLogEvent.ChannelOverwriteUpdate : AuditLogEvent.ChannelUpdate, newChannel.id)) ?? (await fetchAudit(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id));
    await loggingService.log({
      guildId: newChannel.guild.id,
      category: 'CHANNEL',
      action: 'channel.update',
      title: t('logs.channel.updated_title'),
      fields: [{ name: t('core.channel'), value: `<#${newChannel.id}> (\`${newChannel.id}\`)`, inline: true }, { name: t('logs.fields.changed_by'), value: audit?.executor ? userLine(audit.executor) : t('logs.unknown'), inline: true }, ...changes],
      actorId: audit?.executor?.id ?? null,
      color: BRAND.colors.warning,
      skipDatabase: ow.length > 0 && changes.length === 1,
      data: { channelId: newChannel.id, changes: changes.map((c) => ({ field: c.name, value: c.value })) },
    });
  },
});
