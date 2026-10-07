import { Client, Collection, GatewayIntentBits, Options, Partials } from 'discord.js';
import type { ButtonHandler, Command, ContextMenuCommand, ModalHandler, SelectMenuHandler, BotModule } from '../structures/types';
import { CooldownManager } from '../utils/cooldown';
import { EventEmitter } from 'node:events';

/**
 * Client Discord étendu : registres de commandes / composants / modules.
 */
export class RedemptionClient extends Client {
  readonly commands = new Collection<string, Command>();
  readonly contextMenus = new Collection<string, ContextMenuCommand>();
  readonly buttons = new Collection<string, ButtonHandler>();
  readonly selectMenus = new Collection<string, SelectMenuHandler>();
  readonly modals = new Collection<string, ModalHandler>();
  readonly modules = new Collection<string, BotModule>();
  /** Purge des cooldowns expirés : tâche `core:cooldowns` du scheduler (src/core/tasks.ts). */
  readonly cooldowns = new CooldownManager(0);
  /** Bus interne (dashboard ↔ bot) */
  readonly bus = new EventEmitter();
  readonly startedAt = Date.now();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        // Invitations créées / supprimées (logs membres : invitations)
        GatewayIntentBits.GuildInvites,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
      makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 200,
        GuildMemberManager: { maxSize: 5000, keepOverLimit: (m) => m.id === m.client.user?.id },
        PresenceManager: 0,
      }),
      sweepers: {
        ...Options.DefaultSweeperSettings,
        messages: { interval: 3600, lifetime: 1800 },
      },
      allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
    });
  }

  get uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }
}
