import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { roleService } from '../services/RoleService';
import { guildConfigService } from '../services/GuildConfigService';

/** Réaction ajoutée → rôle ajouté (uniquement pour les messages suivis : aucun SQL sinon). */
export default defineEvent({
  name: Events.MessageReactionAdd,
  async execute(_client, reaction, user) {
    if (user.bot || !roleService.isTracked(reaction.message.id)) return;
    const guildId = reaction.message.guildId;
    if (guildId && !(await guildConfigService.isModuleEnabled(guildId, 'reactionrole'))) return;
    await roleService.handleReaction(reaction, user, true);
  },
});
