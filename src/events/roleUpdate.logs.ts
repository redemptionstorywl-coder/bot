import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { fetchAudit, joinOrNone, logContext, permissionDiff, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.GuildRoleUpdate,
  async execute(_client, oldRole, newRole) {
    const changes: { name: string; value: string; inline?: boolean }[] = [];
    const ctx = await logContext(newRole.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    if (oldRole.name !== newRole.name) changes.push({ name: t('logs.fields.name'), value: `${oldRole.name} → ${newRole.name}`, inline: true });
    if (oldRole.hexColor !== newRole.hexColor) changes.push({ name: t('logs.fields.color'), value: `${oldRole.hexColor} → ${newRole.hexColor}`, inline: true });
    if (oldRole.hoist !== newRole.hoist) changes.push({ name: t('logs.role.hoist'), value: newRole.hoist ? t('core.yes') : t('core.no'), inline: true });
    if (oldRole.mentionable !== newRole.mentionable) changes.push({ name: t('logs.role.mentionable'), value: newRole.mentionable ? t('core.yes') : t('core.no'), inline: true });
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
      const diff = permissionDiff(oldRole.permissions, newRole.permissions);
      if (diff.added.length) changes.push({ name: t('logs.role.permissions_added'), value: joinOrNone(diff.added, t), inline: false });
      if (diff.removed.length) changes.push({ name: t('logs.role.permissions_removed'), value: joinOrNone(diff.removed, t), inline: false });
    }
    if (!changes.length) return; // position / icône : ignoré
    const audit = await fetchAudit(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await loggingService.log({
      guildId: newRole.guild.id,
      category: 'ROLE',
      action: 'role.update',
      title: t('logs.role.updated_title'),
      fields: [{ name: t('logs.fields.role'), value: `<@&${newRole.id}> (\`${newRole.id}\`)`, inline: true }, { name: t('logs.fields.changed_by'), value: audit?.executor ? userLine(audit.executor) : t('logs.unknown'), inline: true }, ...changes],
      actorId: audit?.executor?.id ?? null,
      color: BRAND.colors.warning,
      data: { roleId: newRole.id, changes: changes.map((c) => ({ field: c.name, value: c.value })) },
    });
  },
});
