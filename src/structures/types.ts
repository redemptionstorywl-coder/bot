import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ClientEvents,
  ContextMenuCommandBuilder,
  ModalSubmitInteraction,
  PermissionResolvable,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
} from 'discord.js';
import type { GuildKind } from '@prisma/client';
import type { ModuleKey } from '../config/constants';
import type { RedemptionClient } from '../core/Client';
import type { Translator } from '../services/TranslationService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';

/** Niveau de permission interne (en plus des permissions Discord). */
export type InternalPermission = 'everyone' | 'staff' | 'admin' | 'owner';

export interface CommandPermissions {
  /** Permissions Discord requises pour l'utilisateur */
  discord?: PermissionResolvable[];
  /** Niveau interne requis (rôles admin / staff configurés par serveur) */
  internal?: InternalPermission;
  /** Permissions requises pour le bot */
  bot?: PermissionResolvable[];
}

/** Contexte passé à chaque handler : traduction résolue, config du serveur, client. */
export interface InteractionContext {
  client: RedemptionClient;
  /** Fonction de traduction liée à la langue de l'utilisateur (puis serveur, puis fallback) */
  t: Translator;
  /** Code langue résolu */
  lang: string;
  /** Config résolue du serveur (null en DM) */
  config: ResolvedGuildConfig | null;
}

export type SlashData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

export interface Command {
  data: SlashData;
  /** Catégorie (dossier) — remplie automatiquement par le loader si absente */
  category?: string;
  /** Module requis : si désactivé sur le serveur, la commande est refusée */
  module?: ModuleKey;
  /** Types de serveurs autorisés (vide = tous) */
  guildKinds?: GuildKind[];
  /** Cooldown en secondes */
  cooldown?: number;
  permissions?: CommandPermissions;
  /** Autoriser l'usage en DM */
  dmPermission?: boolean;
  /** Réponse éphémère par défaut (information pour le router, optionnel) */
  ephemeral?: boolean;
  execute(interaction: ChatInputCommandInteraction, ctx: InteractionContext): Promise<unknown>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: InteractionContext): Promise<unknown>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  module?: ModuleKey;
  permissions?: CommandPermissions;
  execute(interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction, ctx: InteractionContext): Promise<unknown>;
}

/**
 * Convention de customId : `namespace:action:arg1:arg2...`
 * Le handler est sélectionné par `namespace` (premier segment) ; `args` = segments suivants.
 */
export interface ComponentHandler<I> {
  /** Namespace du customId (premier segment) */
  id: string;
  module?: ModuleKey;
  cooldown?: number;
  permissions?: CommandPermissions;
  execute(interaction: I, args: string[], ctx: InteractionContext): Promise<unknown>;
}

export type ButtonHandler = ComponentHandler<ButtonInteraction>;
export type SelectMenuHandler = ComponentHandler<AnySelectMenuInteraction>;
export type ModalHandler = ComponentHandler<ModalSubmitInteraction>;

export interface Event<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(client: RedemptionClient, ...args: ClientEvents[K]): Promise<unknown> | unknown;
}

/** Un module métier (prison, battleRoyale, school, shop) : hooks de cycle de vie. */
export interface BotModule {
  key: ModuleKey;
  name: string;
  description: string;
  /** Types de serveurs où le module a du sens */
  guildKinds?: GuildKind[];
  onReady?(client: RedemptionClient): Promise<void> | void;
  onShutdown?(client: RedemptionClient): Promise<void> | void;
}
