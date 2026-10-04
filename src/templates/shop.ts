import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_ORDER, QUESTION_STEPS, ROLE_NAMES, infoEmbeds, rulesEmbeds, ticketPanelEmbed, welcomeContent } from './common';
import type { ServerTemplate } from './types';

const STAFF = [...ROLE_NAMES.support, ...ROLE_NAMES.manager, ...ROLE_NAMES.rsTeam];
const welcome = welcomeContent({
  tagline: {
    fr: 'Boutique officielle **Redemption Story Studio** : scripts FiveM premium, mises à jour régulières et support réactif.',
    en: 'Official **Redemption Story Studio** shop: premium FiveM scripts, regular updates and responsive support.',
  },
  extraFields: [
    { fr: { name: '🛒 Boutique', value: 'Catalogue : {channel:paidScripts} · {channel:freeScripts}' }, en: { name: '🛒 Shop', value: 'Catalog: {channel:paidScripts} · {channel:freeScripts}' } },
    { fr: { name: '💳 Paiement', value: 'Moyens acceptés : {channel:paymentMethods}' }, en: { name: '💳 Payment', value: 'Accepted methods: {channel:paymentMethods}' } },
  ],
});

export const shopTemplate: ServerTemplate = {
  key: 'shop',
  emoji: '🛒',
  kind: 'SHOP',
  defaultLanguage: 'fr',
  enabledLanguages: ['fr', 'en'],
  staffRoleNames: ['Support', 'Manager', 'Developer', 'RS Team', 'Moderator'],
  adminRoleNames: ['Administrator', 'Admin', 'Manager', 'RS Team'],
  memberRoleNames: ['Member', 'Membre'],
  botRoleNames: [...ROLE_NAMES.bot],
  muteRoleNames: [...ROLE_NAMES.muted],
  channels: {
    announcements: [...NAMES.announcements],
    paymentMethods: [...NAMES.paymentMethods],
    paidScripts: ['paid-scripts', 'scripts-payants', 'premium-scripts', 'shop'],
    freeScripts: ['free-scripts', 'scripts-gratuits', 'free'],
    feedback: ['feedback', 'avis', 'reviews'],
    support: [...NAMES.support],
    suggestions: [...NAMES.suggestions],
    bugs: [...NAMES.bugs],
    updates: ['updates', 'mises-a-jour', 'changelog'],
  },
  welcome: { channelNames: [...NAMES.welcome], message: welcome.message, embed: welcome.embed, image: true },
  leave: {
    channelNames: [...NAMES.leave],
    message: { fr: '👋 **{username}** a quitté la boutique. Nous sommes désormais {memberCount}.', en: '👋 **{username}** left the shop. We are now {memberCount}.' },
  },
  rules: {
    channelNames: [...NAMES.rules],
    embeds: rulesEmbeds({
      serverLabel: { fr: 'Redemption Story Shop', en: 'Redemption Story Shop' },
      languageRule: { fr: 'Français et anglais sont acceptés dans les salons communautaires. Choisissez votre langue avec le panneau pour recevoir les annonces adaptées.', en: 'French and English are accepted in community channels. Pick your language with the panel to receive the right announcements.' },
      extraRule: {
        fr: 'Achats** — Les scripts achetés sont strictement personnels : revente, partage, fuite (« leak ») ou contournement de la protection entraînent un bannissement définitif sans remboursement.',
        en: 'Purchases** — Purchased scripts are strictly personal: reselling, sharing, leaking or bypassing the protection leads to a permanent ban without refund.',
      },
    }),
  },
  logChannels: {
    SHOP: ['orders', 'commandes'],
    SYSTEM: [...NAMES.bugManagement, ...NAMES.staffChat],
    TICKET: [...NAMES.staffTasks, ...NAMES.staffChat],
    MODERATION: [...NAMES.staffChat],
    SECURITY: [...NAMES.staffChat],
    MEMBER: [...NAMES.staffChat],
    MESSAGE: [...NAMES.staffChat],
    ROLE: [...NAMES.staffChat],
    CHANNEL: [...NAMES.staffChat],
    VOICE: [...NAMES.staffChat],
    ANNOUNCEMENT: [...NAMES.staffChat],
  },
  recommended: { giveaways: [...NAMES.giveaways], polls: [...NAMES.polls], events: [...NAMES.events] },
  tickets: {
    types: [
      {
        key: 'support',
        emoji: '🎫',
        label: { fr: 'Support', en: 'Support' },
        description: { fr: 'Question générale ou aide à l’installation', en: 'General question or installation help' },
        categoryNames: ['tickets', 'ticket', 'support-tickets'],
        createCategoryName: '🎫 Tickets',
        staffRoleNames: STAFF,
        questions: [QUESTION_DETAILS],
      },
      {
        key: 'order',
        emoji: '📦',
        label: { fr: 'Commande', en: 'Order' },
        description: { fr: 'Suivi, livraison ou problème sur une commande', en: 'Tracking, delivery or issue with an order' },
        categoryNames: ['tickets', 'ticket', 'support-tickets'],
        createCategoryName: '🎫 Tickets',
        staffRoleNames: STAFF,
        questions: [QUESTION_ORDER, QUESTION_DETAILS],
      },
      {
        key: 'payment',
        emoji: '💳',
        label: { fr: 'Paiement', en: 'Payment' },
        description: { fr: 'Problème de paiement, facture ou remboursement', en: 'Payment, invoice or refund issue' },
        categoryNames: ['tickets', 'ticket', 'support-tickets'],
        createCategoryName: '🎫 Tickets',
        staffRoleNames: [...ROLE_NAMES.manager, ...ROLE_NAMES.rsTeam],
        questions: [QUESTION_ORDER, QUESTION_DETAILS],
      },
      {
        key: 'bug',
        emoji: '🐛',
        label: { fr: 'Bug', en: 'Bug' },
        description: { fr: 'Signaler un bug sur un script', en: 'Report a bug in a script' },
        categoryNames: ['tickets', 'ticket', 'support-tickets'],
        createCategoryName: '🎫 Tickets',
        staffRoleNames: [...ROLE_NAMES.developer, ...ROLE_NAMES.support, ...ROLE_NAMES.rsTeam],
        questions: [
          { id: 'script', label: { fr: 'Script concerné', en: 'Script concerned' }, placeholder: { fr: 'Nom et version', en: 'Name and version' }, style: 'short', required: true },
          QUESTION_STEPS,
        ],
      },
      {
        key: 'partnership',
        emoji: '🤝',
        label: { fr: 'Partenariat', en: 'Partnership' },
        description: { fr: 'Proposer un partenariat ou une collaboration', en: 'Propose a partnership or collaboration' },
        categoryNames: ['tickets', 'ticket', 'support-tickets'],
        createCategoryName: '🎫 Tickets',
        staffRoleNames: [...ROLE_NAMES.manager, ...ROLE_NAMES.rsTeam],
        questions: [
          { id: 'project', label: { fr: 'Votre projet / serveur', en: 'Your project / server' }, placeholder: { fr: 'Nom, lien, taille de la communauté', en: 'Name, link, community size' }, style: 'short', required: true },
          QUESTION_DETAILS,
        ],
      },
    ],
    panel: {
      channelNames: [...NAMES.ticket],
      style: 'SELECT',
      embed: ticketPanelEmbed({ subtitle: { fr: 'Support, commandes, paiements, bugs ou partenariats.', en: 'Support, orders, payments, bugs or partnerships.' } }),
    },
  },
  notifications: {
    items: [NOTIF.announcements, NOTIF.giveaways, NOTIF.updates, NOTIF.shop],
    panelChannelNames: [...NAMES.notifications, ...NAMES.welcome],
  },
  language: { panelChannelNames: [...NAMES.languages], announcements: false },
  infoMessages: [
    {
      key: 'payment-methods',
      channelNames: [...NAMES.paymentMethods],
      embeds: infoEmbeds(
        'payment-methods',
        {
          title: '💳 Moyens de paiement',
          description: 'Tous les achats se font via notre boutique Tebex, qui livre automatiquement vos scripts et vos clés.',
          fields: [
            { name: 'Acceptés', value: '• PayPal\n• Carte bancaire (Visa, Mastercard)\n• Apple Pay / Google Pay\n• Paysafecard (via Tebex)', inline: true },
            { name: 'Sécurité', value: 'Aucun paiement n’est demandé en message privé. Seuls les liens de notre boutique officielle sont valides.', inline: true },
            { name: 'Problème ?', value: 'Ouvrez un ticket **Paiement** dans {channel:ticket} avec votre numéro de transaction.', inline: false },
          ],
        },
        {
          title: '💳 Payment methods',
          description: 'Every purchase goes through our Tebex store, which delivers your scripts and keys automatically.',
          fields: [
            { name: 'Accepted', value: '• PayPal\n• Credit / debit card (Visa, Mastercard)\n• Apple Pay / Google Pay\n• Paysafecard (via Tebex)', inline: true },
            { name: 'Safety', value: 'We never ask for payment in DMs. Only links from our official store are valid.', inline: true },
            { name: 'Issue?', value: 'Open a **Payment** ticket in {channel:ticket} with your transaction number.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'feedback',
      channelNames: ['feedback', 'avis', 'reviews'],
      embeds: infoEmbeds(
        'feedback',
        { title: '⭐ Votre avis compte', description: 'Partagez ici votre retour sur nos scripts et notre support : une note, ce qui vous a plu, ce que nous pouvons améliorer. Pour un problème précis, préférez un ticket dans {channel:ticket}.' },
        { title: '⭐ Your feedback matters', description: 'Share your thoughts on our scripts and support here: a rating, what you liked, what we can improve. For a specific issue, please open a ticket in {channel:ticket}.' },
      ),
    },
  ],
};
