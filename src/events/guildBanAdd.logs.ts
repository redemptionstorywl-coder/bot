import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { moderationService } from '../services/ModerationService';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.GuildBanAdd,
  async execute(_client, ban) {
    const guild = ban.guild;
    // Ban fait via le bot : la case est déjà créée et loggée.
    if (moderationService.consumeRecent(guild.id, 'ban', ban.user.id)) return;
    const ctx = await logContext(guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const audit = await fetchAudit(guild, AuditLogEvent.MemberBanAdd, ban.user.id, 10_000);
    const executor = audit?.executor ?? null;
    const reason = audit?.reason ?? ban.reason ?? null;
    let sanction = null;
    if (executor && !executor.bot) {
      sanction = await moderationService.createSanction({ guildId: guild.id, type: 'BAN', userId: ban.user.id, moderatorId: executor.id, reason, metadata: { source: 'audit' } }).catch(() => null);
      await prisma.ban.updateMany({ where: { guildId: guild.id, userId: ban.user.id, active: true }, data: { active: false } }).catch(() => null);
      await prisma.ban.create({ data: { guildId: guild.id, userId: ban.user.id, moderatorId: executor.id, reason } }).catch(() => null);
    }
    await loggingService.log({
      guildId: guild.id,
      category: 'MODERATION',
      action: 'mod.ban',
      title: sanction ? t('moderation.case_title', { number: sanction.caseNumber, type: t('moderation.types.BAN') }) : t('logs.ban.added_title'),
      fields: [
        { name: t('core.user'), value: userLine(ban.user), inline: true },
        { name: t('core.moderator'), value: executor ? userLine(executor) : t('logs.unknown'), inline: true },
        { name: t('core.reason'), value: reason ?? t('core.no_reason'), inline: false },
      ],
      actorId: executor?.id ?? null,
      targetId: ban.user.id,
      color: BRAND.colors.danger,
      thumbnail: ban.user.displayAvatarURL({ size: 128 }),
      data: { source: 'audit', reason, caseNumber: sanction?.caseNumber ?? null },
    });
  },
});
