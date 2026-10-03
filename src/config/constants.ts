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
  'language',
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
  language: '🌍 Multilingue',
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
  GENERIC: { language: true, welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true },
  PRISON: { language: true, welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, whitelist: true, fivem: true },
  BATTLE_ROYALE: { language: true, welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, fivem: true, battleRoyale: true },
  SCHOOL: { language: true, welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, whitelist: true, fivem: true, school: true },
  SHOP: { language: true, welcome: true, leave: true, autorole: true, rolemenu: true, reactionrole: true, notifications: true, tickets: true, moderation: true, antiraid: true, logs: true, announcements: true, embeds: true, events: true, giveaways: true, polls: true, shop: true },
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
  /** Code Discord (Locale) pour les traductions de commandes */
  discordLocale?: string;
  rtl?: boolean;
  /** ID de rôle par défaut (Battle Royale) — modifiable par serveur via LanguageRole */
  defaultRoleId?: string;
}

/** Langues supportées. Pour en ajouter une : ajouter ici + créer src/locales/<code>.json */
export const LANGUAGES: LanguageDefinition[] = [
  { code: 'fr', label: 'French', nativeLabel: 'Français', flag: '🇫🇷', discordLocale: 'fr', defaultRoleId: '1553402752879693824' },
  { code: 'en', label: 'English', nativeLabel: 'English', flag: '🇺🇸', discordLocale: 'en-US', defaultRoleId: '1553403814088806442' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', flag: '🇪🇸', discordLocale: 'es-ES', defaultRoleId: '1553403895571554455' },
  { code: 'de', label: 'German', nativeLabel: 'German', flag: '🇩🇪', discordLocale: 'de', defaultRoleId: '1553403983425437706' },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano', flag: '🇮🇹', discordLocale: 'it', defaultRoleId: '1553404038970867952' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', flag: '🇸🇦', rtl: true, defaultRoleId: '1553404184747970690' },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский', flag: '🇷🇺', discordLocale: 'ru', defaultRoleId: '1553404265618210936' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', flag: '🇧🇷', discordLocale: 'pt-BR', defaultRoleId: '1553405303033167892' },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', flag: '🇹🇷', discordLocale: 'tr', defaultRoleId: '1553405405953134632' },
  { code: 'pl', label: 'Polish', nativeLabel: 'Polski', flag: '🇵🇱', discordLocale: 'pl', defaultRoleId: '1553405565072580749' },
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
  '{language}': 'Langue de l’utilisateur',
  '{avatar}': 'URL de l’avatar',
  '{date}': 'Date du jour',
  '{time}': 'Heure actuelle',
};

export const COOLDOWN_DEFAULT_SECONDS = 3;
export const SCHEDULER_INTERVAL_MS = 15_000;
export const CACHE_TTL_MS = 5 * 60_000;
