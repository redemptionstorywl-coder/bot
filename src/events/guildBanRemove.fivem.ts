import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { fivemSyncService } from '../services/FiveMSyncService';
import { childLogger } from '../utils/logger';

const log = childLogger('FiveMBanSync');

/** Unban Discord (manuel ou fin de tempban) → serveurs FiveM du guild (option `syncBansToGame`). */
export default defineEvent({
  name: Events.GuildBanRemove,
  async execute(_client, ban) {
    await fivemSyncService.onDiscordBan(ban.guild, ban.user.id, 'unban').catch((err) => log.warn({ err, guild: ban.guild.id }, 'Unban non relayé vers FiveM'));
  },
});
