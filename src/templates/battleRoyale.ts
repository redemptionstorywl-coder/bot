import { LANGUAGES } from '../config/constants';
import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_ORDER, QUESTION_PLAYER, QUESTION_PROOF, QUESTION_STEPS, ROLE_NAMES, infoEmbeds, rulesEmbeds, ticketPanelEmbed, welcomeContent } from './common';
import type { ServerTemplate } from './types';

const STAFF = [...ROLE_NAMES.support, ...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam];
const welcome = welcomeContent({
  tagline: {
    fr: 'Bienvenue dans l’arène **Redemption Story Battle Royale**. Lisez le guide, choisissez votre langue et rejoignez la compétition.',
    en: 'Welcome to the **Redemption Story Battle Royale** arena. Read the guide, pick your language and join the competition.',
  },
  extraFields: [
    { fr: { name: '🗺️ Guide', value: 'Comment jouer : {channel:howToPlay}' }, en: { name: '🗺️ Guide', value: 'How to play: {channel:howToPlay}' } },
    { fr: { name: '🏆 Classements', value: 'Suivez les meilleurs dans {channel:leaderboards}' }, en: { name: '🏆 Leaderboards', value: 'Follow the best in {channel:leaderboards}' } },
  ],
});

export const battleRoyaleTemplate: ServerTemplate = {
  key: 'battle-royale',
  emoji: '⚔️',
  kind: 'BATTLE_ROYALE',
  defaultLanguage: 'en',
  enabledLanguages: LANGUAGES.map((l) => l.code),
  staffRoleNames: ['Support', 'Moderator', 'Admin', 'Community Manager', 'Developer', 'RS Team'],
  adminRoleNames: ['Admin', 'Administrator', 'Community Manager', 'RS Team'],
  memberRoleNames: ['Player', 'Joueur', 'Member'],
  botRoleNames: [...ROLE_NAMES.bot],
  muteRoleNames: [...ROLE_NAMES.muted],
  channels: {
    announcements: [...NAMES.announcements],
    howToPlay: ['how-to-play', 'guide', 'comment-jouer', 'tutorial'],
    leaderboards: ['leaderboards', 'leaderboard', 'classements', 'classement'],
    events: [...NAMES.events],
    store: ['store', 'shop', 'boutique'],
    paymentMethods: [...NAMES.paymentMethods],
    stats: ['stats', 'statistiques', 'server-status', 'status'],
    streamers: ['streamers', 'streams', 'live'],
    tournamentInfo: ['tournament-info', 'tournaments', 'tournois'],
    tournamentResults: ['tournament-results', 'resultats'],
    bugs: [...NAMES.bugs],
    suggestions: [...NAMES.suggestions],
    clips: ['clips-and-screenshots', 'clips', 'screenshots', 'media'],
  },
  welcome: { channelNames: [...NAMES.welcome], message: welcome.message, embed: welcome.embed, image: true },
  leave: {
    channelNames: [...NAMES.leave],
    message: { fr: '👋 **{username}** a quitté l’arène. Nous sommes désormais {memberCount}.', en: '👋 **{username}** left the arena. We are now {memberCount}.' },
  },
  rules: {
    channelNames: [...NAMES.rules],
    embeds: rulesEmbeds({
      serverLabel: { fr: 'Redemption Story Battle Royale', en: 'Redemption Story Battle Royale' },
      languageRule: { fr: 'Les salons généraux sont en anglais ; chaque langue dispose de son propre salon (🇫🇷 french, 🇪🇸 spanish…). Choisissez votre langue avec le panneau.', en: 'General channels are in English; each language has its own channel (🇫🇷 french, 🇪🇸 spanish…). Pick your language with the panel.' },
      extraRule: {
        fr: 'Fair-play** — Cheats, exploits, glitchs, team-up en solo et stream-sniping sont interdits en jeu. Toute triche entraîne un bannissement du jeu et du Discord.',
        en: 'Fair play** — Cheats, exploits, glitches, teaming in solo and stream sniping are forbidden in game. Any cheating leads to a ban from the game and from Discord.',
      },
    }),
  },
  logChannels: {
    MODERATION: ['player-reports', 'reports', 'signalements', ...NAMES.staffChat],
    SYSTEM: [...NAMES.bugManagement, ...NAMES.staffChat],
    SECURITY: ['staff-announcements', 'staff-annonces', ...NAMES.staffChat],
    MEMBER: [...NAMES.staffChat],
    MESSAGE: [...NAMES.staffChat],
    ROLE: [...NAMES.staffChat],
    CHANNEL: [...NAMES.staffChat],
    VOICE: [...NAMES.staffChat],
    ANNOUNCEMENT: ['event-management', 'events-management', ...NAMES.staffChat],
    TICKET: [...NAMES.staffTasks, ...NAMES.staffChat],
    BATTLE_ROYALE: ['tournament-management', 'tournaments-management', ...NAMES.staffChat],
  },
  recommended: { giveaways: [...NAMES.giveaways], polls: [...NAMES.polls], events: [...NAMES.events] },
  tickets: {
    types: [
      {
        key: 'support',
        emoji: '🎫',
        label: { fr: 'Support général', en: 'General Support' },
        description: { fr: 'Question, aide ou problème de compte', en: 'Question, help or account issue' },
        categoryNames: ['general-support', 'general support', 'support', 'tickets'],
        createCategoryName: '🎫 GENERAL SUPPORT',
        staffRoleNames: STAFF,
        questions: [QUESTION_DETAILS],
      },
      {
        key: 'bug',
        emoji: '🐛',
        label: { fr: 'Bug', en: 'Bug Report' },
        description: { fr: 'Signaler un bug en jeu ou sur le Discord', en: 'Report an in-game or Discord bug' },
        categoryNames: ['bug-report', 'bug report', 'bugs', 'bug-reports'],
        createCategoryName: '🐛 BUG REPORT',
        staffRoleNames: [...ROLE_NAMES.developer, ...STAFF],
        questions: [QUESTION_STEPS, QUESTION_PROOF],
      },
      {
        key: 'report',
        emoji: '🚨',
        label: { fr: 'Signaler un joueur', en: 'Player Report' },
        description: { fr: 'Triche, toxicité ou comportement interdit', en: 'Cheating, toxicity or forbidden behaviour' },
        categoryNames: ['player-report', 'player report', 'reports', 'signalements'],
        createCategoryName: '🚨 PLAYER REPORT',
        staffRoleNames: [...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam],
        questions: [QUESTION_PLAYER, QUESTION_DETAILS, QUESTION_PROOF],
      },
      {
        key: 'ban-appeal',
        emoji: '⚠️',
        label: { fr: 'Contester un ban', en: 'Ban Appeal' },
        description: { fr: 'Demander la révision d’une sanction', en: 'Request a review of a sanction' },
        categoryNames: ['ban-appeal', 'ban appeal', 'appeals', 'unban'],
        createCategoryName: '⚠️ BAN APPEAL',
        staffRoleNames: [...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam],
        questions: [
          { id: 'sanction', label: { fr: 'Sanction reçue (date, raison)', en: 'Sanction received (date, reason)' }, placeholder: { fr: 'Ex. ban le 12/03 pour …', en: 'E.g. banned on 03/12 for …' }, style: 'short', required: true },
          { id: 'appeal', label: { fr: 'Pourquoi devrions-nous la lever ?', en: 'Why should we lift it?' }, placeholder: { fr: 'Expliquez calmement votre situation', en: 'Calmly explain your situation' }, style: 'paragraph', required: true },
        ],
      },
      {
        key: 'payment',
        emoji: '💳',
        label: { fr: 'Paiement', en: 'Payment Support' },
        description: { fr: 'Achat, boost ou remboursement', en: 'Purchase, boost or refund' },
        categoryNames: ['payment-support', 'payment support', 'payments', 'paiements'],
        createCategoryName: '💳 PAYMENT SUPPORT',
        staffRoleNames: [...ROLE_NAMES.admin, ...ROLE_NAMES.manager, ...ROLE_NAMES.rsTeam],
        questions: [QUESTION_ORDER, QUESTION_DETAILS],
      },
    ],
    panel: {
      channelNames: [...NAMES.ticket],
      style: 'SELECT',
      embed: ticketPanelEmbed({ subtitle: { fr: 'Support, bugs, signalements, contestations de ban ou paiements.', en: 'Support, bugs, player reports, ban appeals or payments.' } }),
    },
  },
  notifications: {
    items: [NOTIF.announcements, NOTIF.events, NOTIF.tournament, NOTIF.giveaways, NOTIF.streams, NOTIF.updates],
    panelChannelNames: [...NAMES.notifications, ...NAMES.welcome],
  },
  language: {
    panelChannelNames: [...NAMES.languages],
    announcements: true,
    channelNames: {
      fr: ['french', 'francais', 'français'],
      en: ['english', 'anglais'],
      es: ['spanish', 'espanol', 'español'],
      de: ['german', 'deutsch', 'allemand'],
      it: ['italian', 'italiano', 'italien'],
      pt: ['portuguese', 'portugues', 'português'],
      ar: ['arabic', 'arabe'],
      ru: ['russian', 'russe'],
      tr: ['turkish', 'turc'],
      pl: ['polish', 'polski', 'polonais'],
    },
  },
  fivem: { statusChannelNames: ['stats', 'server-status', 'status', 'statut'] },
  infoMessages: [
    {
      key: 'how-to-play',
      channelNames: ['how-to-play', 'guide', 'comment-jouer'],
      embeds: infoEmbeds(
        'how-to-play',
        {
          title: '🗺️ Comment jouer',
          description: 'Tout ce qu’il faut savoir pour votre première partie sur Redemption Story Battle Royale.',
          fields: [
            { name: '1. Rejoindre', value: 'Lancez FiveM, recherchez **Redemption Story** ou utilisez l’adresse donnée dans {channel:announcements}.', inline: false },
            { name: '2. Lier votre compte', value: 'Utilisez `/br-link` pour associer votre compte Discord et suivre votre progression (XP, battle pass, classement).', inline: false },
            { name: '3. La partie', value: 'Jusqu’à 60 joueurs, une zone qui se referme, du loot à ramasser : le dernier debout l’emporte. Modes solo, duo et squad.', inline: false },
            { name: '4. Progresser', value: 'Chaque partie rapporte de l’XP et des récompenses. Consultez `/profile`, `/battlepass` et `/leaderboard`.', inline: false },
            { name: '5. Besoin d’aide ?', value: 'Ouvrez un ticket dans {channel:ticket}.', inline: false },
          ],
        },
        {
          title: '🗺️ How to play',
          description: 'Everything you need to know for your first match on Redemption Story Battle Royale.',
          fields: [
            { name: '1. Join', value: 'Launch FiveM, search for **Redemption Story** or use the address shared in {channel:announcements}.', inline: false },
            { name: '2. Link your account', value: 'Use `/br-link` to connect your Discord account and track your progress (XP, battle pass, ranking).', inline: false },
            { name: '3. The match', value: 'Up to 60 players, a shrinking zone, loot to grab: the last one standing wins. Solo, duo and squad modes.', inline: false },
            { name: '4. Progress', value: 'Every match grants XP and rewards. Check `/profile`, `/battlepass` and `/leaderboard`.', inline: false },
            { name: '5. Need help?', value: 'Open a ticket in {channel:ticket}.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'leaderboards',
      channelNames: ['leaderboards', 'leaderboard', 'classements'],
      embeds: infoEmbeds(
        'leaderboards',
        {
          title: '🏆 Classements',
          description: 'Les classements sont mis à jour automatiquement à chaque fin de partie.',
          fields: [
            { name: 'Catégories', value: '• **Victoires** — nombre de parties gagnées\n• **Éliminations** — kills cumulés\n• **K/D** — ratio éliminations / morts\n• **XP** — progression de la saison', inline: false },
            { name: 'Saisons', value: 'Chaque saison remet les compteurs à zéro ; les meilleurs reçoivent le rôle 🏆 Tournament Winner et des récompenses exclusives.', inline: false },
            { name: 'Commandes', value: '`/leaderboard` pour le top en direct, `/profile` pour vos statistiques.', inline: false },
          ],
        },
        {
          title: '🏆 Leaderboards',
          description: 'Leaderboards are updated automatically at the end of every match.',
          fields: [
            { name: 'Categories', value: '• **Wins** — matches won\n• **Eliminations** — total kills\n• **K/D** — kills / deaths ratio\n• **XP** — season progression', inline: false },
            { name: 'Seasons', value: 'Every season resets the counters; the best players receive the 🏆 Tournament Winner role and exclusive rewards.', inline: false },
            { name: 'Commands', value: '`/leaderboard` for the live top, `/profile` for your own stats.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'tournament-info',
      channelNames: ['tournament-info', 'tournaments', 'tournois'],
      embeds: infoEmbeds(
        'tournament-info',
        {
          title: '📅 Tournois',
          description: 'Des tournois sont organisés régulièrement avec des récompenses à la clé.',
          fields: [
            { name: 'Format', value: 'Solo, duo ou squad selon l’événement. Les points combinent placement et éliminations.', inline: false },
            { name: 'Inscription', value: 'Les inscriptions sont annoncées dans {channel:announcements} et {channel:events}. Activez la notification 🏆 Tournois pour ne rien manquer.', inline: false },
            { name: 'Résultats', value: 'Publiés dans {channel:tournamentResults} après vérification par l’équipe.', inline: false },
          ],
        },
        {
          title: '📅 Tournaments',
          description: 'Tournaments are organised regularly with rewards on the line.',
          fields: [
            { name: 'Format', value: 'Solo, duo or squad depending on the event. Points combine placement and eliminations.', inline: false },
            { name: 'Sign-up', value: 'Registrations are announced in {channel:announcements} and {channel:events}. Enable the 🏆 Tournaments notification so you never miss one.', inline: false },
            { name: 'Results', value: 'Posted in {channel:tournamentResults} once verified by the team.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'streamers',
      channelNames: ['streamers', 'streams', 'live'],
      embeds: infoEmbeds(
        'streamers',
        { title: '📺 Streamers', description: 'Vous streamez Redemption Story Battle Royale ? Ouvrez un ticket dans {channel:ticket} avec le lien de votre chaîne pour obtenir le rôle 🎥 Streamer et être mis en avant ici.' },
        { title: '📺 Streamers', description: 'Streaming Redemption Story Battle Royale? Open a ticket in {channel:ticket} with your channel link to get the 🎥 Streamer role and be featured here.' },
      ),
    },
  ],
};
