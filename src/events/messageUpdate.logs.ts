import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { logContext, trunc, userLine } from './_logs.helpers';

export default defineEvent({
  name: Events.MessageUpdate,
  async execute(client, oldMessage, newMessage) {
    if (!newMessage.inGuild() || newMessage.author?.bot) return;
    if (newMessage.author?.id === client.user?.id) return;
    if (oldMessage.partial || newMessage.partial) return;
    if (oldMessage.content === newMessage.content) return; // embed chargé, épinglage…
    const ctx = await logContext(newMessage.guildId);
    if (!ctx) return;
    const { t } = ctx;
    await loggingService.log({
      guildId: newMessage.guildId,
      category: 'MESSAGE',
      action: 'message.edit',
      title: t('logs.message.edited_title'),
      description: `[${t('logs.message.jump')}](${newMessage.url})`,
      fields: [
        { name: t('logs.fields.author'), value: userLine(newMessage.author), inline: true },
        { name: t('core.channel'), value: `<#${newMessage.channelId}>`, inline: true },
        { name: t('logs.fields.before'), value: trunc(oldMessage.content) || t('logs.message.no_content'), inline: false },
        { name: t('logs.fields.after'), value: trunc(newMessage.content) || t('logs.message.no_content'), inline: false },
      ],
      actorId: newMessage.author.id,
      targetId: newMessage.author.id,
      color: BRAND.colors.warning,
      skipDatabase: true,
    });
  },
});
