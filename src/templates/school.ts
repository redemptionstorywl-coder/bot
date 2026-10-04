import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_PLAYER, QUESTION_PROOF, ROLE_NAMES, infoEmbeds, rulesEmbeds, ticketPanelEmbed, welcomeContent } from './common';
import type { ServerTemplate } from './types';

const STAFF = [...ROLE_NAMES.support, ...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam];
const TICKET_CATEGORY = ['tickets', 'ticket', 'support-tickets', 'support'];
const welcome = welcomeContent({
  tagline: {
    fr: 'Bienvenue à **Redemption Story School RP**. Lisez le règlement, choisissez votre langue et inscrivez-vous pour rejoindre votre classe.',
    en: 'Welcome to **Redemption Story School RP**. Read the rules, pick your language and register to join your class.',
  },
  extraFields: [{ fr: { name: '🎓 Inscription', value: 'Candidature : {channel:whitelist} (`/school register`)' }, en: { name: '🎓 Registration', value: 'Application: {channel:whitelist} (`/school register`)' } }],
});

export const schoolTemplate: ServerTemplate = {
  key: 'school',
  emoji: '🎓',
  kind: 'SCHOOL',
  defaultLanguage: 'fr',
  enabledLanguages: ['fr', 'en'],
  staffRoleNames: ['Support', 'Moderator', 'Modérateur', 'Admin', 'Administrator', 'Developer', 'RS Team', 'Staff', 'Professeur', 'Teacher'],
  adminRoleNames: ['Admin', 'Administrator', 'Directeur', 'Principal', 'Fondateur', 'RS Team'],
  memberRoleNames: ['Member', 'Membre', 'Student', 'Étudiant', 'Eleve', 'Élève'],
  botRoleNames: [...ROLE_NAMES.bot],
  muteRoleNames: [...ROLE_NAMES.muted],
  channels: {
    announcements: [...NAMES.announcements],
    whitelist: ['inscriptions', 'inscription', 'registration', 'whitelist', 'candidatures', 'applications'],
    support: [...NAMES.support],
    suggestions: [...NAMES.suggestions],
    bugs: [...NAMES.bugs],
    events: [...NAMES.events],
    classes: ['classes', 'classe', 'emploi-du-temps', 'schedule'],
  },
  welcome: { channelNames: [...NAMES.welcome], message: welcome.message, embed: welcome.embed, image: true },
  leave: {
    channelNames: [...NAMES.leave],
    message: { fr: '👋 **{username}** a quitté l’école. Nous sommes désormais {memberCount}.', en: '👋 **{username}** left the school. We are now {memberCount}.' },
  },
  rules: {
    channelNames: [...NAMES.rules],
    embeds: rulesEmbeds({
      serverLabel: { fr: 'Redemption Story School RP', en: 'Redemption Story School RP' },
      languageRule: { fr: 'Le serveur est francophone ; l’anglais est toléré dans les salons communautaires.', en: 'The server is French-speaking; English is tolerated in community channels.' },
      extraRule: {
        fr: 'Roleplay** — Restez dans votre personnage en jeu : pas de métagaming ni de powergaming. Les conflits RP ne se règlent pas sur le Discord.',
        en: 'Roleplay** — Stay in character in game: no metagaming or powergaming. RP conflicts are not settled on Discord.',
      },
    }),
  },
  logChannels: {
    MODERATION: ['mod-logs', 'moderation', 'sanctions', ...NAMES.staffChat],
    WHITELIST: ['inscriptions-staff', 'whitelist-logs', 'registration-logs', ...NAMES.staffChat],
    SCHOOL: ['school-logs', 'vie-scolaire', ...NAMES.staffChat],
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
        emoji: '🎓',
        label: { fr: 'Inscription', en: 'Registration' },
        description: { fr: 'Question sur votre inscription', en: 'Question about your registration' },
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
      embed: ticketPanelEmbed({ subtitle: { fr: 'Inscription, support ou signalement.', en: 'Registration, support or report.' } }),
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
      key: 'registration',
      channelNames: ['inscriptions', 'inscription', 'registration', 'whitelist'],
      embeds: infoEmbeds(
        'registration',
        {
          title: '🎓 Inscription — rejoindre l’école',
          description: 'L’accès au serveur se fait sur dossier. Tout se passe sur Discord, en quelques minutes.',
          fields: [
            { name: '1. Lisez le règlement', value: '{channel:rules} — indispensable avant de postuler.', inline: false },
            { name: '2. Inscrivez-vous', value: '`/school register` crée votre profil d’élève, puis `/school apply` envoie votre candidature (personnage, motivation, disponibilités).', inline: false },
            { name: '3. Validation', value: 'L’équipe pédagogique étudie chaque dossier sous 48 h ; vous recevrez votre classe et votre maison une fois accepté.', inline: false },
            { name: 'Question ?', value: 'Ouvrez un ticket **Inscription** dans {channel:ticket}.', inline: false },
          ],
        },
        {
          title: '🎓 Registration — joining the school',
          description: 'Access to the server is granted on application. Everything happens on Discord in a few minutes.',
          fields: [
            { name: '1. Read the rules', value: '{channel:rules} — mandatory before applying.', inline: false },
            { name: '2. Register', value: '`/school register` creates your student profile, then `/school apply` sends your application (character, motivation, availability).', inline: false },
            { name: '3. Approval', value: 'The faculty reviews every application within 48 h; you will receive your class and house once accepted.', inline: false },
            { name: 'Question?', value: 'Open a **Registration** ticket in {channel:ticket}.', inline: false },
          ],
        },
      ),
    },
  ],
};
