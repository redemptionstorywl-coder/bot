import { Events } from 'discord.js';
import { AutoRoleType } from '@prisma/client';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { roleService } from '../services/RoleService';
import { childLogger } from '../utils/logger';

const log = childLogger('GuildMemberUpdate');

/**
 * Quand le membre a validé l'écran d'accueil (`pending` passe de true à false) :
 * autoroles VERIFIED + JOIN (différés à l'arrivée car Discord refuse les rôles sur un membre `pending`).
 */
export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(_client, oldMember, newMember) {
    if (oldMember.pending !== true || newMember.pending !== false) return;
    const config = await guildConfigService.get(newMember.guild.id);
    if (!config?.modules.autorole) return;
    try {
      const verified = await roleService.applyAutoRoles(newMember, AutoRoleType.VERIFIED);
      const fresh = verified.member ?? newMember;
      await roleService.applyAutoRoles(fresh, newMember.user.bot ? AutoRoleType.BOT : AutoRoleType.JOIN);
    } catch (err) {
      log.warn({ err, guild: newMember.guild.id, user: newMember.id }, 'Autorole VERIFIED/JOIN impossible');
    }
  },
});
