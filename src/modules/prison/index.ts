import { GuildKind } from '@prisma/client';
import { defineModule } from '../../structures';
import { whitelistService } from '../../services/WhitelistService';
import { fivemService } from '../../services/FiveMService';

/** Module Prison RP : whitelist + statut FiveM. */
export default defineModule({
  key: 'whitelist',
  name: '🔒 Prison RP — Whitelist',
  description: 'Candidatures whitelist (modal, review staff, rôles, DM) et synchronisation avec le serveur FiveM.',
  guildKinds: [GuildKind.PRISON, GuildKind.SCHOOL],
  onReady(client) {
    whitelistService.attach(client);
    fivemService.attach(client);
    fivemService.registerTasks();
  },
});
