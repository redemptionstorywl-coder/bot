import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { moderationService } from '../services/ModerationService';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.GuildBanRemove,
  async execute(_client, ban) {
    const guild = ban.guild;
    if (moderationService.consumeRecent(guild.id, 'unban', ban.user.id)) return;
    const ctx = await logContext(guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const audit = await fetchAudit(guild, AuditLogEvent.MemberBanRemove, ban.user.id, 10_000);
    const executor = audit?.executor ?? null;
    await prisma.ban.updateMany({ where: { guildId: guild.id, userId: ban.user.id, active: true }, data: { active: false } }).catch(() => null);
    const sanction = executor && !executor.bot ? await moderationService.createSanction({ guildId: guild.id, type: 'UNBAN', userId: ban.user.id, moderatorId: executor.id, reason: audit?.reason ?? null, metadata: { source: 'audit' } }).catch(() => null) : null;
    await loggingService.log({
      guildId: guild.id,
      category: 'MODERATION',
      action: 'mod.unban',
      title: sanction ? t('moderation.case_title', { number: sanction.caseNumber, type: t('moderation.types.UNBAN') }) : t('logs.ban.removed_title'),
      fields: [
        { name: t('core.user'), value: userLine(ban.user), inline: true },
        { name: t('core.moderator'), value: executor ? userLine(executor) : t('logs.unknown'), inline: true },
        { name: t('core.reason'), value: audit?.reason ?? t('core.no_reason'), inline: false },
      ],
      actorId: executor?.id ?? null,
      targetId: ban.user.id,
      color: BRAND.colors.primary,
      thumbnail: ban.user.displayAvatarURL({ size: 128 }),
      data: { source: 'audit', caseNumber: sanction?.caseNumber ?? null },
    });
  },
});
