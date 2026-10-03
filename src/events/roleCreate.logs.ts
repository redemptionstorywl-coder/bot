import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { fetchAudit, joinOrNone, logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.GuildRoleCreate,
  async execute(_client, role) {
    const ctx = await logContext(role.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const audit = await fetchAudit(role.guild, AuditLogEvent.RoleCreate, role.id);
    await loggingService.log({
      guildId: role.guild.id,
      category: 'ROLE',
      action: 'role.create',
      title: t('logs.role.created_title'),
      fields: [
        { name: t('logs.fields.role'), value: `<@&${role.id}> • ${role.name} (\`${role.id}\`)`, inline: true },
        { name: t('logs.fields.color'), value: role.hexColor, inline: true },
        { name: t('logs.fields.changed_by'), value: audit?.executor ? userLine(audit.executor) : t('logs.unknown'), inline: true },
        { name: t('logs.fields.permissions'), value: joinOrNone(role.permissions.toArray(), t), inline: false },
      ],
      actorId: audit?.executor?.id ?? null,
      color: BRAND.colors.primary,
      data: { roleId: role.id, name: role.name, permissions: role.permissions.bitfield.toString() },
    });
  },
});
