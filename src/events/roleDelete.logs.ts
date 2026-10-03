import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.GuildRoleDelete,
  async execute(_client, role) {
    const ctx = await logContext(role.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const audit = await fetchAudit(role.guild, AuditLogEvent.RoleDelete, role.id);
    await loggingService.log({
      guildId: role.guild.id,
      category: 'ROLE',
      action: 'role.delete',
      title: t('logs.role.deleted_title'),
      fields: [
        { name: t('logs.fields.role'), value: `${role.name} (\`${role.id}\`)`, inline: true },
        { name: t('logs.fields.members'), value: String(role.members.size), inline: true },
        { name: t('logs.fields.changed_by'), value: audit?.executor ? userLine(audit.executor) : t('logs.unknown'), inline: true },
      ],
      actorId: audit?.executor?.id ?? null,
      color: BRAND.colors.danger,
      data: { roleId: role.id, name: role.name },
    });
  },
});
