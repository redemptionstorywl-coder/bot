import type { GuildKind, LogCategory } from '@prisma/client';
import type { EmbedSpec } from '../services/EmbedService';

/** Texte en français + anglais (contenu des templates, pas de l'interface). */
export interface Bilingual {
  fr: string;
  en: string;
}

export interface BilingualEmbed {
  fr: EmbedSpec;
  en: EmbedSpec;
}

export interface TemplateQuestion {
  id: string;
  label: Bilingual;
  placeholder?: Bilingual;
  style?: 'short' | 'paragraph';
  required?: boolean;
}

export interface TemplateTicketType {
  key: string;
  emoji: string;
  label: Bilingual;
  description: Bilingual;
  /** Noms de catégories Discord existantes acceptés (normalisés). */
  categoryNames: string[];
  /** Si aucune catégorie trouvée : nom de la catégorie à créer (sinon le type est créé sans catégorie). */
  createCategoryName?: string;
  staffRoleNames: string[];
  questions: TemplateQuestion[];
}

export interface TemplateNotification {
  key: string;
  emoji: string;
  label: Bilingual;
}

export interface TemplateInfoMessage {
  key: string;
  channelNames: string[];
  embeds: BilingualEmbed;
  /** Si vrai et qu'aucun salon ne correspond, l'étape est omise du plan (au lieu d'être ignorée). */
  optional?: boolean;
}

/** Type Discord du salon à créer. `announcement` et `forum` retombent sur un salon texte hors serveur communautaire. */
export type StructureChannelType = 'text' | 'announcement' | 'voice' | 'forum';

/**
 * Permissions appliquées à un salon créé par la structure :
 *  - `readonly` : @everyone lit mais n'écrit pas (le bot et le staff écrivent) ;
 *  - `chat` : tout le monde écrit (hérite de la catégorie) ;
 *  - `staff` : visible uniquement par les rôles staff / admin résolus et 🛡️ RS Team ;
 *  - `voice` : vocal (hérite de la catégorie) ;
 *  - `support-voice` : vocal public limité à quelques utilisateurs (support en direct).
 */
export type StructurePreset = 'readonly' | 'chat' | 'staff' | 'voice' | 'support-voice';

/**
 * Accès d'une catégorie : `public` (hérite), `staff` (rôles staff uniquement), `tickets` (staff uniquement ; les
 * tickets ajoutent leurs créateurs individuellement), `languages` (catégorie créée vide, salons gérés par LanguageService).
 */
export type StructureCategoryAccess = 'public' | 'staff' | 'tickets' | 'languages';

export interface StructureChannel {
  /** Clé stable (`welcome`, `rules`, `payment`, `ticket`, `staffChat`…), reprise dans les rapports. */
  key: string;
  /** Nom créé si aucun salon ne correspond (ex. `💳・payment-methods`). */
  name: string;
  type: StructureChannelType;
  preset: StructurePreset;
  /** Synonymes reconnus (normalisés) pour réutiliser un salon existant plutôt que d'en créer un. */
  aliases?: string[];
  topic?: Bilingual;
}

export interface StructureCategory {
  key: string;
  name: string;
  roleAccess: StructureCategoryAccess;
  aliases?: string[];
  channels: StructureChannel[];
}

/** Structure complète (catégories + salons) déployée en premier par l'étape `structure`. */
export interface TemplateStructure {
  categories: StructureCategory[];
}

/**
 * Modèle déclaratif de serveur. Tout est résolu par NOM de salon / rôle (normalisé :
 * minuscules, sans emoji, séparateurs ni accents). Chaque cible accepte plusieurs synonymes.
 * Les placeholders `{channel:<clé>}` des textes sont remplacés par la mention du salon résolu.
 */
export interface ServerTemplate {
  key: string;
  emoji: string;
  kind: GuildKind;
  defaultLanguage: string;
  enabledLanguages: string[];
  staffRoleNames: string[];
  adminRoleNames: string[];
  /** Autorole JOIN */
  memberRoleNames: string[];
  /** Autorole BOT */
  botRoleNames: string[];
  muteRoleNames?: string[];
  /** Cibles nommées supplémentaires pour les placeholders `{channel:<clé>}` (ex. announcements, support). */
  channels: Record<string, string[]>;
  welcome: {
    channelNames: string[];
    message: Bilingual;
    embed: BilingualEmbed;
    image: boolean;
    dm?: Bilingual;
  };
  leave?: {
    channelNames: string[];
    message: Bilingual;
  };
  rules: {
    channelNames: string[];
    embeds: BilingualEmbed;
  };
  logChannels: Partial<Record<LogCategory, string[]>>;
  /** Salons recommandés (non persistés : rappelés dans le rapport). */
  recommended: Partial<Record<'giveaways' | 'polls' | 'events', string[]>>;
  tickets: {
    types: TemplateTicketType[];
    panel: { channelNames: string[]; style: 'BUTTONS' | 'SELECT'; embed: EmbedSpec };
  };
  notifications: {
    items: TemplateNotification[];
    panelChannelNames: string[];
  };
  language: {
    /** Salon du panneau de langue ; à défaut le salon de bienvenue est utilisé. */
    panelChannelNames: string[];
    /** Créer les salons d'annonces par langue manquants (catégorie 📢 Annonces). */
    announcements: boolean;
    /** Salons existants par langue (code → noms) mappés sur `languageChannels`. */
    channelNames?: Record<string, string[]>;
  };
  fivem?: { statusChannelNames: string[] };
  infoMessages: TemplateInfoMessage[];
  /** Catégories et salons créés s'ils manquent (option `create_missing`), avant toutes les autres étapes. */
  structure: TemplateStructure;
}
