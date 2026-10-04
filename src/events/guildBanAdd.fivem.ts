import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { fivemSyncService } from '../services/FiveMSyncService';
import { childLogger } from '../utils/logger';

const log = childLogger('FiveMBanSync');

/**
 * Ban Discord → serveurs FiveM du guild (option `syncBansToGame`).
 * Ignoré si le ban vient lui-même du jeu (anti-écho 30 s posé par FiveMSyncService.handleSanction).
 */
export default defineEvent({
  name: Events.GuildBanAdd,
  async execute(_client, ban) {
    await fivemSyncService.onDiscordBan(ban.guild, ban.user.id, 'ban').catch((err) => log.warn({ err, guild: ban.guild.id }, 'Ban non relayé vers FiveM'));
  },
});
