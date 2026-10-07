import type { LogCategory } from '@prisma/client';
import {
  CATEGORY_ROUTES,
  GAME_SYSTEM_ROUTE,
  GLOBAL_MIRRORS,
  GLOBAL_ONLY_ROUTES,
  GLOBAL_SOURCE_KEY,
  SOURCE_ACTION_GAME_ROUTES,
  SOURCE_SYSTEM_ROUTE,
  gameSourceKey,
  isGameAction,
  isGameRouteKey,
  routeForAction,
  type GameRouteKey,
  type GlobalRouteKey,
  type LogRouteKey,
} from './routes';

/**
 * Où envoyer un log ? (fonction pure, testée dans tests/logs/delivery.test.ts)
 *  1. salons de logs du serveur lui-même (comportement historique), sauf si la source est reliée à un hub avec
 *     `keepLocal = false` ; la catégorie GAME n'a pas de repli sur le salon Système (volume des logs en jeu) ;
 *  2. hub, section du serveur source : route fine → route de la catégorie → route « système » de la source (config-bot)
 *     → salon bot-système de la section générale ;
 *  3. hub, section du serveur de jeu (`entry.game`) : route de jeu → `game.server` (sauf le chat : pas de repli) ;
 *  4. hub, section générale : copie des événements importants (GLOBAL_MIRRORS), y compris ceux du hub lui-même.
 * Un même salon n'est jamais ciblé deux fois.
 */

/** sourceKey → routeKey → channelId (routes d'UN hub). */
export type RouteTable = Record<string, Record<string, string>>;

export interface SourceLinkInfo {
  hubGuildId: string;
  keepLocal: boolean;
}

export interface GameLinkInfo {
  hubGuildId: string;
  chat: boolean;
}

export interface DeliveryInput {
  guildId: string;
  action: string;
  category: LogCategory;
  /** Module logs actif + salons de logs du serveur (null = aucune publication locale) */
  local: Partial<Record<string, string>> | null;
  /** Lien de ce serveur vers un hub (null = pas de hub) */
  source: SourceLinkInfo | null;
  /** Log lié à un serveur de jeu : son id et la route forcée (`custom` avec indication de salon) */
  game?: { serverId: number; route?: GameRouteKey | null } | null;
  /** Lien du serveur de jeu vers un hub */
  gameLink?: GameLinkInfo | null;
  /** Le serveur est lui-même un hub : ses événements importants (sanctions, sécurité, bot) vont dans sa section générale */
  selfHub?: boolean;
  /** Routes par hub (hubGuildId → table) */
  routes: Record<string, RouteTable | undefined>;
}

export type DeliveryScope = 'local' | 'source' | 'game' | 'global';

export interface DeliveryTarget {
  channelId: string;
  scope: DeliveryScope;
  /** Hub concerné (absent pour la publication locale) */
  hubGuildId?: string;
  route?: LogRouteKey | GlobalRouteKey;
}

/** Salon local d'une catégorie (repli Système, sauf GAME). */
export function localChannel(channels: Partial<Record<string, string>> | null, category: LogCategory): string | null {
  if (!channels) return null;
  return channels[category] ?? (category === 'GAME' ? null : (channels.SYSTEM ?? null));
}

/** Salon d'une section Discord pour une route (avec replis). */
export function sourceChannel(table: RouteTable | undefined, sourceKey: string, route: LogRouteKey, category: LogCategory): string | null {
  if (!table) return null;
  const section = table[sourceKey] ?? {};
  return section[route] ?? section[CATEGORY_ROUTES[category]] ?? section[SOURCE_SYSTEM_ROUTE] ?? table[GLOBAL_SOURCE_KEY]?.['global.system'] ?? null;
}

/** Salon d'une section de jeu pour une route : repli `game.server`, jamais pour le chat (désactivable). */
export function gameChannel(table: RouteTable | undefined, serverId: number, route: GameRouteKey, chat: boolean): string | null {
  if (!table) return null;
  const section = table[gameSourceKey(serverId)];
  if (!section) return null;
  if (route === 'game.chat') return chat ? (section['game.chat'] ?? null) : null;
  return section[route] ?? section[GAME_SYSTEM_ROUTE] ?? null;
}

export function planDelivery(input: DeliveryInput): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];
  const seen = new Set<string>();
  const push = (t: DeliveryTarget) => {
    if (!t.channelId || seen.has(t.channelId)) return;
    seen.add(t.channelId);
    targets.push(t);
  };

  // 1. Publication locale
  if (!input.source || input.source.keepLocal) {
    const local = localChannel(input.local, input.category);
    if (local) push({ channelId: local, scope: 'local' });
  }

  const { route } = routeForAction(input.action, input.category);
  const gameAction = isGameAction(input.action);
  const mirrors = new Map<string, Set<GlobalRouteKey>>();
  const mirror = (hubGuildId: string, r: LogRouteKey) => {
    const g = GLOBAL_MIRRORS[r];
    if (!g) return;
    if (!mirrors.has(hubGuildId)) mirrors.set(hubGuildId, new Set());
    mirrors.get(hubGuildId)!.add(g);
  };

  // 2. Section du serveur Discord source
  if (input.source && !gameAction) {
    const hub = input.source.hubGuildId;
    if (!GLOBAL_ONLY_ROUTES.has(route)) {
      const channelId = sourceChannel(input.routes[hub], input.guildId, route, input.category);
      if (channelId) push({ channelId, scope: 'source', hubGuildId: hub, route });
    }
    mirror(hub, route);
  }

  // 2 bis. Hub lui-même (pas de section propre) : copies générales seulement
  if (input.selfHub && !input.source && !gameAction) mirror(input.guildId, route);

  // 3. Section du serveur de jeu
  if (input.game && input.gameLink) {
    const hub = input.gameLink.hubGuildId;
    const gameRoute: GameRouteKey | null = input.game.route ?? (isGameRouteKey(route) ? route : (SOURCE_ACTION_GAME_ROUTES[input.action] ?? null));
    if (gameRoute) {
      const channelId = gameChannel(input.routes[hub], input.game.serverId, gameRoute, input.gameLink.chat);
      if (channelId) push({ channelId, scope: 'game', hubGuildId: hub, route: gameRoute });
      if (gameAction) mirror(hub, gameRoute);
    }
  }

  // 4. Section générale
  for (const [hub, keys] of mirrors) {
    for (const key of keys) {
      const channelId = input.routes[hub]?.[GLOBAL_SOURCE_KEY]?.[key];
      if (channelId) push({ channelId, scope: 'global', hubGuildId: hub, route: key });
    }
  }
  return targets;
}
