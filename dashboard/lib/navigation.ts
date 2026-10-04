import type { ModuleKey } from '../../src/config/constants';

export type NavGroupKey = 'overview' | 'community' | 'support' | 'security' | 'game' | 'server';

export interface NavEntry {
  /** Clé unique — correspond à `page` passé à render() pour l'état actif */
  key: string;
  label: string;
  /** Nom d'icône (lib/icons.ts) */
  icon: string;
  /** Segment d'URL après /guilds/:guildId (vide = vue d'ensemble) */
  path: string;
  /** Module associé : entrée atténuée (ou rangée sous « Autres modules » pour le groupe Jeu) s'il est désactivé */
  module?: ModuleKey;
  group: NavGroupKey;
}

/**
 * Menu latéral (groupé). Les pages secondaires d'un module (reaction roles, giveaways, sondages…) sont des onglets
 * de leur page principale et passent la clé de celle-ci (`page: 'roles'`, `page: 'events'`).
 * Pour ajouter une page : ajouter une entrée ici, créer la route dans
 * routes/guild/<page>.ts (montée dans routes/index.ts) et la vue views/pages/<page>.ejs, puis passer `page: '<key>'` à render().
 */
export const NAVIGATION: NavEntry[] = [
  { key: 'dashboard', label: "Vue d'ensemble", icon: 'layout-dashboard', path: '', group: 'overview' },
  { key: 'welcome', label: 'Bienvenue', icon: 'hand', path: 'welcome', module: 'welcome', group: 'community' },
  { key: 'roles', label: 'Rôles', icon: 'tags', path: 'roles', module: 'rolemenu', group: 'community' },
  { key: 'announcements', label: 'Annonces', icon: 'megaphone', path: 'announcements', module: 'announcements', group: 'community' },
  { key: 'embeds', label: 'Embeds', icon: 'layout-template', path: 'embeds', module: 'embeds', group: 'community' },
  { key: 'events', label: 'Événements', icon: 'calendar', path: 'events', module: 'events', group: 'community' },
  { key: 'tickets', label: 'Tickets', icon: 'ticket', path: 'tickets', module: 'tickets', group: 'support' },
  { key: 'moderation', label: 'Modération', icon: 'shield', path: 'moderation', module: 'moderation', group: 'security' },
  { key: 'logs', label: 'Logs', icon: 'scroll-text', path: 'logs', module: 'logs', group: 'security' },
  { key: 'fivem', label: 'FiveM', icon: 'gamepad', path: 'fivem', module: 'fivem', group: 'game' },
  { key: 'battleRoyale', label: 'Battle Royale', icon: 'swords', path: 'battle-royale', module: 'battleRoyale', group: 'game' },
  { key: 'whitelist', label: 'Whitelist', icon: 'clipboard-check', path: 'whitelist', module: 'whitelist', group: 'game' },
  { key: 'school', label: 'School RP', icon: 'graduation-cap', path: 'school', module: 'school', group: 'game' },
  { key: 'shop', label: 'Shop', icon: 'shopping-bag', path: 'shop', module: 'shop', group: 'game' },
  { key: 'members', label: 'Membres', icon: 'users', path: 'members', group: 'server' },
  { key: 'settings', label: 'Paramètres', icon: 'settings', path: 'settings', group: 'server' },
];

export const NAV_GROUP_LABELS: Record<NavGroupKey, string | null> = {
  overview: null,
  community: 'Communauté',
  support: 'Support',
  security: 'Sécurité',
  game: 'Jeu',
  server: 'Serveur',
};

const GROUP_ORDER: NavGroupKey[] = ['overview', 'community', 'support', 'security', 'game', 'server'];

export function navHref(entry: Pick<NavEntry, 'path'>, guildId: string): string {
  return entry.path ? `/guilds/${guildId}/${entry.path}` : `/guilds/${guildId}`;
}

export interface SidebarItem {
  key: string;
  label: string;
  icon: string;
  href: string;
  active: boolean;
  /** Module désactivé : entrée atténuée */
  dimmed: boolean;
}

export interface SidebarGroup {
  key: NavGroupKey;
  label: string | null;
  items: SidebarItem[];
}

export interface Sidebar {
  groups: SidebarGroup[];
  /** Pages de jeu dont le module est désactivé (repliées sous « Autres modules ») */
  others: SidebarItem[];
  othersOpen: boolean;
}

/**
 * Construit le menu latéral d'un serveur : groupes ordonnés, état actif, modules désactivés atténués.
 * Les pages du groupe « Jeu » n'apparaissent que si leur module est actif ; sinon elles sont rangées sous « Autres modules ».
 */
export function buildSidebar(guildId: string, page: string | null, modules: Partial<Record<ModuleKey, boolean>> | null): Sidebar {
  const groups = new Map<NavGroupKey, SidebarGroup>();
  const others: SidebarItem[] = [];
  for (const entry of NAVIGATION) {
    const enabled = entry.module ? Boolean(modules?.[entry.module]) : true;
    const item: SidebarItem = { key: entry.key, label: entry.label, icon: entry.icon, href: navHref(entry, guildId), active: page === entry.key, dimmed: !enabled };
    if (entry.group === 'game' && !enabled) {
      others.push(item);
      continue;
    }
    if (!groups.has(entry.group)) groups.set(entry.group, { key: entry.group, label: NAV_GROUP_LABELS[entry.group], items: [] });
    groups.get(entry.group)!.items.push(item);
  }
  return {
    groups: GROUP_ORDER.map((k) => groups.get(k)).filter((g): g is SidebarGroup => Boolean(g && g.items.length)),
    others,
    othersOpen: others.some((o) => o.active),
  };
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Fil d'Ariane : serveur › page › éléments supplémentaires (`crumbs` passés à render()).
 * Sans serveur : seuls les éléments supplémentaires (ex. « Serveurs »).
 */
export function buildBreadcrumbs(guild: { id: string; name: string } | null, page: string | null, extra: Crumb[] = []): Crumb[] {
  const out: Crumb[] = [];
  if (guild) {
    out.push({ label: guild.name, href: `/guilds/${guild.id}` });
    const entry = NAVIGATION.find((e) => e.key === page);
    if (entry && entry.key !== 'dashboard') out.push({ label: entry.label, href: navHref(entry, guild.id) });
  }
  out.push(...extra);
  if (out.length) delete out[out.length - 1]!.href;
  return out;
}
