import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { BRAND } from '../config/constants';
import { guildConfigService } from '../services/GuildConfigService';
import { logHubService } from '../services/LogHubService';

export default defineEvent({
  name: Events.GuildDelete,
  async execute(client, guild) {
    if (guild.available === false) return;
    await guildConfigService.markLeft(guild.id);
    void logHubService.system(client, 'bot.guild_leave', (t) => ({
      title: t('loghub.system.guild_leave_title'),
      fields: [{ name: t('loghub.system.server'), value: `${guild.name ?? guild.id} (\`${guild.id}\`)`, inline: false }],
      color: BRAND.colors.warning,
    }));
  },
});
