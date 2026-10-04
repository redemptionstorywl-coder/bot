import { GuildKind } from '@prisma/client';

/** Identité visuelle Redemption Story Studio */
export const BRAND = {
  name: 'Redemption Story Studio',
  colors: {
    primary: 0x7c3aed, // violet identité
    dark: 0x111113, // noir
    anthracite: 0x2a2a2e,
    white: 0xf5f5f7,
    success: 0x7c3aed, // on reste sur le violet pour les succès (pas de vert criard)
    neutral: 0x3f3f46,
    danger: 0xef4444, // rouge uniquement pour les alertes
    warning: 0xf59e0b,
  },
  footer: 'Redemption Story Studio',
} as const;

/** Clés des modules activables / désactivables par serveur. */
export const MODULE_KEYS = [
  'welcome',
  'leave',
  'autorole',
  'rolemenu',
  'reactionrole',
  'notifications',
  'tickets',
  'moderation',
  'antiraid',
  'logs',
  'announcements',
  'embeds',
  'events',
  'giveaways',
  'polls',
  'whitelist',
  'fivem',
  'battleRoyale',
  'school',
  'shop',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  welcome: '👋 Bienvenue',
  leave: '👋 Départ',
  autorole: '🎭 Auto Role',
  rolemenu: '🎭 Role Menus',
  reactionrole: '🔘 Reaction Roles',
  notifications: '🔔 Notifications',
  tickets: '🎫 Tickets',
  moderation: '🛡️ Modération',
  antiraid: '🚨 Anti-Raid',
  logs: '📜 Logs',
  announcements: '📢 Annonces',
  embeds: '🎨 Embeds',
  events: '📅 Événements',
  giveaways: '🎁 Giveaways',
  polls: '📊 Sondages',
  whitelist: '📝 Whitelist',
  fivem: '🎮 FiveM',
  battleRoyale: '⚔️ Battle Royale',
  school: '🎓 School RP',
  shop: '🛒 Shop',
};

/** Modules activés par défaut selon le type de serveur. */
export const DEFAULT_MODULES_BY_KIND: Record<GuildKind, Partial<Record<ModuleKey, boolean>>> = {
  GENERIC: { welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true },
  PRISON: { welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, whitelist: true, fivem: true },
  BATTLE_ROYALE: { welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, fivem: true, battleRoyale: true },
  SCHOOL: { welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, whitelist: true, fivem: true, school: true },
  SHOP: { welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, shop: true },
};

export const GUILD_KIND_LABELS: Record<GuildKind, string> = {
  GENERIC: 'Générique',
  PRISON: '🔒 Redemption Story WL (Prison RP)',
  BATTLE_ROYALE: '⚔️ Redemption Story Battle Royale',
  SCHOOL: '🎓 Redemption Story School RP',
  SHOP: '🛒 Redemption Story Shop',
};

/** Alias acceptés par /guild-config */
export const GUILD_KIND_ALIASES: Record<string, GuildKind> = {
  prison: 'PRISON',
  wl: 'PRISON',
  'battle-royale': 'BATTLE_ROYALE',
  br: 'BATTLE_ROYALE',
  school: 'SCHOOL',
  shop: 'SHOP',
  generic: 'GENERIC',
};

export interface LanguageDefinition {
  code: string;
  label: string;
  nativeLabel: string;
  flag: string;
  /** Code Discord (Locale) */
  discordLocale?: string;
}

/** Langues de l'interface du bot (réponses, embeds). Une langue = src/locales/<code>/. */
export const LANGUAGES: LanguageDefinition[] = [
  { code: 'fr', label: 'French', nativeLabel: 'Français', flag: '🇫🇷', discordLocale: 'fr' },
  { code: 'en', label: 'English', nativeLabel: 'English', flag: '🇺🇸', discordLocale: 'en-US' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANGUAGE = 'fr';
export const FALLBACK_LANGUAGE = 'en';

export function getLanguage(code: string): LanguageDefinition | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** Convertit une locale Discord (fr, en-US, pt-BR…) en code langue interne. */
export function fromDiscordLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  const direct = LANGUAGES.find((l) => l.discordLocale === locale);
  if (direct) return direct.code;
  const short = locale.split('-')[0];
  return LANGUAGES.find((l) => l.code === short)?.code;
}

/** Catégories de logs disponibles et leur libellé. */
export const LOG_CATEGORY_LABELS: Record<string, string> = {
  MESSAGE: '💬 Messages',
  MEMBER: '👤 Membres',
  ROLE: '🎭 Rôles',
  CHANNEL: '📁 Salons',
  VOICE: '🔊 Vocal',
  MODERATION: '🛡️ Modération',
  TICKET: '🎫 Tickets',
  WHITELIST: '📝 Whitelist',
  ANNOUNCEMENT: '📢 Annonces',
  SHOP: '🛒 Shop',
  BATTLE_ROYALE: '⚔️ Battle Royale',
  SCHOOL: '🎓 School RP',
  SECURITY: '🚨 Sécurité',
  SYSTEM: '⚙️ Système',
};

/** Variables de template documentées (bienvenue, départ, annonces...). */
export const TEMPLATE_VARIABLES: Record<string, string> = {
  '{user}': 'Mention de l’utilisateur (<@id>)',
  '{username}': 'Nom d’utilisateur',
  '{displayName}': 'Pseudo affiché sur le serveur',
  '{tag}': 'Nom complet (username#0 ou @username)',
  '{server}': 'Nom du serveur',
  '{memberCount}': 'Nombre de membres',
  '{userId}': 'ID de l’utilisateur',
  '{createdAt}': 'Date de création du compte',
  '{joinedAt}': 'Date d’arrivée sur le serveur',
  '{language}': 'Langue du serveur',
  '{avatar}': 'URL de l’avatar',
  '{date}': 'Date du jour',
  '{time}': 'Heure actuelle',
};

/**
 * Rôles reconnus automatiquement comme équipe (niveau interne « admin ») sur tous les serveurs,
 * sans configuration : il suffit qu'un rôle porte l'un de ces noms.
 */
export const DEFAULT_TEAM_ROLE_NAMES = ['🛡️ RS Team', '🛡️・RS Team', 'RS Team'];

export const COOLDOWN_DEFAULT_SECONDS = 3;
export const SCHEDULER_INTERVAL_MS = 15_000;
export const CACHE_TTL_MS = 5 * 60_000;

/** Palette de couleurs proposée dans le créateur d'embeds (Discord + dashboard). */
export interface PaletteColor {
  key: string;
  hex: string;
  emoji: string;
}
export const EMBED_COLOR_PALETTE: PaletteColor[] = [
  { key: 'violet', hex: '#7C3AED', emoji: '🟣' },
  { key: 'purple_dark', hex: '#5B21B6', emoji: '🟣' },
  { key: 'lavender', hex: '#A78BFA', emoji: '🟣' },
  { key: 'blurple', hex: '#5865F2', emoji: '🔵' },
  { key: 'blue', hex: '#3B82F6', emoji: '🔵' },
  { key: 'cyan', hex: '#06B6D4', emoji: '🔵' },
  { key: 'teal', hex: '#14B8A6', emoji: '🟢' },
  { key: 'green', hex: '#22C55E', emoji: '🟢' },
  { key: 'lime', hex: '#84CC16', emoji: '🟢' },
  { key: 'yellow', hex: '#EAB308', emoji: '🟡' },
  { key: 'amber', hex: '#F59E0B', emoji: '🟠' },
  { key: 'orange', hex: '#F97316', emoji: '🟠' },
  { key: 'red', hex: '#EF4444', emoji: '🔴' },
  { key: 'crimson', hex: '#B91C1C', emoji: '🔴' },
  { key: 'pink', hex: '#EC4899', emoji: '🩷' },
  { key: 'rose', hex: '#F43F5E', emoji: '🩷' },
  { key: 'brown', hex: '#92400E', emoji: '🟤' },
  { key: 'gold', hex: '#D4AF37', emoji: '🟡' },
  { key: 'silver', hex: '#A1A1AA', emoji: '⚪' },
  { key: 'white', hex: '#F5F5F7', emoji: '⚪' },
  { key: 'anthracite', hex: '#2A2A2E', emoji: '⚫' },
  { key: 'black', hex: '#111113', emoji: '⚫' },
];
