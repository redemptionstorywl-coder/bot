import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { welcomeService } from '../services/WelcomeService';
import { roleService } from '../services/RoleService';

/** Départ d'un membre : annule les autoroles différés, message de départ + log MEMBER. */
export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(_client, member) {
    roleService.cancelPending(member.guild.id, member.id);
    const config = await guildConfigService.get(member.guild.id);
    if (!config?.modules.leave) return;
    await welcomeService.handleLeave(member);
  },
});
