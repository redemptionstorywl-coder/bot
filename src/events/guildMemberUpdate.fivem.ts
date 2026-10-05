import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { fivemSyncService } from '../services/FiveMSyncService';
import { childLogger } from '../utils/logger';

const log = childLogger('FiveMGroups');

/**
 * Rôles Discord → groupes en jeu : quand un membre gagne / perd un rôle associé à un groupe (liste `roleGroups` d'un
 * serveur FiveM), ses groupes effectifs sont poussés au serveur de jeu (action SET_GROUPS, appliquée par rs_bridge).
 */
export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(_client, oldMember, newMember) {
    if (newMember.user.bot) return;
    // Membre non mis en cache avant la mise à jour : rôles précédents inconnus (partial).
    const before = oldMember.partial ? null : [...oldMember.roles.cache.keys()];
    if (before && before.length === newMember.roles.cache.size && before.every((id) => newMember.roles.cache.has(id))) return;
    await fivemSyncService.onMemberRolesChanged(before, newMember).catch((err) => log.warn({ err, guild: newMember.guild.id, user: newMember.id }, 'Groupes en jeu non poussés'));
  },
});
