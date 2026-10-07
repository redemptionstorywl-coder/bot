import type { Client } from 'discord.js';
import { LogCategory, Prisma } from '@prisma/client';
import { prisma } from '../database/client';
import { guildConfigService } from './GuildConfigService';
import { logHubService, type GameLink, type SourceLink } from './LogHubService';
import { logDispatchService } from './LogDispatchService';
import { buildLogEmbed, toHubEmbed } from './logs/embeds';
import { planDelivery, type RouteTable } from './logs/delivery';
import type { GameRouteKey } from './logs/routes';
import { childLogger } from '../utils/logger';

const log = childLogger('LoggingService');

export interface LogEntry {
  guildId: string;
  category: LogCategory;
  /** Identifiant d'action court : "message.delete", "ticket.open"… (route du hub : src/services/logs/routes.ts) */
  action: string;
  title: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  actorId?: string | null;
  targetId?: string | null;
  color?: number;
  thumbnail?: string;
  data?: Record<string, unknown>;
  /** Ne pas écrire en base (logs très fréquents) */
  skipDatabase?: boolean;
  /** Date de l'événement affichée dans l'embed (logs en jeu différés) ; défaut : maintenant */
  timestamp?: Date;
  /**
   * Log lié à un serveur de jeu (FiveMServer) : copié dans la section de ce jeu du hub de logs.
   * `route` force la route de jeu (log `custom` avec indication de salon).
   */
  game?: { serverId: number; serverName: string; route?: GameRouteKey | null };
}

/**
 * Service de logs : trace en base (table Log, dashboard), embed dans le salon configuré pour la catégorie et,
 * si le serveur est relié à un serveur de logs central (hub, `/template logs`), copie dans le salon de la route fine du hub
 * (+ section du serveur de jeu + section générale pour les événements importants). Les embeds passent par la file
 * d'envoi groupée (LogDispatchService : 10 embeds par message, toutes les 2 s, gestion des 429).
 */
export class LoggingService {
  private client: Client | null = null;
  private queue: LogEntry[] = [];
  private flushing = false;

  attach(client: Client): void {
    this.client = client;
    logDispatchService.attach(client);
  }

  async log(entry: LogEntry): Promise<void> {
    this.queue.push(entry);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 20);
        await Promise.all(batch.map((e) => this.process(e).catch((err) => log.error({ err, action: e.action }, 'Log failed'))));
      }
    } finally {
      this.flushing = false;
    }
  }

  private async process(entry: LogEntry): Promise<void> {
    const cfg = await guildConfigService.get(entry.guildId);
    if (!entry.skipDatabase) {
      await prisma.log.create({
        data: {
          guildId: entry.guildId,
          category: entry.category,
          action: entry.action,
          actorId: entry.actorId ?? null,
          targetId: entry.targetId ?? null,
          data: (entry.data ?? { title: entry.title, description: entry.description }) as Prisma.InputJsonValue,
        },
      });
    }
    if (!this.client) return;
    const source = await logHubService.getSourceLink(entry.guildId).catch(() => null);
    const gameLink = entry.game ? await logHubService.getGameLink(entry.game.serverId).catch(() => null) : null;
    const selfHub = !source && !!(await logHubService.getHub(entry.guildId).catch(() => null));
    const routes: Record<string, RouteTable | undefined> = {};
    for (const hub of new Set([source?.hubGuildId, gameLink?.hubGuildId, selfHub ? entry.guildId : null].filter((h): h is string => !!h))) routes[hub] = await logHubService.getRoutes(hub).catch(() => undefined);
    const targets = planDelivery({
      guildId: entry.guildId,
      action: entry.action,
      category: entry.category,
      local: cfg?.modules.logs ? cfg.logChannels : null,
      source,
      game: entry.game ? { serverId: entry.game.serverId, route: entry.game.route ?? null } : null,
      gameLink,
      selfHub,
      routes,
    });
    if (!targets.length) return;
    const embed = buildLogEmbed(entry);
    for (const target of targets) {
      if (target.scope === 'local') logDispatchService.enqueue(target.channelId, embed);
      else logDispatchService.enqueue(target.channelId, toHubEmbed(embed, this.origin(entry, target.scope, source, gameLink)));
    }
  }

  /** Auteur de la copie dans le hub : serveur Discord source, ou serveur de jeu. */
  private origin(entry: LogEntry, scope: 'source' | 'game' | 'global', source: SourceLink | null, gameLink: GameLink | null): { name: string; iconUrl: string | null } {
    const guild = this.client?.guilds.cache.get(entry.guildId);
    const iconUrl = guild?.iconURL() ?? null;
    const sourceName = source ? logHubService.originName(source) : (guild?.name ?? entry.guildId);
    const isGame = entry.game && gameLink && (scope === 'game' || entry.action.startsWith('game.'));
    return { name: isGame ? `🎮 ${entry.game!.serverName}` : sourceName, iconUrl };
  }

  /** Nettoie les logs plus vieux que `days` jours. */
  async prune(days = 90): Promise<number> {
    const r = await prisma.log.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400_000) } } });
    return r.count;
  }
}

export const loggingService = new LoggingService();
