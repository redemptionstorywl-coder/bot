import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { moderationService } from '../services/ModerationService';
import { BRAND } from '../config/constants';
import { discordTimestamp } from '../utils/time';
import { fetchAudit, logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(_client, oldMember, newMember) {
    if (oldMember.partial) return;
    const guild = newMember.guild;
    const ctx = await logContext(guild.id);
    if (!ctx) return;
    const { t } = ctx;

    // Pseudo
    if (oldMember.nickname !== newMember.nickname) {
      const audit = await fetchAudit(guild, AuditLogEvent.MemberUpdate, newMember.id, 5_000);
      const executor = audit?.executor ?? null;
      await loggingService.log({
        guildId: guild.id,
        category: 'MEMBER',
        action: 'member.nickname',
        title: t('logs.member.nickname_title'),
        fields: [
          { name: t('core.user'), value: userLine(newMember.user), inline: true },
          { name: t('logs.fields.before'), value: oldMember.nickname ?? t('core.none'), inline: true },
          { name: t('logs.fields.after'), value: newMember.nickname ?? t('core.none'), inline: true },
          ...(executor && executor.id !== newMember.id ? [{ name: t('logs.fields.changed_by'), value: userLine(executor), inline: true }] : []),
        ],
        actorId: executor?.id ?? newMember.id,
        targetId: newMember.id,
        color: BRAND.colors.anthracite,
        data: { before: oldMember.nickname, after: newMember.nickname },
      });
    }

    // Rôles
    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
    if (added.size || removed.size) {
      const viaBot = moderationService.consumeRecent(guild.id, 'roles', newMember.id);
      const audit = viaBot ? null : await fetchAudit(guild, AuditLogEvent.MemberRoleUpdate, newMember.id, 5_000);
      const executor = audit?.executor ?? null;
      const fields = [{ name: t('core.user'), value: userLine(newMember.user), inline: true }];
      if (added.size) fields.push({ name: t('logs.member.roles_added'), value: added.map((r) => `<@&${r.id}>`).join(' '), inline: true });
      if (removed.size) fields.push({ name: t('logs.member.roles_removed'), value: removed.map((r) => `<@&${r.id}>`).join(' '), inline: true });
      if (executor) fields.push({ name: t('logs.fields.changed_by'), value: userLine(executor), inline: true });
      await loggingService.log({
        guildId: guild.id,
        category: 'MEMBER',
        action: 'member.roles',
        title: t('logs.member.roles_title'),
        fields,
        actorId: executor?.id ?? null,
        targetId: newMember.id,
        color: BRAND.colors.primary,
        data: { added: added.map((r) => r.id), removed: removed.map((r) => r.id), executor: executor?.id ?? null },
      });
    }

    // Timeout (hors bot : le service a déjà loggé la case)
    const oldUntil = oldMember.communicationDisabledUntilTimestamp ?? null;
    const newUntil = newMember.communicationDisabledUntilTimestamp ?? null;
    const wasTimedOut = !!oldUntil && oldUntil > Date.now();
    const isTimedOut = !!newUntil && newUntil > Date.now();
    if (wasTimedOut !== isTimedOut || (isTimedOut && oldUntil !== newUntil)) {
      if (moderationService.consumeRecent(guild.id, 'timeout', newMember.id)) return;
      const audit = await fetchAudit(guild, AuditLogEvent.MemberUpdate, newMember.id, 5_000);
      const executor = audit?.executor ?? null;
      const type = isTimedOut ? 'TIMEOUT' : 'UNTIMEOUT';
      const duration = isTimedOut && newUntil ? Math.max(0, Math.round((newUntil - Date.now()) / 1000)) : null;
      const sanction = executor && !executor.bot ? await moderationService.createSanction({ guildId: guild.id, type, userId: newMember.id, moderatorId: executor.id, reason: audit?.reason ?? null, duration, metadata: { source: 'audit', expiresAt: newUntil ? new Date(newUntil).toISOString() : null } }).catch(() => null) : null;
      const fields = [
        { name: t('core.user'), value: userLine(newMember.user), inline: true },
        { name: t('core.moderator'), value: executor ? userLine(executor) : t('logs.unknown'), inline: true },
      ];
      if (isTimedOut && newUntil) fields.push({ name: t('moderation.expires'), value: discordTimestamp(newUntil, 'R'), inline: true });
      fields.push({ name: t('core.reason'), value: audit?.reason ?? t('core.no_reason'), inline: false });
      await loggingService.log({
        guildId: guild.id,
        category: 'MODERATION',
        action: `mod.${type.toLowerCase()}`,
        title: sanction ? t('moderation.case_title', { number: sanction.caseNumber, type: t(`moderation.types.${type}`) }) : t(isTimedOut ? 'logs.member.timeout_title' : 'logs.member.untimeout_title'),
        fields,
        actorId: executor?.id ?? null,
        targetId: newMember.id,
        color: isTimedOut ? BRAND.colors.danger : BRAND.colors.primary,
        thumbnail: newMember.user.displayAvatarURL({ size: 128 }),
        data: { source: 'audit', until: newUntil, caseNumber: sanction?.caseNumber ?? null },
      });
    }
  },
});
