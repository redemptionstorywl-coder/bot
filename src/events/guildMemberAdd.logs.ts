import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { discordTimestamp } from '../utils/time';
import { logContext, userLine } from './_logs.helpers';

const RECENT_ACCOUNT_MS = 7 * 86400_000;

export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(_client, member) {
    const ctx = await logContext(member.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    const age = Date.now() - member.user.createdTimestamp;
    const recent = age < RECENT_ACCOUNT_MS;
    await loggingService.log({
      guildId: member.guild.id,
      category: 'MEMBER',
      action: member.user.bot ? 'member.join_bot' : 'member.join',
      title: t(member.user.bot ? 'logs.member.join_bot_title' : 'logs.member.join_title'),
      fields: [
        { name: t('core.user'), value: userLine(member.user), inline: true },
        { name: t('logs.member.account_created'), value: `${discordTimestamp(member.user.createdAt, 'D')} (${discordTimestamp(member.user.createdAt, 'R')})${recent ? ` ⚠️ ${t('logs.member.recent_account')}` : ''}`, inline: true },
        { name: t('logs.member.member_count'), value: String(member.guild.memberCount), inline: true },
      ],
      targetId: member.id,
      color: recent ? BRAND.colors.warning : BRAND.colors.primary,
      thumbnail: member.user.displayAvatarURL({ size: 128 }),
      data: { bot: member.user.bot, createdAt: member.user.createdAt.toISOString(), memberCount: member.guild.memberCount },
    });
  },
});
