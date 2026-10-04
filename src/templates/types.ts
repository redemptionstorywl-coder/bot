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
}
