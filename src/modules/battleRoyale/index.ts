import { GuildKind } from '@prisma/client';
import { defineModule } from '../../structures';
import { fivemService } from '../../services/FiveMService';

/** Module Battle Royale : profils, classements, Battle Pass, stats FiveM. */
export default defineModule({
  key: 'battleRoyale',
  name: '⚔️ Battle Royale',
  description: 'Profils joueurs, XP / niveaux, classements saisonniers, Battle Pass et réception des stats du serveur FiveM.',
  guildKinds: [GuildKind.BATTLE_ROYALE],
  onReady(client) {
    fivemService.attach(client);
    fivemService.registerTasks();
  },
});
