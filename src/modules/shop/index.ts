import { GuildKind } from '@prisma/client';
import { defineModule } from '../../structures';

/** Module Shop : catalogue, produits, commandes, intégration Tebex. */
export default defineModule({
  key: 'shop',
  name: '🛒 Shop',
  description: 'Catalogue par catégories, commandes avec gestion de stock, historique client, annonces produit et webhook Tebex.',
  guildKinds: [GuildKind.SHOP],
});
