import type { LogCategory } from '@prisma/client';

/**
 * Routes fines des logs (plus fines que LogCategory) pour le serveur de logs central (hub, `/template logs`).
 *
 * Chaque `action` passée à `loggingService.log` est rattachée à UNE route (table ACTION_ROUTES, complète :
 * `npm run check` → scripts/checks/log-routes.ts échoue si une action de src/ n'y figure pas). Une action inconnue
 * retombe sur la route de sa catégorie (CATEGORY_ROUTES).
 *
 * Trois familles de salons dans le hub (`LogRoute.sourceKey`) :
 *  - section d'un serveur Discord source (`<guildId>`) : SOURCE_ROUTE_KEYS ;
 *  - section d'un serveur de jeu (`game:<FiveMServer.id>`) : GAME_ROUTE_KEYS ;
 *  - section générale (`global`) : GLOBAL_ROUTE_KEYS (sommaire + copies des événements importants, GLOBAL_MIRRORS).
 */

export const SOURCE_ROUTE_KEYS = [
  'mod.sanctions',
  'mod.clear',
  'security.alerts',
  'fivem.sync',
  'message.deleted',
  'message.edited',
  'message.bulk',
  'member.join',
  'member.leave',
  'member.nickname',
  'member.roles',
  'member.invites',
  'voice',
  'server.channels',
  'server.roles',
  'server.settings',
  'tickets',
  'whitelist',
  'announcements',
  'events',
  'shop',
  'battleroyale',
  'school',
  'bot.config',
  'bot.system',
] as const;
export type SourceRouteKey = (typeof SOURCE_ROUTE_KEYS)[number];

export const GAME_ROUTE_KEYS = ['game.connections', 'game.accounts', 'game.kills', 'game.matches', 'game.sanctions', 'game.admin', 'game.chat', 'game.anticheat', 'game.server'] as const;
export type GameRouteKey = (typeof GAME_ROUTE_KEYS)[number];

export const GLOBAL_ROUTE_KEYS = ['global.summary', 'global.sanctions', 'global.security', 'global.system'] as const;
export type GlobalRouteKey = (typeof GLOBAL_ROUTE_KEYS)[number];

/** Catégories Discord créées dans le hub (une route par catégorie, pour les retrouver et les réparer). */
export const CATEGORY_ROUTE_KEYS = ['category.general', 'category.moderation', 'category.activity', 'category.server', 'category.game'] as const;
export type CategoryRouteKey = (typeof CATEGORY_ROUTE_KEYS)[number];

export type LogRouteKey = SourceRouteKey | GameRouteKey;
export type AnyRouteKey = SourceRouteKey | GameRouteKey | GlobalRouteKey | CategoryRouteKey;

export const GLOBAL_SOURCE_KEY = 'global';
export const gameSourceKey = (fivemServerId: number): string => `game:${fivemServerId}`;
export function parseGameSourceKey(sourceKey: string): number | null {
  const m = /^game:(\d{1,10})$/.exec(sourceKey);
  return m ? Number(m[1]) : null;
}

export const isSourceRouteKey = (v: string): v is SourceRouteKey => (SOURCE_ROUTE_KEYS as readonly string[]).includes(v);
export const isGameRouteKey = (v: string): v is GameRouteKey => (GAME_ROUTE_KEYS as readonly string[]).includes(v);
export const isGlobalRouteKey = (v: string): v is GlobalRouteKey => (GLOBAL_ROUTE_KEYS as readonly string[]).includes(v);
export const isCategoryRouteKey = (v: string): v is CategoryRouteKey => (CATEGORY_ROUTE_KEYS as readonly string[]).includes(v);

/**
 * Action → route. Une entrée par action réellement journalisée dans src/ et dashboard/ (vérifié par `npm run check`).
 * Les actions `game.*` (logs en jeu) vont dans la section du serveur de jeu, jamais dans la section Discord.
 */
export const ACTION_ROUTES: Readonly<Record<string, LogRouteKey>> = {
  // ── Modération : sanctions (SanctionType en minuscules) ──
  'mod.ban': 'mod.sanctions',
  'mod.tempban': 'mod.sanctions',
  'mod.unban': 'mod.sanctions',
  'mod.kick': 'mod.sanctions',
  'mod.warn': 'mod.sanctions',
  'mod.unwarn': 'mod.sanctions',
  'mod.timeout': 'mod.sanctions',
  'mod.untimeout': 'mod.sanctions',
  'mod.mute': 'mod.sanctions',
  'mod.unmute': 'mod.sanctions',
  'mod.unban_all': 'mod.sanctions',
  'mod.unban_all.start': 'mod.sanctions',
  // ── Modération : nettoyage et salons (clear, clear salon, mute-salon, slowmode, lock / unlock) ──
  'mod.purge': 'mod.clear',
  'mod.lock': 'mod.clear',
  'mod.unlock': 'mod.clear',
  'mod.slowmode': 'mod.clear',
  // ── Sécurité ──
  'mod.lockdown': 'security.alerts',
  'mod.lockdown_end': 'security.alerts',
  'lockdown.on': 'security.alerts',
  'lockdown.off': 'security.alerts',
  'antiraid.spam': 'security.alerts',
  'antiraid.mass_mention': 'security.alerts',
  'antiraid.invite': 'security.alerts',
  'antiraid.link': 'security.alerts',
  'antiraid.new_account': 'security.alerts',
  'antiraid.bot': 'security.alerts',
  'antiraid.mass_join': 'security.alerts',
  'antinuke.ban': 'security.alerts',
  'antinuke.kick': 'security.alerts',
  'antinuke.channelDelete': 'security.alerts',
  'antinuke.channelCreate': 'security.alerts',
  'antinuke.roleDelete': 'security.alerts',
  'antinuke.roleCreate': 'security.alerts',
  'antinuke.webhookCreate': 'security.alerts',
  'antinuke.memberRoleUpdate': 'security.alerts',
  'antinuke.pruneMembers': 'security.alerts',
  'antinuke.botAdd': 'security.alerts',
  'honeypot.setup': 'security.alerts',
  'honeypot.triggered': 'security.alerts',
  'member.join_bot': 'security.alerts',
  'integration.create': 'security.alerts',
  'integration.delete': 'security.alerts',
  // ── Synchronisation jeu ⇄ Discord ──
  'fivem.sanction.ban': 'fivem.sync',
  'fivem.sanction.kick': 'fivem.sync',
  'fivem.sanction.warn': 'fivem.sync',
  'fivem.sanction.unban': 'fivem.sync',
  'fivem.sync.ban': 'fivem.sync',
  'fivem.sync.unban': 'fivem.sync',
  'fivem.maintenance.on': 'fivem.sync',
  'fivem.maintenance.off': 'fivem.sync',
  // ── Messages ──
  'message.delete': 'message.deleted',
  'message.edit': 'message.edited',
  'message.bulk_delete': 'message.bulk',
  // ── Membres ──
  'member.join': 'member.join',
  'member.leave': 'member.leave',
  'member.nickname': 'member.nickname',
  'member.roles': 'member.roles',
  'role.autorole': 'member.roles',
  'role.menu': 'member.roles',
  'role.toggle': 'member.roles',
  'role.reaction': 'member.roles',
  'role.notification': 'member.roles',
  'invite.create': 'member.invites',
  'invite.delete': 'member.invites',
  // ── Vocal ──
  'voice.join': 'voice',
  'voice.leave': 'voice',
  'voice.move': 'voice',
  'vocal.create': 'voice',
  'vocal.delete': 'voice',
  'vocal.transfer': 'voice',
  'vocal.error': 'voice',
  // ── Serveur ──
  'channel.create': 'server.channels',
  'channel.update': 'server.channels',
  'channel.delete': 'server.channels',
  'role.create': 'server.roles',
  'role.update': 'server.roles',
  'role.delete': 'server.roles',
  'server.update': 'server.settings',
  'emoji.create': 'server.settings',
  'emoji.update': 'server.settings',
  'emoji.delete': 'server.settings',
  'webhook.create': 'server.settings',
  'webhook.update': 'server.settings',
  'webhook.delete': 'server.settings',
  // ── Tickets ──
  'ticket.open': 'tickets',
  'ticket.close': 'tickets',
  'ticket.reopen': 'tickets',
  'ticket.transcript': 'tickets',
  'ticket.member_add': 'tickets',
  'ticket.member_remove': 'tickets',
  'ticket.transfer': 'tickets',
  'ticket.delete': 'tickets',
  // ── Whitelist ──
  'whitelist.apply': 'whitelist',
  'whitelist.accept': 'whitelist',
  'whitelist.reject': 'whitelist',
  // ── Annonces, embeds, messages privés ──
  'announcement.update': 'announcements',
  'announcement.delete': 'announcements',
  'announcement.archive': 'announcements',
  'announcement.schedule': 'announcements',
  'announcement.schedule_failed': 'announcements',
  'announcement.publish': 'announcements',
  'announcement.publish_scheduled': 'announcements',
  'dm.user': 'announcements',
  'dm.mass_sent': 'announcements',
  'dm.mass_cancelled': 'announcements',
  // ── Événements, giveaways, sondages ──
  'event.create': 'events',
  'event.update': 'events',
  'event.cancel': 'events',
  'event.end': 'events',
  'giveaway.create': 'events',
  'giveaway.end': 'events',
  'giveaway.reroll': 'events',
  'giveaway.cancel': 'events',
  'poll.create': 'events',
  'poll.end': 'events',
  // ── Boutique ──
  'shop.product.add': 'shop',
  'shop.product.edit': 'shop',
  'shop.product.remove': 'shop',
  'shop.order.create': 'shop',
  'shop.order.status': 'shop',
  'shop.tebex.update': 'shop',
  'shop.tebex.create': 'shop',
  // ── Battle Royale (stats, classement, Battle Pass, liaison des comptes) ──
  'br.display.update': 'battleroyale',
  'br.season.new': 'battleroyale',
  'br.season.set': 'battleroyale',
  'br.season.tiers': 'battleroyale',
  'br.admin.set': 'battleroyale',
  'br.admin.xp': 'battleroyale',
  'fivem.link.auto': 'battleroyale',
  'fivem.link.manual': 'battleroyale',
  // ── School RP ──
  'school.register': 'school',
  'school.class.create': 'school',
  'school.class.delete': 'school',
  'school.class.update': 'school',
  'school.class.assign': 'school',
  'school.house.create': 'school',
  'school.house.delete': 'school',
  'school.house.update': 'school',
  'school.house.assign': 'school',
  'school.house.points.add': 'school',
  'school.house.points.remove': 'school',
  'school.club.create': 'school',
  'school.club.delete': 'school',
  'school.club.update': 'school',
  'school.club.join': 'school',
  'school.apply': 'school',
  'school.application.accept': 'school',
  'school.application.reject': 'school',
  'school.announce': 'school',
  // ── Configuration du bot (/config, dashboard, permissions, hub) ──
  'settings.update': 'bot.config',
  'module.enable': 'bot.config',
  'module.disable': 'bot.config',
  'commands.permissions': 'bot.config',
  'config.change': 'bot.config',
  'dashboard.change': 'bot.config',
  'hub.link': 'bot.config',
  'hub.unlink': 'bot.config',
  'hub.template': 'bot.config',
  // ── Bot (démarrage, erreurs, déploiements) : section générale uniquement ──
  'bot.startup': 'bot.system',
  'bot.error': 'bot.system',
  'bot.deploy': 'bot.system',
  'bot.guild_join': 'bot.system',
  'bot.guild_leave': 'bot.system',
  // ── Logs en jeu (POST /logs, sanctions jeu, statut des serveurs) ──
  'game.connect': 'game.connections',
  'game.disconnect': 'game.connections',
  'game.account': 'game.accounts',
  'game.kill': 'game.kills',
  'game.death': 'game.kills',
  'game.match_start': 'game.matches',
  'game.match_end': 'game.matches',
  'game.ban': 'game.sanctions',
  'game.kick': 'game.sanctions',
  'game.warn': 'game.sanctions',
  'game.unban': 'game.sanctions',
  'game.admin': 'game.admin',
  'game.chat': 'game.chat',
  'game.anticheat': 'game.anticheat',
  'game.server': 'game.server',
  'game.custom': 'game.server',
};

/** Route de repli par catégorie (action inconnue, ou salon fin absent du hub). */
export const CATEGORY_ROUTES: Readonly<Record<LogCategory, SourceRouteKey>> = {
  MESSAGE: 'message.deleted',
  MEMBER: 'member.join',
  ROLE: 'server.roles',
  CHANNEL: 'server.channels',
  VOICE: 'voice',
  MODERATION: 'mod.sanctions',
  TICKET: 'tickets',
  WHITELIST: 'whitelist',
  ANNOUNCEMENT: 'announcements',
  SHOP: 'shop',
  BATTLE_ROYALE: 'battleroyale',
  SCHOOL: 'school',
  SECURITY: 'security.alerts',
  SYSTEM: 'bot.config',
  GAME: 'fivem.sync',
};

/** Route « système » d'une section Discord : dernier repli avant la section générale. */
export const SOURCE_SYSTEM_ROUTE: SourceRouteKey = 'bot.config';
/** Route « système » d'une section de jeu. */
export const GAME_SYSTEM_ROUTE: GameRouteKey = 'game.server';

/**
 * Actions Discord liées à un serveur de jeu (`entry.game` fourni) : copie aussi dans la section du jeu.
 * Les sanctions prises en jeu ont leur propre entrée `game.*` (FiveMSyncService.handleSanction) : pas de doublon ici.
 */
export const SOURCE_ACTION_GAME_ROUTES: Readonly<Record<string, GameRouteKey>> = {
  'fivem.maintenance.on': 'game.server',
  'fivem.maintenance.off': 'game.server',
  'fivem.link.auto': 'game.accounts',
};

/** Copies dans la section générale : sanctions, alertes de sécurité, bot (démarrage, erreurs, configuration). */
export const GLOBAL_MIRRORS: Readonly<Partial<Record<LogRouteKey, GlobalRouteKey>>> = {
  'mod.sanctions': 'global.sanctions',
  'game.sanctions': 'global.sanctions',
  'security.alerts': 'global.security',
  'game.anticheat': 'global.security',
  'bot.config': 'global.system',
  'bot.system': 'global.system',
};

/** Routes qui n'ont pas de salon dans la section d'une source : uniquement la section générale. */
export const GLOBAL_ONLY_ROUTES: ReadonlySet<LogRouteKey> = new Set<LogRouteKey>(['bot.system']);

export interface ResolvedRoute {
  route: LogRouteKey;
  /** false : action absente de la table, route déduite de la catégorie */
  explicit: boolean;
}

/** Route d'une action (repli : route de la catégorie). */
export function routeForAction(action: string, category: LogCategory): ResolvedRoute {
  const route = ACTION_ROUTES[action];
  if (route) return { route, explicit: true };
  if (action.startsWith('game.')) return { route: GAME_SYSTEM_ROUTE, explicit: false };
  return { route: CATEGORY_ROUTES[category] ?? SOURCE_SYSTEM_ROUTE, explicit: false };
}

/** Vrai si l'action est un log en jeu (section du serveur de jeu uniquement). */
export const isGameAction = (action: string): boolean => action.startsWith('game.');
