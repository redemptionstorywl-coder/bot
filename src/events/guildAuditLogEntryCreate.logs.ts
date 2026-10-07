import { AuditLogEvent, Events, type GuildAuditLogsEntry } from 'discord.js';
import type { LogCategory } from '@prisma/client';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { logContext, trunc } from './_logs.helpers';

type AuditAction = 'webhook.create' | 'webhook.update' | 'webhook.delete' | 'emoji.create' | 'emoji.update' | 'emoji.delete' | 'integration.create' | 'integration.delete';

/** Entrées d'audit journalisées : webhooks, emojis (paramètres du serveur) et intégrations / applications (sécurité). */
export const AUDIT_LOG_ACTIONS: Partial<Record<AuditLogEvent, { action: AuditAction; category: LogCategory; color: number }>> = {
  [AuditLogEvent.WebhookCreate]: { action: 'webhook.create', category: 'SYSTEM', color: BRAND.colors.warning },
  [AuditLogEvent.WebhookUpdate]: { action: 'webhook.update', category: 'SYSTEM', color: BRAND.colors.primary },
  [AuditLogEvent.WebhookDelete]: { action: 'webhook.delete', category: 'SYSTEM', color: BRAND.colors.anthracite },
  [AuditLogEvent.EmojiCreate]: { action: 'emoji.create', category: 'SYSTEM', color: BRAND.colors.primary },
  [AuditLogEvent.EmojiUpdate]: { action: 'emoji.update', category: 'SYSTEM', color: BRAND.colors.primary },
  [AuditLogEvent.EmojiDelete]: { action: 'emoji.delete', category: 'SYSTEM', color: BRAND.colors.anthracite },
  [AuditLogEvent.IntegrationCreate]: { action: 'integration.create', category: 'SECURITY', color: BRAND.colors.danger },
  [AuditLogEvent.IntegrationDelete]: { action: 'integration.delete', category: 'SECURITY', color: BRAND.colors.warning },
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{15,22}$/.test(v)) return `<#${v}> (\`${v}\`)`;
  return trunc(typeof v === 'object' ? JSON.stringify(v) : String(v), 200);
};

/** Changements d'une entrée d'audit (`name : a → b`), limités aux clés lisibles. */
export function auditChanges(entry: Pick<GuildAuditLogsEntry, 'changes'>): string[] {
  return (entry.changes ?? [])
    .filter((c) => ['name', 'channel_id', 'type', 'avatar_hash', 'roles', 'account_id'].includes(c.key))
    .slice(0, 10)
    .map((c) => `\`${c.key}\` : ${show(c.old)} → ${show(c.new)}`);
}

export default defineEvent({
  name: Events.GuildAuditLogEntryCreate,
  async execute(_client, entry, guild) {
    const spec = AUDIT_LOG_ACTIONS[entry.action];
    if (!spec) return;
    const ctx = await logContext(guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const target = entry.target as { name?: string | null; id?: string } | null;
    const name = target?.name ?? (entry.changes ?? []).find((c) => c.key === 'name')?.new ?? null;
    const changes = auditChanges(entry);
    await loggingService.log({
      guildId: guild.id,
      category: spec.category,
      action: spec.action,
      title: t(`logs.audit.${spec.action}`),
      fields: [
        { name: t('logs.fields.name'), value: `${name ? trunc(String(name), 200) : '—'}${entry.targetId ? ` (\`${entry.targetId}\`)` : ''}`, inline: true },
        { name: t('logs.fields.changed_by'), value: entry.executorId ? `<@${entry.executorId}> (\`${entry.executorId}\`)` : t('logs.unknown'), inline: true },
        ...(entry.reason ? [{ name: t('core.reason'), value: trunc(entry.reason, 1024), inline: false }] : []),
        ...(changes.length ? [{ name: t('logs.audit.changes'), value: trunc(changes.join('\n'), 1024), inline: false }] : []),
      ],
      actorId: entry.executorId ?? null,
      color: spec.color,
      data: { targetId: entry.targetId, name, changes: (entry.changes ?? []).slice(0, 10).map((c) => ({ key: c.key, old: c.old ?? null, new: c.new ?? null })) },
    });
  },
});
