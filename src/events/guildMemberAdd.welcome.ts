import { Events } from 'discord.js';
import { AutoRoleType } from '@prisma/client';
import { defineEvent } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { welcomeService } from '../services/WelcomeService';
import { roleService } from '../services/RoleService';
import { childLogger } from '../utils/logger';

const log = childLogger('GuildMemberAdd');

/** Arrivée d'un membre : autorole JOIN / BOT puis message de bienvenue (+ DM, + bouton langue). */
export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(_client, member) {
    const config = await guildConfigService.get(member.guild.id);
    if (!config) return;
    // Discord refuse les changements de rôles tant que l'écran d'accueil n'est pas validé (`pending`) :
    // les autoroles JOIN sont alors appliqués par guildMemberUpdate.autorole quand `pending` passe à false.
    if (config.modules.autorole && !member.pending) {
      await roleService.applyAutoRoles(member, member.user.bot ? AutoRoleType.BOT : AutoRoleType.JOIN).catch((err) => log.warn({ err, guild: member.guild.id, user: member.id }, 'Autorole à l’arrivée impossible'));
    }
    if (config.modules.welcome) await welcomeService.handleJoin(member);
  },
});
