import { Events } from 'discord.js';
import { defineEvent } from '../structures';
import { roleService } from '../services/RoleService';
import { childLogger } from '../utils/logger';

const log = childLogger('ReadyRoles');

/** Attache le service des rôles au client et charge les messages de reaction roles suivis. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    roleService.attach(client);
    try {
      const tracked = await roleService.loadTrackedMessages();
      log.info({ tracked }, 'Reaction roles chargés');
    } catch (err) {
      log.error({ err }, 'Impossible de charger les reaction roles');
    }
  },
});
