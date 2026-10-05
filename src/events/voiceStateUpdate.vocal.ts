import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { tempVoiceService } from '../services/TempVoiceService';
import { childLogger } from '../utils/logger';

const log = childLogger('TempVoice');

/** Salons vocaux temporaires : lobby rejoint → salon créé ; salon temporaire vidé → supprimé après 5 s. */
export default defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(_client, oldState, newState) {
    try {
      await tempVoiceService.handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
      log.error({ err, guild: newState.guild.id }, 'voiceStateUpdate (salons temporaires)');
    }
  },
});
