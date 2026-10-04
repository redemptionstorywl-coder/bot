import { BRAND } from '../config/constants';
import type { EmbedSpec } from '../services/EmbedService';
import type { Bilingual, BilingualEmbed, TemplateQuestion } from './types';

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
