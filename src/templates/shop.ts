import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_ORDER, QUESTION_STEPS, ROLE_NAMES, STD, cat, ch, forum, infoEmbeds, paymentMethodsInfo, rulesEmbeds, ticketCategory, ticketPanelEmbed, voice, welcomeContent } from './common';
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
    wip: ['wip', 'work-in-progress', 'en-cours'],
    previews: ['previews', 'apercus', 'showcase'],
    howToBuy: [...NAMES.howToBuy],
    staffChat: [...NAMES.staffChat],
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
  structure: {
    categories: [
      cat('information', '📢 INFORMATION', 'public', [STD.welcome(), STD.rules(), STD.announcements(), STD.payment(), STD.giveaways(), STD.polls(), ch('feedback', '⭐・feedback', 'chat', { aliases: ['avis', 'reviews'], topic: { fr: 'Vos avis sur nos scripts et notre support.', en: 'Your reviews of our scripts and support.' } })], ['infos', 'informations']),
      cat('showcase', '👀 SHOWCASE', 'public', [
        ch('previews', '🖼️・previews', 'readonly', { aliases: ['apercus', 'showcase'], topic: { fr: 'Aperçus vidéo et images de nos scripts.', en: 'Video and image previews of our scripts.' } }),
        ch('wip', '🚧・wip', 'readonly', { aliases: ['work-in-progress', 'en-cours'], topic: { fr: 'Scripts en cours de développement.', en: 'Scripts under development.' } }),
        ch('updates', '🔄・updates', 'readonly', { aliases: ['mises-a-jour', 'changelog'], topic: { fr: 'Changelog des mises à jour.', en: 'Update changelog.' } }),
        ch('spoilers', '👀・spoilers', 'readonly', { topic: { fr: 'Teasers des prochaines sorties.', en: 'Teasers of upcoming releases.' } }),
      ]),
      cat('shop', '🛒 RS SHOP', 'public', [
        ch('howToBuy', '🛍️・how-to-buy', 'readonly', { aliases: NAMES.howToBuy, topic: { fr: 'Comment acheter un script.', en: 'How to buy a script.' } }),
        forum('paidScripts', '💎・paid-scripts', 'readonly', { aliases: ['scripts-payants', 'premium-scripts'], topic: { fr: 'Catalogue des scripts premium (un post par script).', en: 'Premium scripts catalog (one post per script).' } }),
        forum('freeScripts', '🆓・free-scripts', 'readonly', { aliases: ['scripts-gratuits', 'free'], topic: { fr: 'Scripts gratuits.', en: 'Free scripts.' } }),
      ], ['shop', 'boutique', 'store']),
      cat('community', '💬 COMMUNITY', 'public', [
        STD.general(),
        forum('suggestions', '💡・suggestions', 'chat', { aliases: NAMES.suggestions, topic: { fr: 'Vos idées de scripts et d’améliorations.', en: 'Your script and improvement ideas.' } }),
        ch('support', '🆘・support-chat', 'chat', { aliases: NAMES.support, topic: { fr: 'Entraide rapide. Pour un suivi, ouvrez un ticket.', en: 'Quick peer help. For follow-up, open a ticket.' } }),
        forum('bugReports', '🐛・bug-reports', 'chat', { aliases: NAMES.bugs, topic: { fr: 'Un post par bug : script, version, étapes.', en: 'One post per bug: script, version, steps.' } }),
        STD.ticket(),
      ], ['communaute', 'communauté']),
      cat('staff', '👑 STAFF', 'staff', [
        STD.staffChat(),
        STD.bugManagement(),
        STD.staffTasks(),
        ch('orders', '📦・orders', 'staff', { aliases: ['commandes'], topic: { fr: 'Logs des commandes et livraisons.', en: 'Order and delivery logs.' } }),
        voice('staffVoice', '🔊 Staff Voice'),
      ]),
      ticketCategory('tickets', '🎫 Tickets', ['ticket', 'support-tickets']),
    ],
  },
  infoMessages: [
    paymentMethodsInfo({
      shopLabel: { fr: 'notre boutique **Tebex** officielle', en: 'our official **Tebex** store' },
      delivery: { fr: 'Les scripts et clés sont livrés **automatiquement** par Tebex dès la validation du paiement (quelques minutes). Les commandes sur mesure sont livrées dans le délai convenu dans le ticket.', en: 'Scripts and keys are delivered **automatically** by Tebex as soon as the payment clears (a few minutes). Custom orders are delivered within the time agreed in the ticket.' },
    }),
    {
      key: 'how-to-buy',
      channelNames: [...NAMES.howToBuy],
      embeds: infoEmbeds(
        'how-to-buy',
        {
          title: '🛍️ Comment acheter',
          description: 'Nos scripts FiveM sont vendus sur notre boutique Tebex et livrés automatiquement. Voici le parcours en quatre étapes.',
          fields: [
            { name: '1. Choisir', value: 'Parcourez le catalogue dans {channel:paidScripts} (un post par script : fonctionnalités, prix, vidéo) et {channel:freeScripts}. Les aperçus sont dans {channel:previews}.', inline: false },
            { name: '2. Payer', value: 'Cliquez sur le lien Tebex du post et réglez avec l’un des moyens listés dans {channel:paymentMethods}. Les prix sont TTC.', inline: false },
            { name: '3. Recevoir', value: 'Le script et votre clé arrivent par e-mail et dans votre espace Tebex. Vous obtenez le rôle 💎 Customer en liant votre achat via un ticket **Commande** dans {channel:ticket}.', inline: false },
            { name: '4. Installer', value: 'Suivez le README fourni. Besoin d’aide ? {channel:support} pour une question rapide, ticket **Support** pour un suivi.', inline: false },
            { name: 'Licence', value: 'Un achat = une licence pour **un** serveur. Revente, partage et leak entraînent un bannissement définitif.', inline: false },
          ],
        },
        {
          title: '🛍️ How to buy',
          description: 'Our FiveM scripts are sold on our Tebex store and delivered automatically. Here is the four-step process.',
          fields: [
            { name: '1. Choose', value: 'Browse the catalog in {channel:paidScripts} (one post per script: features, price, video) and {channel:freeScripts}. Previews are in {channel:previews}.', inline: false },
            { name: '2. Pay', value: 'Click the Tebex link in the post and pay with one of the methods listed in {channel:paymentMethods}. Prices include tax.', inline: false },
            { name: '3. Receive', value: 'The script and your key arrive by e-mail and in your Tebex account. Get the 💎 Customer role by linking your purchase through an **Order** ticket in {channel:ticket}.', inline: false },
            { name: '4. Install', value: 'Follow the bundled README. Need help? {channel:support} for a quick question, a **Support** ticket for follow-up.', inline: false },
            { name: 'License', value: 'One purchase = one license for **one** server. Reselling, sharing or leaking leads to a permanent ban.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'wip',
      channelNames: ['wip', 'work-in-progress', 'en-cours'],
      embeds: infoEmbeds(
        'wip',
        { title: '🚧 Work in progress', description: 'Ce salon présente les scripts **en cours de développement** : captures, courtes vidéos et avancement. Rien ici n’est encore en vente, et les fonctionnalités montrées peuvent changer avant la sortie.\n\nEnvie d’une fonctionnalité ? Proposez-la dans {channel:suggestions}. Les sorties sont annoncées dans {channel:announcements} (activez la notification 🛠️ Mises à jour).' },
        { title: '🚧 Work in progress', description: 'This channel shows scripts **under development**: screenshots, short videos and progress. Nothing here is on sale yet, and the features shown may change before release.\n\nWant a feature? Suggest it in {channel:suggestions}. Releases are announced in {channel:announcements} (enable the 🛠️ Updates notification).' },
      ),
    },
    {
      key: 'updates',
      channelNames: ['updates', 'mises-a-jour', 'changelog'],
      embeds: infoEmbeds(
        'updates',
        { title: '🔄 Mises à jour', description: 'Chaque mise à jour d’un script est publiée ici : version, nouveautés, corrections et éventuelles étapes de migration.\n\n• Les mises à jour sont **gratuites** pour tous les clients : retéléchargez le script depuis votre espace Tebex.\n• Un bug après mise à jour ? Postez dans {channel:bugs} ou ouvrez un ticket **Bug** dans {channel:ticket}.\n• Activez la notification 🛠️ Mises à jour pour être prévenu.' },
        { title: '🔄 Updates', description: 'Every script update is posted here: version, new features, fixes and any migration steps.\n\n• Updates are **free** for every customer: download the script again from your Tebex account.\n• A bug after an update? Post in {channel:bugs} or open a **Bug** ticket in {channel:ticket}.\n• Enable the 🛠️ Updates notification to be informed.' },
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
