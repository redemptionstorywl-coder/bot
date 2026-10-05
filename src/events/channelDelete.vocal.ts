import { ChannelType, Events } from 'discord.js';
import { defineEvent } from '../structures';
import { tempVoiceService } from '../services/TempVoiceService';
import { childLogger } from '../utils/logger';

const log = childLogger('TempVoice');

/** Salon vocal temporaire supprimé (par le bot ou à la main) : il est oublié (mémoire + base). */
export default defineEvent({
  name: Events.ChannelDelete,
  async execute(_client, channel) {
    if (channel.isDMBased() || channel.type !== ChannelType.GuildVoice) return;
    try {
      await tempVoiceService.handleChannelDelete(channel.id);
    } catch (err) {
      log.error({ err, channel: channel.id }, 'channelDelete (salons temporaires)');
    }
  },
});
