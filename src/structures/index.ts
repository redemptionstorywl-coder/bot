import type { ClientEvents } from 'discord.js';
import type { ButtonHandler, Command, ContextMenuCommand, Event, ModalHandler, SelectMenuHandler, BotModule } from './types';

export * from './types';

/** Helpers typés pour déclarer proprement chaque élément. */
export const defineCommand = (command: Command): Command => command;
export const defineContextMenu = (command: ContextMenuCommand): ContextMenuCommand => command;
export const defineButton = (handler: ButtonHandler): ButtonHandler => handler;
export const defineSelectMenu = (handler: SelectMenuHandler): SelectMenuHandler => handler;
export const defineModal = (handler: ModalHandler): ModalHandler => handler;
export const defineEvent = <K extends keyof ClientEvents>(event: Event<K>): Event<K> => event;
export const defineModule = (mod: BotModule): BotModule => mod;
