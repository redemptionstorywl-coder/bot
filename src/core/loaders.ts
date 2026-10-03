import fs from 'node:fs';
import path from 'node:path';
import type { RedemptionClient } from './Client';
import type { ButtonHandler, Command, ContextMenuCommand, Event, ModalHandler, SelectMenuHandler, BotModule } from '../structures/types';
import { childLogger } from '../utils/logger';

const log = childLogger('Loader');
const EXT = __filename.endsWith('.ts') ? '.ts' : '.js';

/** Liste récursivement les fichiers .ts/.js (hors .d.ts, .test, index) d'un dossier. */
export function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(EXT) && !entry.name.endsWith('.d.ts') && !entry.name.includes('.test.') && !entry.name.startsWith('_')) out.push(full);
  }
  return out.sort();
}

function load<T>(file: string): T | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(file) as { default?: T } & Record<string, unknown>;
  const value = (mod.default ?? mod.command ?? mod.handler ?? mod.event ?? mod.module ?? null) as T | null;
  return value;
}

export function loadCommands(client: RedemptionClient, base: string): void {
  const dir = path.join(base, 'commands');
  for (const file of walk(dir)) {
    const cmd = load<Command | ContextMenuCommand>(file);
    if (!cmd || !('data' in cmd) || !cmd.data?.name) {
      log.warn({ file }, 'Commande ignorée (export invalide)');
      continue;
    }
    const category = path.relative(dir, path.dirname(file)).split(path.sep)[0] ?? 'misc';
    if ('type' in cmd.data && typeof (cmd.data as { type?: number }).type === 'number' && (cmd.data as { type?: number }).type !== 1) {
      client.contextMenus.set(cmd.data.name, cmd as ContextMenuCommand);
    } else {
      const c = cmd as Command;
      c.category ??= category;
      if (client.commands.has(c.data.name)) log.warn({ name: c.data.name, file }, 'Commande dupliquée, écrasée');
      client.commands.set(c.data.name, c);
    }
  }
  log.info({ commands: client.commands.size, contextMenus: client.contextMenus.size }, 'Commandes chargées');
}

export function loadComponents(client: RedemptionClient, base: string): void {
  for (const file of walk(path.join(base, 'buttons'))) {
    const h = load<ButtonHandler>(file);
    if (h?.id) client.buttons.set(h.id, h);
    else log.warn({ file }, 'Bouton ignoré');
  }
  for (const file of walk(path.join(base, 'selectMenus'))) {
    const h = load<SelectMenuHandler>(file);
    if (h?.id) client.selectMenus.set(h.id, h);
    else log.warn({ file }, 'Select menu ignoré');
  }
  for (const file of walk(path.join(base, 'modals'))) {
    const h = load<ModalHandler>(file);
    if (h?.id) client.modals.set(h.id, h);
    else log.warn({ file }, 'Modal ignoré');
  }
  log.info({ buttons: client.buttons.size, selectMenus: client.selectMenus.size, modals: client.modals.size }, 'Composants chargés');
}

export function loadEvents(client: RedemptionClient, base: string): void {
  let count = 0;
  for (const file of walk(path.join(base, 'events'))) {
    const ev = load<Event>(file);
    if (!ev?.name) {
      log.warn({ file }, 'Événement ignoré');
      continue;
    }
    const handler = (...args: unknown[]) =>
      Promise.resolve((ev.execute as (...a: unknown[]) => unknown)(client, ...args)).catch((err) => log.error({ err, event: ev.name }, 'Erreur dans un événement'));
    if (ev.once) client.once(ev.name, handler);
    else client.on(ev.name, handler);
    count++;
  }
  log.info({ events: count }, 'Événements chargés');
}

export function loadModules(client: RedemptionClient, base: string): void {
  const dir = path.join(base, 'modules');
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const index = path.join(dir, entry.name, `index${EXT}`);
    if (!fs.existsSync(index)) continue;
    const mod = load<BotModule>(index);
    if (mod?.key) client.modules.set(mod.key, mod);
  }
  log.info({ modules: [...client.modules.keys()] }, 'Modules chargés');
}

export function loadAll(client: RedemptionClient, base = path.resolve(__dirname, '..')): void {
  loadCommands(client, base);
  loadComponents(client, base);
  loadEvents(client, base);
  loadModules(client, base);
}
