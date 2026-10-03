import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { logContext, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(_client, oldState, newState) {
    if (oldState.channelId === newState.channelId) return; // mute / deaf / stream : ignoré
    const member = newState.member ?? oldState.member;
    if (!member) return;
    const ctx = await logContext(newState.guild.id);
    if (!ctx) return;
    const { t } = ctx;
    let action: 'voice.join' | 'voice.leave' | 'voice.move';
    let title: string;
    const fields = [{ name: t('core.user'), value: userLine(member.user), inline: true }];
    if (!oldState.channelId && newState.channelId) {
      action = 'voice.join';
      title = t('logs.voice.join_title');
      fields.push({ name: t('core.channel'), value: `<#${newState.channelId}>`, inline: true });
    } else if (oldState.channelId && !newState.channelId) {
      action = 'voice.leave';
      title = t('logs.voice.leave_title');
      fields.push({ name: t('core.channel'), value: `<#${oldState.channelId}>`, inline: true });
    } else {
      action = 'voice.move';
      title = t('logs.voice.move_title');
      fields.push({ name: t('logs.fields.before'), value: `<#${oldState.channelId}>`, inline: true }, { name: t('logs.fields.after'), value: `<#${newState.channelId}>`, inline: true });
    }
    await loggingService.log({
      guildId: newState.guild.id,
      category: 'VOICE',
      action,
      title,
      fields,
      actorId: member.id,
      targetId: member.id,
      color: action === 'voice.leave' ? BRAND.colors.anthracite : BRAND.colors.primary,
      skipDatabase: true,
    });
  },
});
