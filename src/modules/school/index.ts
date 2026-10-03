import { GuildKind } from '@prisma/client';
import { defineModule } from '../../structures';
import { schoolService } from '../../services/SchoolService';

/** Module School RP : profils, classes, maisons, clubs, candidatures, annonces. */
export default defineModule({
  key: 'school',
  name: '🎓 School RP',
  description: 'Profils élèves / professeurs, classes, maisons et points, clubs, candidatures avec review et annonces scolaires.',
  guildKinds: [GuildKind.SCHOOL],
  onReady(client) {
    schoolService.attach(client);
  },
});
