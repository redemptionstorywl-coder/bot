import type { ModuleKey } from '../../src/config/constants';

export interface NavEntry {
  /** Clé unique — correspond à `page` passé à render() pour l'état actif */
  key: string;
  label: string;
  /** Emoji ou SVG inline sobre */
  icon: string;
  /** Segment d'URL après /guilds/:guildId (vide = dashboard du serveur) ; `null` pour les entrées globales */
  path: string | null;
  /** Module requis : affiché atténué si désactivé sur le serveur */
  module?: ModuleKey;
  /** Entrée réservée aux propriétaires du bot (OWNER_IDS) */
  ownerOnly?: boolean;
  /** Groupe d'affichage dans la sidebar */
  group: 'general' | 'modules' | 'advanced' | 'global';
}

/**
 * Menu latéral. Pour ajouter une page : ajouter une entrée ici (clé + chemin),
 * créer la route dans routes/guild/<page>.ts et la vue views/pages/<page>.ejs.
 * Tant qu'aucune route dédiée n'existe, routes/guild/coming.ts sert la page générique.
 */
export const NAVIGATION: NavEntry[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊', path: '', group: 'general' },
  { key: 'guilds', label: 'Serveurs', icon: '🗂️', path: null, group: 'general' },
  { key: 'members', label: 'Membres', icon: '👥', path: 'members', group: 'general' },
  { key: 'tickets', label: 'Tickets', icon: '🎫', path: 'tickets', module: 'tickets', group: 'modules' },
  { key: 'embeds', label: 'Embeds', icon: '🎨', path: 'embeds', module: 'embeds', group: 'modules' },
  { key: 'announcements', label: 'Annonces', icon: '📢', path: 'announcements', module: 'announcements', group: 'modules' },
  { key: 'welcome', label: 'Bienvenue', icon: '👋', path: 'welcome', module: 'welcome', group: 'modules' },
  { key: 'roles', label: 'Rôles', icon: '🎭', path: 'roles', module: 'rolemenu', group: 'modules' },
  { key: 'reactionroles', label: 'Reaction Roles', icon: '🔘', path: 'reaction-roles', module: 'reactionrole', group: 'modules' },
  { key: 'logs', label: 'Logs', icon: '📜', path: 'logs', module: 'logs', group: 'modules' },
  { key: 'moderation', label: 'Modération', icon: '🛡️', path: 'moderation', module: 'moderation', group: 'modules' },
  { key: 'giveaways', label: 'Giveaways', icon: '🎁', path: 'giveaways', module: 'giveaways', group: 'modules' },
  { key: 'events', label: 'Événements', icon: '📅', path: 'events', module: 'events', group: 'modules' },
  { key: 'fivem', label: 'FiveM', icon: '🎮', path: 'fivem', module: 'fivem', group: 'modules' },
  { key: 'whitelist', label: 'Whitelist', icon: '📝', path: 'whitelist', module: 'whitelist', group: 'modules' },
  { key: 'battleRoyale', label: 'Battle Royale', icon: '⚔️', path: 'battle-royale', module: 'battleRoyale', group: 'modules' },
  { key: 'school', label: 'School RP', icon: '🎓', path: 'school', module: 'school', group: 'modules' },
  { key: 'shop', label: 'Shop', icon: '🛒', path: 'shop', module: 'shop', group: 'modules' },
  { key: 'settings', label: 'Paramètres', icon: '⚙️', path: 'settings', group: 'advanced' },
  { key: 'admin', label: 'Administration', icon: '🛠️', path: null, ownerOnly: true, group: 'global' },
];

export const NAV_GROUP_LABELS: Record<NavEntry['group'], string> = {
  general: 'Général',
  modules: 'Modules',
  advanced: 'Avancé',
  global: 'Global',
};

/** Pages disposant d'un routeur dédié dans routes/guild/ (retirer une clé ici dès que sa page existe). */
const IMPLEMENTED_MODULE_PAGES = new Set(['logs', 'tickets', 'embeds', 'announcements', 'welcome', 'roles', 'reactionroles', 'moderation', 'giveaways', 'events', 'fivem', 'whitelist', 'battleRoyale', 'school', 'shop']);

/** Pages de modules servies par la page générique « en cours d'intégration » tant qu'aucune route dédiée n'existe (vide : toutes les pages sont implémentées). */
export const PENDING_MODULE_PAGES: NavEntry[] = NAVIGATION.filter((e) => e.group === 'modules' && !IMPLEMENTED_MODULE_PAGES.has(e.key));

export function navHref(entry: NavEntry, guildId: string | null): string {
  if (entry.key === 'guilds') return '/guilds';
  if (entry.key === 'admin') return '/admin';
  if (!guildId || entry.path === null) return '/guilds';
  return entry.path ? `/guilds/${guildId}/${entry.path}` : `/guilds/${guildId}`;
}
