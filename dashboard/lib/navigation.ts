import type { GuildKind } from '@prisma/client';
import { DEFAULT_MODULES_BY_KIND, type ModuleKey } from '../../src/config/constants';

export type NavGroupKey = 'overview' | 'community' | 'support' | 'security' | 'game' | 'server';

export interface NavEntry {
  /** Clé unique — correspond à `page` passé à render() pour l'état actif */
  key: string;
  label: string;
  /** Nom d'icône (lib/icons.ts) */
  icon: string;
  /** Segment d'URL après /guilds/:guildId (vide = vue d'ensemble) */
  path: string;
  /** Module associé : entrée atténuée s'il est désactivé ; pour le groupe Jeu, rangée sous « Autres modules » si non pertinente */
  module?: ModuleKey;
  group: NavGroupKey;
  /** Mots-clés supplémentaires pour la palette de commandes */
  keywords?: string;
}

/**
 * Menu latéral, groupé par intention. Les pages secondaires d'un module (reaction roles, giveaways, sondages…) sont des onglets
 * de leur page principale et passent la clé de celle-ci (`page: 'roles'`, `page: 'events'`).
 * Pour ajouter une page : ajouter une entrée ici, créer la route dans routes/guild/<page>.ts (montée dans routes/index.ts)
 * et la vue views/pages/<page>.ejs, puis passer `page: '<key>'` à render().
 */
export const NAVIGATION: NavEntry[] = [
  { key: 'dashboard', label: "Vue d'ensemble", icon: 'layout-dashboard', path: '', group: 'overview', keywords: 'accueil tableau de bord statistiques mise en route' },
  { key: 'welcome', label: 'Bienvenue et départs', icon: 'hand', path: 'welcome', module: 'welcome', group: 'community', keywords: 'arrivée accueil message image départ au revoir' },
  { key: 'roles', label: 'Rôles', icon: 'tags', path: 'roles', module: 'rolemenu', group: 'community', keywords: 'auto-rôles menus de rôles réaction notifications' },
  { key: 'announcements', label: 'Annonces', icon: 'megaphone', path: 'announcements', module: 'announcements', group: 'community', keywords: 'publier programmer news' },
  { key: 'embeds', label: 'Embeds', icon: 'layout-template', path: 'embeds', module: 'embeds', group: 'community', keywords: 'messages enrichis modèles templates' },
  { key: 'events', label: 'Événements', icon: 'calendar', path: 'events', module: 'events', group: 'community', keywords: 'sondages giveaways tirage au sort inscriptions' },
  { key: 'tickets', label: 'Tickets', icon: 'ticket', path: 'tickets', module: 'tickets', group: 'support', keywords: 'support raisons panneaux transcripts relances' },
  { key: 'moderation', label: 'Modération', icon: 'shield', path: 'moderation', module: 'moderation', group: 'security', keywords: 'sanctions avertissements anti-raid anti-nuke lockdown salon piège bannis' },
  { key: 'logs', label: 'Logs', icon: 'scroll-text', path: 'logs', module: 'logs', group: 'security', keywords: 'journal historique salons de logs' },
  { key: 'fivem', label: 'Serveurs FiveM', icon: 'gamepad', path: 'fivem', module: 'fivem', group: 'game', keywords: 'jeu joueurs statut rs_bridge synchronisation' },
  { key: 'battleRoyale', label: 'Battle Royale', icon: 'swords', path: 'battle-royale', module: 'battleRoyale', group: 'game', keywords: 'classement saisons battle pass' },
  { key: 'whitelist', label: 'Whitelist', icon: 'clipboard-check', path: 'whitelist', module: 'whitelist', group: 'game', keywords: 'candidatures dossiers formulaire' },
  { key: 'school', label: 'School RP', icon: 'graduation-cap', path: 'school', module: 'school', group: 'game', keywords: 'élèves classes maisons clubs' },
  { key: 'shop', label: 'Boutique', icon: 'shopping-bag', path: 'shop', module: 'shop', group: 'game', keywords: 'shop produits commandes tebex' },
  { key: 'members', label: 'Membres', icon: 'users', path: 'members', group: 'server', keywords: 'fiche membre historique' },
  { key: 'permissions', label: 'Permissions', icon: 'key', path: 'permissions', group: 'server', keywords: 'commandes rôles autorisés accès slash' },
  { key: 'settings', label: 'Paramètres', icon: 'settings', path: 'settings', group: 'server', keywords: 'type de serveur langue couleur équipe staff modules' },
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

/** Libellé du groupe d'une page (sur-titre des en-têtes de page). */
export function navGroupLabel(page: string | null | undefined): string | null {
  const entry = NAVIGATION.find((e) => e.key === page);
  if (!entry) return null;
  return entry.group === 'overview' ? "Vue d'ensemble" : NAV_GROUP_LABELS[entry.group];
}

/** Un module de jeu est pertinent s'il est recommandé pour le type de serveur ou déjà activé. */
export function isRelevant(entry: NavEntry, kind: GuildKind | string | null | undefined, modules: Partial<Record<ModuleKey, boolean>> | null): boolean {
  if (!entry.module || entry.group !== 'game') return true;
  if (modules?.[entry.module]) return true;
  const defaults = kind ? DEFAULT_MODULES_BY_KIND[kind as GuildKind] : undefined;
  return Boolean(defaults?.[entry.module]);
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
  /** Pages de jeu non pertinentes pour ce type de serveur (repliées sous « Autres modules ») */
  others: SidebarItem[];
  othersOpen: boolean;
}

/**
 * Construit le menu latéral d'un serveur : groupes ordonnés, état actif, modules désactivés atténués.
 * Les pages du groupe « Jeu » qui ne concernent pas le type de serveur (et dont le module est éteint) sont rangées sous « Autres modules ».
 */
export function buildSidebar(guildId: string, page: string | null, modules: Partial<Record<ModuleKey, boolean>> | null, kind?: GuildKind | string | null): Sidebar {
  const groups = new Map<NavGroupKey, SidebarGroup>();
  const others: SidebarItem[] = [];
  for (const entry of NAVIGATION) {
    const enabled = entry.module ? Boolean(modules?.[entry.module]) : true;
    const item: SidebarItem = { key: entry.key, label: entry.label, icon: entry.icon, href: navHref(entry, guildId), active: page === entry.key, dimmed: !enabled };
    if (entry.group === 'game' && !isRelevant(entry, kind ?? null, modules)) {
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

/** Raccourcis profonds de la palette de commandes (réglages précis d'une page). */
const PALETTE_SHORTCUTS: { label: string; parent: string; path: string; icon: string; keywords?: string }[] = [
  { label: 'Message de départ', parent: 'welcome', path: 'welcome?tab=leave', icon: 'log-out', keywords: 'au revoir quitter' },
  { label: 'Auto-rôles', parent: 'roles', path: 'roles', icon: 'user-plus', keywords: 'arrivée automatique' },
  { label: 'Menus de rôles', parent: 'roles', path: 'roles?tab=menus', icon: 'tags', keywords: 'boutons sélection' },
  { label: 'Rôles de notification', parent: 'roles', path: 'roles?tab=notifications', icon: 'bell', keywords: 'ping mention' },
  { label: 'Reaction roles', parent: 'roles', path: 'reaction-roles', icon: 'smile-plus', keywords: 'emoji réaction' },
  { label: 'Nouvelle annonce', parent: 'announcements', path: 'announcements/new', icon: 'plus', keywords: 'créer publier' },
  { label: 'Nouvel embed', parent: 'embeds', path: 'embeds/new', icon: 'plus', keywords: 'créer template' },
  { label: 'Sondages', parent: 'events', path: 'events?tab=polls', icon: 'bar-chart', keywords: 'vote' },
  { label: 'Giveaways', parent: 'events', path: 'giveaways', icon: 'gift', keywords: 'tirage concours' },
  { label: 'Nouvel événement', parent: 'events', path: 'events/new', icon: 'plus', keywords: 'créer soirée' },
  { label: 'Raisons de tickets', parent: 'tickets', path: 'tickets', icon: 'list', keywords: 'types catégories formulaire' },
  { label: 'Panneaux de tickets', parent: 'tickets', path: 'tickets/panels', icon: 'send', keywords: 'publier bouton' },
  { label: 'Relances du staff', parent: 'tickets', path: 'tickets/reminders', icon: 'bell', keywords: 'rappel 24 h permanent' },
  { label: 'Tickets ouverts', parent: 'tickets', path: 'tickets/list?status=open', icon: 'inbox', keywords: 'liste en cours' },
  { label: 'Statistiques des tickets', parent: 'tickets', path: 'tickets/stats', icon: 'bar-chart', keywords: 'temps de réponse' },
  { label: 'Sanctions', parent: 'moderation', path: 'moderation', icon: 'list', keywords: 'cas ban kick historique' },
  { label: 'Avertissements', parent: 'moderation', path: 'moderation?tab=warnings', icon: 'alert-triangle', keywords: 'warn' },
  { label: 'Escalade automatique', parent: 'moderation', path: 'moderation?tab=config', icon: 'zap', keywords: 'seuils mute' },
  { label: 'Anti-raid et anti-nuke', parent: 'moderation', path: 'moderation?tab=antiraid', icon: 'shield-check', keywords: 'protections spam liens' },
  { label: 'Salon piège', parent: 'moderation', path: 'moderation?tab=honeypot', icon: 'ban', keywords: 'honeypot spam bots' },
  { label: 'Lockdown', parent: 'moderation', path: 'moderation?tab=lockdown', icon: 'lock', keywords: 'verrouiller serveur raid' },
  { label: 'Débannir tout le monde', parent: 'moderation', path: 'moderation?tab=lockdown#danger-zone', icon: 'unlock', keywords: 'unban all bannis' },
  { label: 'Salons de logs', parent: 'logs', path: 'logs?tab=channels', icon: 'hash', keywords: 'catégorie configuration' },
  { label: 'Joueurs FiveM', parent: 'fivem', path: 'fivem?tab=players', icon: 'users', keywords: 'liaison discord' },
  { label: 'Installer rs_bridge', parent: 'fivem', path: 'fivem?tab=integration', icon: 'download', keywords: 'ressource lua clé api' },
  { label: 'Formulaire whitelist', parent: 'whitelist', path: 'whitelist?tab=config', icon: 'file-text', keywords: 'questions configuration' },
  { label: 'Produits de la boutique', parent: 'shop', path: 'shop?tab=products', icon: 'shopping-bag', keywords: 'articles prix' },
  { label: 'Commandes', parent: 'shop', path: 'shop?tab=orders', icon: 'inbox', keywords: 'achats paiement' },
  { label: 'Type de serveur', parent: 'settings', path: 'settings#type', icon: 'server', keywords: 'prison battle royale school shop' },
  { label: 'Langue et fuseau horaire', parent: 'settings', path: 'settings#langue', icon: 'globe', keywords: 'français anglais région' },
  { label: 'Couleur et pied de page des embeds', parent: 'settings', path: 'settings#apparence', icon: 'palette', keywords: 'marque footer' },
  { label: 'Rôles staff et administrateurs', parent: 'settings', path: 'settings#equipe', icon: 'user-check', keywords: 'équipe modérateurs' },
  { label: 'Activer ou couper des modules', parent: 'settings', path: 'settings#modules', icon: 'layers', keywords: 'modules on off' },
];

export interface PaletteEntry {
  label: string;
  hint: string;
  icon: string;
  href: string;
  keywords: string;
}

/** Entrées de la palette de commandes (Ctrl+K) pour un serveur : toutes les pages + raccourcis profonds. */
export function paletteEntries(guildId: string): PaletteEntry[] {
  const pages: PaletteEntry[] = NAVIGATION.map((e) => ({
    label: e.label,
    hint: e.group === 'overview' ? 'Page' : NAV_GROUP_LABELS[e.group] ?? 'Page',
    icon: e.icon,
    href: navHref(e, guildId),
    keywords: e.keywords ?? '',
  }));
  const deep: PaletteEntry[] = PALETTE_SHORTCUTS.map((s) => {
    const parent = NAVIGATION.find((e) => e.key === s.parent);
    return { label: s.label, hint: parent ? parent.label : '', icon: s.icon, href: `/guilds/${guildId}/${s.path}`, keywords: s.keywords ?? '' };
  });
  return [...pages, ...deep];
}
