import { MODULE_KEYS, type ModuleKey } from '../../src/config/constants';

export type ModuleGroup = 'community' | 'support' | 'security' | 'game';

export interface ModuleInfo {
  key: ModuleKey;
  /** Libellé sans emoji (interface) */
  label: string;
  icon: string;
  description: string;
  group: ModuleGroup;
  /** Page du dashboard qui configure ce module (segment après /guilds/:id) */
  path?: string;
}

/** Description des modules (grille « Modules » des paramètres, vue d'ensemble). */
export const MODULE_INFO: Record<ModuleKey, Omit<ModuleInfo, 'key'>> = {
  welcome: { label: 'Bienvenue', icon: 'hand', description: 'Message, image et DM d’accueil des nouveaux membres.', group: 'community', path: 'welcome' },
  leave: { label: 'Départ', icon: 'log-out', description: 'Message envoyé quand un membre quitte le serveur.', group: 'community', path: 'welcome' },
  autorole: { label: 'Auto-rôles', icon: 'user-plus', description: 'Rôles attribués automatiquement à l’arrivée.', group: 'community', path: 'roles' },
  rolemenu: { label: 'Menus de rôles', icon: 'tags', description: 'Boutons et menus pour que les membres choisissent leurs rôles.', group: 'community', path: 'roles' },
  reactionrole: { label: 'Reaction roles', icon: 'smile-plus', description: 'Rôles obtenus en réagissant à un message.', group: 'community', path: 'reaction-roles' },
  notifications: { label: 'Notifications', icon: 'bell', description: 'Rôles de notification à mentionner (annonces, événements…).', group: 'community', path: 'roles' },
  announcements: { label: 'Annonces', icon: 'megaphone', description: 'Annonces mises en forme, programmées et publiées.', group: 'community', path: 'announcements' },
  embeds: { label: 'Embeds', icon: 'layout-template', description: 'Créateur d’embeds réutilisables avec boutons.', group: 'community', path: 'embeds' },
  events: { label: 'Événements', icon: 'calendar', description: 'Événements avec inscriptions et rappels automatiques.', group: 'community', path: 'events' },
  giveaways: { label: 'Giveaways', icon: 'gift', description: 'Tirages au sort avec conditions de participation.', group: 'community', path: 'giveaways' },
  polls: { label: 'Sondages', icon: 'bar-chart', description: 'Sondages à choix multiples, anonymes ou non.', group: 'community', path: 'events' },
  tickets: { label: 'Tickets', icon: 'ticket', description: 'Support privé : raisons, formulaires, panneaux et transcripts.', group: 'support', path: 'tickets' },
  moderation: { label: 'Modération', icon: 'shield', description: 'Sanctions, avertissements et seuils automatiques.', group: 'security', path: 'moderation' },
  antiraid: { label: 'Anti-raid', icon: 'shield-alert', description: 'Protection contre les raids, anti-nuke et salon piège.', group: 'security', path: 'moderation' },
  logs: { label: 'Logs', icon: 'scroll-text', description: 'Journal des événements du serveur dans vos salons.', group: 'security', path: 'logs' },
  whitelist: { label: 'Whitelist', icon: 'clipboard-check', description: 'Candidatures whitelist avec formulaire et validation.', group: 'game', path: 'whitelist' },
  fivem: { label: 'FiveM', icon: 'gamepad', description: 'Statut des serveurs, joueurs et synchronisation Discord.', group: 'game', path: 'fivem' },
  battleRoyale: { label: 'Battle Royale', icon: 'swords', description: 'Classements, saisons et Battle Pass.', group: 'game', path: 'battle-royale' },
  school: { label: 'School RP', icon: 'graduation-cap', description: 'Élèves, classes, maisons et clubs.', group: 'game', path: 'school' },
  shop: { label: 'Shop', icon: 'shopping-bag', description: 'Boutique, commandes et intégration Tebex.', group: 'game', path: 'shop' },
};

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  community: 'Communauté',
  support: 'Support',
  security: 'Sécurité',
  game: 'Jeu',
};

export interface ModuleCard extends ModuleInfo {
  enabled: boolean;
}

/** Modules groupés pour l'affichage (ordre de MODULE_KEYS conservé dans chaque groupe). */
export function groupedModules(modules: Partial<Record<ModuleKey, boolean>>): { key: ModuleGroup; label: string; modules: ModuleCard[] }[] {
  return (Object.keys(MODULE_GROUP_LABELS) as ModuleGroup[]).map((group) => ({
    key: group,
    label: MODULE_GROUP_LABELS[group],
    modules: MODULE_KEYS.filter((k) => MODULE_INFO[k].group === group).map((k) => ({ key: k, ...MODULE_INFO[k], enabled: Boolean(modules[k]) })),
  }));
}

/** Types de serveur (paramètres) : libellé sans emoji, icône, description. */
export const GUILD_KIND_INFO: Record<string, { label: string; icon: string; description: string }> = {
  GENERIC: { label: 'Générique', icon: 'users', description: 'Communauté classique : bienvenue, rôles, tickets, modération.' },
  PRISON: { label: 'Prison RP (WL)', icon: 'lock', description: 'Whitelist et FiveM activés par défaut.' },
  BATTLE_ROYALE: { label: 'Battle Royale', icon: 'swords', description: 'Classements, saisons, Battle Pass et FiveM.' },
  SCHOOL: { label: 'School RP', icon: 'graduation-cap', description: 'Élèves, classes, maisons, clubs, whitelist et FiveM.' },
  SHOP: { label: 'Shop', icon: 'shopping-bag', description: 'Boutique, commandes et intégration Tebex.' },
};

/** Fuseaux horaires proposés (saisie libre possible). */
export function timezoneList(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (all && all.length) return all;
  } catch {
    /* ignoré */
  }
  return ['Europe/Paris', 'Europe/Brussels', 'Europe/Zurich', 'Europe/London', 'America/Montreal', 'America/New_York', 'UTC'];
}
