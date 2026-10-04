import { BRAND } from '../config/constants';
import type { EmbedSpec } from '../services/EmbedService';
import type { Bilingual, BilingualEmbed, StructureCategory, StructureCategoryAccess, StructureChannel, StructurePreset, TemplateInfoMessage, TemplateQuestion } from './types';

export const VIOLET = '#7C3AED';
export const FOOTER = BRAND.footer;

/** Marqueur d'idempotence ajouté au footer des messages publiés par un template. */
export function templateFooter(stepId: string): { text: string } {
  return { text: `${FOOTER} • template:${stepId}` };
}

/** Règlement complet (9 règles) avec une règle « langue » adaptée au serveur. */
export function rulesEmbeds(opts: { serverLabel: Bilingual; languageRule: Bilingual; extraRule?: Bilingual }): BilingualEmbed {
  const fr = [
    '**1. Respect** — Restez courtois envers tous les membres et l’équipe. Insultes, harcèlement, discrimination et menaces sont interdits.',
    '**2. Pas de publicité** — Aucune promotion de serveurs, boutiques, liens d’invitation ou services sans accord écrit de l’équipe.',
    '**3. Pas de spam** — Pas de messages répétés, de flood, de mentions abusives ni de majuscules excessives.',
    '**4. Contenu interdit** — Aucun contenu NSFW, gore, illégal ou choquant, en texte comme en image.',
    `**5. Langue des salons** — ${opts.languageRule.fr}`,
    '**6. Support** — Toute demande d’aide passe par un ticket ({channel:ticket}). Ne sollicitez pas l’équipe en message privé.',
    '**7. Comptes** — Le partage, la vente ou le prêt de compte est interdit ; chaque membre est responsable de son compte.',
    '**8. Identité** — Pas d’usurpation d’identité (membres, staff, Redemption Story Studio) ni de pseudos ou avatars trompeurs.',
    `**9. Sanctions** — Avertissement, mute, kick ou bannissement selon la gravité, à la discrétion de l’équipe. Les décisions se contestent uniquement via un ticket.${opts.extraRule ? `\n\n**10. ${opts.extraRule.fr}**` : ''}`,
  ].join('\n\n');
  const en = [
    '**1. Respect** — Stay courteous to every member and the team. Insults, harassment, discrimination and threats are forbidden.',
    '**2. No advertising** — No promotion of servers, shops, invite links or services without written approval from the team.',
    '**3. No spam** — No repeated messages, flooding, abusive mentions or excessive caps.',
    '**4. Forbidden content** — No NSFW, gore, illegal or shocking content, whether text or image.',
    `**5. Channel languages** — ${opts.languageRule.en}`,
    '**6. Support** — Every request for help goes through a ticket ({channel:ticket}). Do not DM the team.',
    '**7. Accounts** — Sharing, selling or lending accounts is forbidden; every member is responsible for their own account.',
    '**8. Identity** — No impersonation (members, staff, Redemption Story Studio) and no misleading nicknames or avatars.',
    `**9. Sanctions** — Warning, mute, kick or ban depending on severity, at the team’s discretion. Decisions can only be appealed through a ticket.${opts.extraRule ? `\n\n**10. ${opts.extraRule.en}**` : ''}`,
  ].join('\n\n');
  return {
    fr: { title: `📜 Règlement — ${opts.serverLabel.fr}`, description: `${fr}\n\nEn restant sur ce serveur, vous acceptez ce règlement. Merci de le respecter.`, color: VIOLET, footer: templateFooter('rules') },
    en: { title: `📜 Rules — ${opts.serverLabel.en}`, description: `${en}\n\nBy staying on this server you accept these rules. Thank you for respecting them.`, color: VIOLET, footer: { text: FOOTER } },
  };
}

/** Message + embed de bienvenue standard (liens vers règlement et tickets). */
export function welcomeContent(opts: { tagline: Bilingual; extraFields?: { fr: { name: string; value: string }; en: { name: string; value: string } }[] }): { message: Bilingual; embed: BilingualEmbed } {
  const fields = opts.extraFields ?? [];
  return {
    message: {
      fr: '👋 Bienvenue {user} sur **{server}** ! Nous sommes désormais **{memberCount}** membres.',
      en: '👋 Welcome {user} to **{server}**! We are now **{memberCount}** members.',
    },
    embed: {
      fr: {
        title: 'Bienvenue sur {server}',
        description: opts.tagline.fr,
        color: VIOLET,
        fields: [
          { name: '📜 Règlement', value: 'Lisez {channel:rules} avant de participer.', inline: true },
          { name: '🎫 Support', value: 'Besoin d’aide ? Ouvrez un ticket dans {channel:ticket}.', inline: true },
          ...fields.map((f) => ({ ...f.fr, inline: true })),
        ],
        footer: { text: FOOTER },
      },
      en: {
        title: 'Welcome to {server}',
        description: opts.tagline.en,
        color: VIOLET,
        fields: [
          { name: '📜 Rules', value: 'Please read {channel:rules} before taking part.', inline: true },
          { name: '🎫 Support', value: 'Need help? Open a ticket in {channel:ticket}.', inline: true },
          ...fields.map((f) => ({ ...f.en, inline: true })),
        ],
        footer: { text: FOOTER },
      },
    },
  };
}

/** Embed bilingue du panneau de tickets. */
export function ticketPanelEmbed(opts: { subtitle: Bilingual }): EmbedSpec {
  return {
    title: '🎫 Support — Tickets',
    description: `🇫🇷 ${opts.subtitle.fr}\nSélectionnez le sujet ci-dessous : un salon privé sera créé avec l’équipe.\n\n🇬🇧 ${opts.subtitle.en}\nPick a topic below: a private channel will be created with the team.`,
    color: VIOLET,
    footer: templateFooter('ticket_panel'),
  };
}

/** Embed bilingue (FR puis EN) pour un message d'information, le premier portant le marqueur du template. */
export function infoEmbeds(stepKey: string, fr: Omit<EmbedSpec, 'color' | 'footer'>, en: Omit<EmbedSpec, 'color' | 'footer'>): BilingualEmbed {
  return {
    fr: { ...fr, color: VIOLET, footer: templateFooter(`info:${stepKey}`) },
    en: { ...en, color: VIOLET, footer: { text: FOOTER } },
  };
}

export const QUESTION_DETAILS: TemplateQuestion = {
  id: 'details',
  label: { fr: 'Décrivez votre demande', en: 'Describe your request' },
  placeholder: { fr: 'Le plus de détails possible…', en: 'As many details as possible…' },
  style: 'paragraph',
  required: true,
};

export const QUESTION_ORDER: TemplateQuestion = {
  id: 'order',
  label: { fr: 'Numéro de commande / transaction', en: 'Order / transaction number' },
  placeholder: { fr: 'Ex. #1234 ou tbx-…', en: 'E.g. #1234 or tbx-…' },
  style: 'short',
  required: false,
};

export const QUESTION_PLAYER: TemplateQuestion = {
  id: 'player',
  label: { fr: 'Pseudo du joueur concerné', en: 'Reported player’s name' },
  placeholder: { fr: 'Pseudo en jeu ou Discord', en: 'In-game or Discord name' },
  style: 'short',
  required: true,
};

export const QUESTION_PROOF: TemplateQuestion = {
  id: 'proof',
  label: { fr: 'Preuves (liens, captures)', en: 'Evidence (links, screenshots)' },
  placeholder: { fr: 'Liens vers vos captures / clips', en: 'Links to your screenshots / clips' },
  style: 'paragraph',
  required: false,
};

export const QUESTION_STEPS: TemplateQuestion = {
  id: 'steps',
  label: { fr: 'Comment reproduire le bug ?', en: 'How to reproduce the bug?' },
  placeholder: { fr: 'Étapes, salon, heure…', en: 'Steps, channel, time…' },
  style: 'paragraph',
  required: true,
};

export const NOTIF = {
  announcements: { key: 'announcements', emoji: '🔔', label: { fr: 'Annonces', en: 'Announcements' } },
  giveaways: { key: 'giveaways', emoji: '🎁', label: { fr: 'Giveaways', en: 'Giveaways' } },
  updates: { key: 'updates', emoji: '🛠️', label: { fr: 'Mises à jour', en: 'Updates' } },
  shop: { key: 'shop', emoji: '🛒', label: { fr: 'Boutique', en: 'Shop' } },
  events: { key: 'events', emoji: '🎉', label: { fr: 'Événements', en: 'Events' } },
  tournament: { key: 'tournament', emoji: '🏆', label: { fr: 'Tournois', en: 'Tournaments' } },
  streams: { key: 'streams', emoji: '📺', label: { fr: 'Streams', en: 'Streams' } },
  whitelist: { key: 'whitelist', emoji: '📝', label: { fr: 'Whitelist', en: 'Whitelist' } },
} as const;

/** Synonymes génériques des salons standards. */
export const NAMES = {
  general: ['general-chat', 'general', 'chat', 'discussion'],
  screenshots: ['screenshots', 'clips-and-screenshots', 'clips', 'captures', 'media'],
  logs: ['logs', 'bot-logs', 'journal'],
  serverStatus: ['server-status', 'status', 'statut', 'stats', 'statistiques'],
  store: ['store', 'shop', 'boutique'],
  howToBuy: ['how-to-buy', 'comment-acheter', 'shop-info', 'guide-achat'],
  welcome: ['welcome', 'bienvenue', 'arrivees', 'arrivals'],
  rules: ['rules', 'reglement', 'regles', 'regulations'],
  announcements: ['announcements', 'annonces', 'news', 'announcement'],
  ticket: ['create-ticket', 'createticket', 'tickets', 'ticket', 'open-ticket', 'support-tickets', 'ouvrir-un-ticket'],
  giveaways: ['giveaways', 'giveaway', 'concours'],
  polls: ['polls', 'poll', 'sondages', 'sondage'],
  events: ['events', 'event', 'evenements', 'evenement'],
  support: ['support-chat', 'support', 'aide', 'help'],
  suggestions: ['suggestions', 'suggestion', 'idees', 'ideas'],
  bugs: ['bug-reports', 'bugs', 'bug', 'bug-report'],
  staffChat: ['staff-chat', 'staff', 'equipe', 'team-chat'],
  staffTasks: ['staff-tasks', 'tasks', 'taches'],
  bugManagement: ['bug-management', 'bug-tracking', 'gestion-bugs'],
  languages: ['langues', 'languages', 'language', 'choose-language', 'choisir-langue', 'choose-your-language'],
  notifications: ['notifications', 'notification-roles', 'roles', 'notifs', 'self-roles'],
  paymentMethods: ['payment-methods', 'payments', 'paiement', 'paiements', 'moyens-de-paiement'],
  leave: ['goodbye', 'leave', 'departs', 'au-revoir', 'welcome', 'bienvenue'],
} as const;

// ───────────────────────── Structure ─────────────────────────

type ChannelOpts = { aliases?: readonly string[]; topic?: Bilingual; type?: StructureChannel['type'] };

/** Salon de la structure (texte par défaut). */
export function ch(key: string, name: string, preset: StructurePreset, opts: ChannelOpts = {}): StructureChannel {
  return { key, name, type: opts.type ?? 'text', preset, ...(opts.aliases ? { aliases: [...opts.aliases] } : {}), ...(opts.topic ? { topic: opts.topic } : {}) };
}

export function voice(key: string, name: string, preset: 'voice' | 'support-voice' = 'voice'): StructureChannel {
  return { key, name, type: 'voice', preset };
}

export function forum(key: string, name: string, preset: StructurePreset, opts: Omit<ChannelOpts, 'type'> = {}): StructureChannel {
  return ch(key, name, preset, { ...opts, type: 'forum' });
}

/** Catégorie de la structure. */
export function cat(key: string, name: string, roleAccess: StructureCategoryAccess, channels: StructureChannel[], aliases?: readonly string[]): StructureCategory {
  return { key, name, roleAccess, channels, ...(aliases ? { aliases: [...aliases] } : {}) };
}

/** Catégorie de tickets (vide : les salons sont créés par le module tickets). */
export function ticketCategory(key: string, name: string, aliases?: readonly string[]): StructureCategory {
  return cat(key, name, 'tickets', [], aliases);
}

/** Salons standards partagés par les modèles. */
export const STD = {
  welcome: (name = '👋・welcome') => ch('welcome', name, 'readonly', { aliases: NAMES.welcome, topic: { fr: 'Bienvenue ! Choisissez votre langue et vos notifications ici.', en: 'Welcome! Pick your language and notifications here.' } }),
  rules: (name = '📜・rules') => ch('rules', name, 'readonly', { aliases: NAMES.rules, topic: { fr: 'Règlement du serveur — à lire avant de participer.', en: 'Server rules — read before taking part.' } }),
  announcements: (name = '📢・announcements') => ch('announcements', name, 'readonly', { type: 'announcement', aliases: NAMES.announcements, topic: { fr: 'Annonces officielles.', en: 'Official announcements.' } }),
  payment: (name = '💳・payment-methods') => ch('payment', name, 'readonly', { aliases: NAMES.paymentMethods, topic: { fr: 'Moyens de paiement acceptés et procédure.', en: 'Accepted payment methods and process.' } }),
  giveaways: (name = '🎁・giveaways') => ch('giveaways', name, 'readonly', { aliases: NAMES.giveaways, topic: { fr: 'Giveaways du serveur (`/giveaway create`).', en: 'Server giveaways (`/giveaway create`).' } }),
  polls: (name = '📊・polls') => ch('polls', name, 'readonly', { aliases: NAMES.polls, topic: { fr: 'Sondages (`/poll create`).', en: 'Polls (`/poll create`).' } }),
  events: (name = '📅・events') => ch('events', name, 'readonly', { aliases: NAMES.events, topic: { fr: 'Événements à venir (`/event create`).', en: 'Upcoming events (`/event create`).' } }),
  general: (name = '💬・general-chat') => ch('general', name, 'chat', { aliases: NAMES.general, topic: { fr: 'Discussion générale.', en: 'General discussion.' } }),
  suggestions: (name = '💡・suggestions') => ch('suggestions', name, 'chat', { aliases: NAMES.suggestions, topic: { fr: 'Vos idées pour améliorer le serveur.', en: 'Your ideas to improve the server.' } }),
  bugs: (name = '🐛・bug-reports') => ch('bugReports', name, 'chat', { aliases: NAMES.bugs, topic: { fr: 'Signalez un bug (ou ouvrez un ticket Bug).', en: 'Report a bug (or open a Bug ticket).' } }),
  ticket: (name = '🎫・create-ticket') => ch('ticket', name, 'readonly', { aliases: NAMES.ticket, topic: { fr: 'Ouvrez un ticket pour contacter l’équipe.', en: 'Open a ticket to contact the team.' } }),
  staffChat: (name = '🔒・staff-chat') => ch('staffChat', name, 'staff', { aliases: NAMES.staffChat, topic: { fr: 'Discussion de l’équipe. Reçoit aussi les logs non affectés.', en: 'Team discussion. Also receives unassigned logs.' } }),
  staffTasks: (name = '📋・staff-tasks') => ch('staffTasks', name, 'staff', { aliases: NAMES.staffTasks, topic: { fr: 'Tâches de l’équipe et logs des tickets.', en: 'Team tasks and ticket logs.' } }),
  bugManagement: (name = '🐛・bug-management') => ch('bugManagement', name, 'staff', { aliases: NAMES.bugManagement, topic: { fr: 'Suivi des bugs et logs système.', en: 'Bug tracking and system logs.' } }),
  logs: (name = '📜・logs') => ch('logs', name, 'staff', { aliases: NAMES.logs, topic: { fr: 'Logs du bot (membres, messages, rôles, salons, vocal).', en: 'Bot logs (members, messages, roles, channels, voice).' } }),
  serverStatus: (name = '📡・server-status') => ch('serverStatus', name, 'readonly', { aliases: NAMES.serverStatus, topic: { fr: 'Statut du serveur FiveM en direct.', en: 'Live FiveM server status.' } }),
} as const;

/**
 * Message d'information « moyens de paiement » (PayPal / carte via Tebex / crypto sur demande, délais, remboursements,
 * ticket Paiement). `optional` : omis du plan si aucun salon de paiement n'existe (School / Prison).
 */
export function paymentMethodsInfo(opts: { shopLabel: Bilingual; delivery: Bilingual; optional?: boolean; channelNames?: readonly string[] }): TemplateInfoMessage {
  return {
    key: 'payment-methods',
    channelNames: [...(opts.channelNames ?? NAMES.paymentMethods)],
    optional: opts.optional,
    embeds: infoEmbeds(
      'payment-methods',
      {
        title: '💳 Moyens de paiement',
        description: `Tous les achats passent par ${opts.shopLabel.fr}. Aucun paiement n’est jamais demandé en message privé : seuls les liens publiés par l’équipe dans ce serveur sont valides.`,
        fields: [
          { name: 'Moyens acceptés', value: '• **PayPal**\n• **Carte bancaire** (Visa, Mastercard, Apple Pay, Google Pay) via Tebex\n• **Crypto-monnaies** (BTC, ETH, USDT) sur demande, via un ticket', inline: false },
          { name: 'Délais de livraison', value: opts.delivery.fr, inline: false },
          { name: 'Remboursements', value: 'Produit numérique livré = pas de remboursement, sauf erreur de notre part (double paiement, produit non livré sous 24 h). Les demandes se font par ticket avec la preuve de paiement.', inline: false },
          { name: 'Un problème ?', value: 'Ouvrez un ticket **💳 Paiement** dans {channel:ticket} avec votre numéro de transaction.', inline: false },
        ],
      },
      {
        title: '💳 Payment methods',
        description: `Every purchase goes through ${opts.shopLabel.en}. We never ask for payment in DMs: only links posted by the team in this server are valid.`,
        fields: [
          { name: 'Accepted methods', value: '• **PayPal**\n• **Credit / debit card** (Visa, Mastercard, Apple Pay, Google Pay) via Tebex\n• **Crypto** (BTC, ETH, USDT) on request, through a ticket', inline: false },
          { name: 'Delivery times', value: opts.delivery.en, inline: false },
          { name: 'Refunds', value: 'Delivered digital goods are not refundable, except for an error on our side (double payment, product not delivered within 24 h). Requests go through a ticket with proof of payment.', inline: false },
          { name: 'Issue?', value: 'Open a **💳 Payment** ticket in {channel:ticket} with your transaction number.', inline: false },
        ],
      },
    ),
  };
}

export const ROLE_NAMES = {
  rsTeam: ['RS Team', '🛡️ RS Team'],
  support: ['Support', 'Helper', 'Modérateur', 'Moderator'],
  moderator: ['Moderator', 'Modérateur', 'Mod'],
  admin: ['Administrator', 'Admin', 'Administrateur'],
  manager: ['Manager', 'Community Manager', 'Responsable'],
  developer: ['Developer', 'Développeur', 'Dev'],
  member: ['Member', 'Membre', 'Player', 'Joueur', 'Citoyen', 'Étudiant', 'Student'],
  bot: ['Bot', 'Bots', '🤖 BOT'],
  muted: ['Muted', 'Mute', 'Sourdine'],
} as const;
