import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { moderationService } from '../services/ModerationService';
import { BRAND } from '../config/constants';
import { discordTimestamp, formatDuration } from '../utils/time';
import { fetchAudit, joinOrNone, logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(client, member) {
    if (member.id === client.user?.id) return;
    const ctx = await logContext(member.guild.id);
    if (!ctx) return;
    const { t, lang } = ctx;
    const guild = member.guild;

    // Ban → géré par guildBanAdd.logs (évite un faux "départ").
    const ban = await fetchAudit(guild, AuditLogEvent.MemberBanAdd, member.id, 5_000);
    if (ban) return;

    const kick = await fetchAudit(guild, AuditLogEvent.MemberKick, member.id, 5_000);
    const roles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`);
    const joinedAt = member.joinedAt;
    const presence = joinedAt ? formatDuration(Math.floor((Date.now() - joinedAt.getTime()) / 1000), lang) : '—';

    if (kick) {
      // Kick fait via le bot : déjà loggé par ModerationService.
      if (moderationService.consumeRecent(guild.id, 'kick', member.id)) return;
      const executor = kick.executor;
      const sanction = executor ? await moderationService.createSanction({ guildId: guild.id, type: 'KICK', userId: member.id, moderatorId: executor.id, reason: kick.reason, metadata: { source: 'audit' } }).catch(() => null) : null;
      await loggingService.log({
        guildId: guild.id,
        category: 'MODERATION',
        action: 'mod.kick',
        title: sanction ? t('moderation.case_title', { number: sanction.caseNumber, type: t('moderation.types.KICK') }) : t('logs.member.kicked_title'),
        fields: [
          { name: t('core.user'), value: userLine(member.user), inline: true },
          { name: t('core.moderator'), value: executor ? userLine(executor) : t('logs.unknown'), inline: true },
          { name: t('core.reason'), value: kick.reason ?? t('core.no_reason'), inline: false },
        ],
        actorId: executor?.id ?? null,
        targetId: member.id,
        color: BRAND.colors.danger,
        thumbnail: member.user.displayAvatarURL({ size: 128 }),
        data: { source: 'audit', reason: kick.reason, caseNumber: sanction?.caseNumber ?? null },
      });
      return;
    }

    await loggingService.log({
      guildId: guild.id,
      category: 'MEMBER',
      action: 'member.leave',
      title: t('logs.member.leave_title'),
      fields: [
        { name: t('core.user'), value: userLine(member.user), inline: true },
        { name: t('logs.member.joined_at'), value: joinedAt ? `${discordTimestamp(joinedAt, 'D')} (${presence})` : '—', inline: true },
        { name: t('logs.member.member_count'), value: String(guild.memberCount), inline: true },
        { name: t('logs.fields.roles'), value: joinOrNone(roles, t, ' '), inline: false },
      ],
      targetId: member.id,
      color: BRAND.colors.anthracite,
      thumbnail: member.user.displayAvatarURL({ size: 128 }),
      data: { joinedAt: joinedAt?.toISOString() ?? null, roles: member.roles.cache.map((r) => r.id), memberCount: guild.memberCount },
    });
  },
});
