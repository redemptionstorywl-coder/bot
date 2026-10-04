import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_PLAYER, QUESTION_PROOF, ROLE_NAMES, infoEmbeds, rulesEmbeds, ticketPanelEmbed, welcomeContent } from './common';
import type { ServerTemplate } from './types';

const STAFF = [...ROLE_NAMES.support, ...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam];
const TICKET_CATEGORY = ['tickets', 'ticket', 'support-tickets', 'support'];
const welcome = welcomeContent({
  tagline: {
    fr: 'Bienvenue sur **Redemption Story WL**, serveur Prison RP whitelist. Lisez le règlement, puis déposez votre candidature pour rejoindre la détention.',
    en: 'Welcome to **Redemption Story WL**, a whitelisted Prison RP server. Read the rules, then apply to join the facility.',
  },
  extraFields: [{ fr: { name: '📝 Whitelist', value: 'Candidature : {channel:whitelist} (`/whitelist apply`)' }, en: { name: '📝 Whitelist', value: 'Application: {channel:whitelist} (`/whitelist apply`)' } }],
});

export const prisonTemplate: ServerTemplate = {
  key: 'prison',
  emoji: '🔒',
  kind: 'PRISON',
  defaultLanguage: 'fr',
  enabledLanguages: ['fr', 'en'],
  staffRoleNames: ['Support', 'Moderator', 'Modérateur', 'Admin', 'Administrator', 'Developer', 'RS Team', 'Staff'],
  adminRoleNames: ['Admin', 'Administrator', 'Fondateur', 'Founder', 'RS Team'],
  memberRoleNames: ['Member', 'Membre', 'Visiteur', 'Visitor'],
  botRoleNames: [...ROLE_NAMES.bot],
  muteRoleNames: [...ROLE_NAMES.muted],
  channels: {
    announcements: [...NAMES.announcements],
    whitelist: ['whitelist', 'candidatures', 'candidature', 'applications', 'wl'],
    support: [...NAMES.support],
    suggestions: [...NAMES.suggestions],
    bugs: [...NAMES.bugs],
    events: [...NAMES.events],
  },
  welcome: { channelNames: [...NAMES.welcome], message: welcome.message, embed: welcome.embed, image: true },
  leave: {
    channelNames: [...NAMES.leave],
    message: { fr: '👋 **{username}** a quitté la détention. Nous sommes désormais {memberCount}.', en: '👋 **{username}** left the facility. We are now {memberCount}.' },
  },
  rules: {
    channelNames: [...NAMES.rules],
    embeds: rulesEmbeds({
      serverLabel: { fr: 'Redemption Story WL', en: 'Redemption Story WL' },
      languageRule: { fr: 'Le serveur est francophone ; l’anglais est toléré dans les salons communautaires.', en: 'The server is French-speaking; English is tolerated in community channels.' },
      extraRule: {
        fr: 'Roleplay** — Le RP se joue en jeu : pas de métagaming, de powergaming ni de règlement de comptes hors RP sur le Discord. Les signalements se font par ticket.',
        en: 'Roleplay** — RP happens in game: no metagaming, powergaming or out-of-character disputes on Discord. Reports go through tickets.',
      },
    }),
  },
  logChannels: {
    MODERATION: ['mod-logs', 'moderation', 'sanctions', ...NAMES.staffChat],
    WHITELIST: ['whitelist-logs', 'wl-logs', 'candidatures-staff', ...NAMES.staffChat],
    SECURITY: ['security-logs', 'securite', ...NAMES.staffChat],
    SYSTEM: [...NAMES.bugManagement, 'logs', ...NAMES.staffChat],
    TICKET: [...NAMES.staffTasks, 'ticket-logs', ...NAMES.staffChat],
    MEMBER: ['member-logs', 'logs', ...NAMES.staffChat],
    MESSAGE: ['message-logs', 'logs', ...NAMES.staffChat],
    ROLE: ['logs', ...NAMES.staffChat],
    CHANNEL: ['logs', ...NAMES.staffChat],
    VOICE: ['logs', ...NAMES.staffChat],
    ANNOUNCEMENT: [...NAMES.staffChat],
  },
  recommended: { giveaways: [...NAMES.giveaways], polls: [...NAMES.polls], events: [...NAMES.events] },
  tickets: {
    types: [
      {
        key: 'whitelist',
        emoji: '📝',
        label: { fr: 'Whitelist', en: 'Whitelist' },
        description: { fr: 'Question sur votre candidature', en: 'Question about your application' },
        categoryNames: TICKET_CATEGORY,
        createCategoryName: '🎫 Tickets',
        staffRoleNames: STAFF,
        questions: [QUESTION_DETAILS],
      },
      {
        key: 'support',
        emoji: '🎫',
        label: { fr: 'Support', en: 'Support' },
        description: { fr: 'Aide, question ou problème technique', en: 'Help, question or technical issue' },
        categoryNames: TICKET_CATEGORY,
        createCategoryName: '🎫 Tickets',
        staffRoleNames: STAFF,
        questions: [QUESTION_DETAILS],
      },
      {
        key: 'report',
        emoji: '🚨',
        label: { fr: 'Signalement', en: 'Report' },
        description: { fr: 'Signaler un joueur ou un comportement', en: 'Report a player or behaviour' },
        categoryNames: TICKET_CATEGORY,
        createCategoryName: '🎫 Tickets',
        staffRoleNames: [...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam],
        questions: [QUESTION_PLAYER, QUESTION_DETAILS, QUESTION_PROOF],
      },
    ],
    panel: {
      channelNames: [...NAMES.ticket],
      style: 'SELECT',
      embed: ticketPanelEmbed({ subtitle: { fr: 'Whitelist, support ou signalement.', en: 'Whitelist, support or report.' } }),
    },
  },
  notifications: {
    items: [NOTIF.announcements, NOTIF.events, NOTIF.whitelist, NOTIF.updates],
    panelChannelNames: [...NAMES.notifications, ...NAMES.welcome],
  },
  language: { panelChannelNames: [...NAMES.languages], announcements: false },
  fivem: { statusChannelNames: ['server-status', 'status', 'statut', 'stats'] },
  infoMessages: [
    {
      key: 'whitelist',
      channelNames: ['whitelist', 'candidatures', 'candidature', 'applications'],
      embeds: infoEmbeds(
        'whitelist',
        {
          title: '📝 Whitelist — comment postuler',
          description: 'L’accès au serveur est réservé aux joueurs whitelistés. La procédure est simple et se fait entièrement sur Discord.',
          fields: [
            { name: '1. Lisez le règlement', value: '{channel:rules} — toute candidature qui l’ignore est refusée.', inline: false },
            { name: '2. Postulez', value: 'Utilisez la commande `/whitelist apply` et répondez au formulaire (histoire de votre personnage, expérience RP, disponibilité).', inline: false },
            { name: '3. Attendez la réponse', value: 'Un membre de l’équipe examine chaque dossier sous 48 h. Suivez l’état avec `/whitelist status`.', inline: false },
            { name: 'Question ?', value: 'Ouvrez un ticket **Whitelist** dans {channel:ticket}.', inline: false },
          ],
        },
        {
          title: '📝 Whitelist — how to apply',
          description: 'Access to the server is reserved for whitelisted players. The process is simple and happens entirely on Discord.',
          fields: [
            { name: '1. Read the rules', value: '{channel:rules} — any application ignoring them is rejected.', inline: false },
            { name: '2. Apply', value: 'Use the `/whitelist apply` command and answer the form (character backstory, RP experience, availability).', inline: false },
            { name: '3. Wait for the answer', value: 'A team member reviews every application within 48 h. Track it with `/whitelist status`.', inline: false },
            { name: 'Question?', value: 'Open a **Whitelist** ticket in {channel:ticket}.', inline: false },
          ],
        },
      ),
    },
  ],
};
