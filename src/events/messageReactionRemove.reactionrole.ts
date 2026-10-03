import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { roleService } from '../services/RoleService';
import { guildConfigService } from '../services/GuildConfigService';

/** Réaction retirée → rôle retiré (uniquement pour les messages suivis : aucun SQL sinon). */
export default defineEvent({
  name: Events.MessageReactionRemove,
  async execute(_client, reaction, user) {
    if (user.bot || !roleService.isTracked(reaction.message.id)) return;
    const guildId = reaction.message.guildId;
    if (guildId && !(await guildConfigService.isModuleEnabled(guildId, 'reactionrole'))) return;
    await roleService.handleReaction(reaction, user, false);
  },
});
