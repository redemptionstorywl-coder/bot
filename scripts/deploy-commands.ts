/* eslint-disable no-console */
/**
 * `npm run deploy` — déploie les slash commands sans lancer le bot.
 * Avec DEV_GUILD_ID : déploiement instantané sur le serveur de dev ; sinon global.
 * `npm run deploy -- --global` force le déploiement global.
 */
import path from 'node:path';
import { env } from '../src/config/env';
import { RedemptionClient } from '../src/core/Client';
import { loadCommands } from '../src/core/loaders';
import { deployCommands } from '../src/core/deploy';

async function main(): Promise<void> {
  const cfg = env();
  const client = new RedemptionClient();
  loadCommands(client, path.resolve(__dirname, '..', 'src'));
  const forceGlobal = process.argv.includes('--global');
  const count = await deployCommands(client, { token: cfg.DISCORD_TOKEN, clientId: cfg.CLIENT_ID, devGuildId: forceGlobal ? undefined : cfg.DEV_GUILD_ID || undefined });
  console.log(`✔ ${count} commandes déployées ${forceGlobal || !cfg.DEV_GUILD_ID ? '(global — propagation jusqu’à 1 h)' : `(serveur ${cfg.DEV_GUILD_ID})`}`);
  client.cooldowns.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('✖ Déploiement impossible :', (err as Error).message);
  process.exit(1);
});
