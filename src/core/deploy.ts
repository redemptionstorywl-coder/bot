import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import type { RedemptionClient } from './Client';
import { childLogger } from '../utils/logger';

const log = childLogger('Deploy');

export function collectCommandData(client: RedemptionClient): RESTPostAPIApplicationCommandsJSONBody[] {
  const body: RESTPostAPIApplicationCommandsJSONBody[] = [];
  for (const cmd of client.commands.values()) body.push(cmd.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody);
  for (const cmd of client.contextMenus.values()) body.push(cmd.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody);
  return body;
}

/**
 * Déploie les commandes slash :
 *  - si DEV_GUILD_ID est défini → sur ce serveur (instantané)
 *  - sinon → globalement (propagation jusqu'à 1h)
 */
export async function deployCommands(client: RedemptionClient, opts: { token: string; clientId: string; devGuildId?: string }): Promise<number> {
  const rest = new REST({ version: '10' }).setToken(opts.token);
  const body = collectCommandData(client);
  if (opts.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(opts.clientId, opts.devGuildId), { body });
    log.info({ count: body.length, guildId: opts.devGuildId }, 'Commandes déployées (serveur de dev)');
  } else {
    await rest.put(Routes.applicationCommands(opts.clientId), { body });
    log.info({ count: body.length }, 'Commandes déployées (global)');
  }
  return body.length;
}
