import { LANGUAGES } from '../config/constants';
import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_ORDER, QUESTION_PLAYER, QUESTION_PROOF, QUESTION_STEPS, ROLE_NAMES, STD, cat, ch, infoEmbeds, paymentMethodsInfo, rulesEmbeds, ticketCategory, ticketPanelEmbed, voice, welcomeContent } from './common';
import type { ServerTemplate, StructureChannel } from './types';

/** Salons de discussion par langue (`🇫🇷・french`…), mappés sur `languageChannels` par l'étape `language`. */
const LANGUAGE_CHANNELS: Record<string, string[]> = {
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
};
const languageStructure: StructureChannel[] = LANGUAGES.filter((l) => LANGUAGE_CHANNELS[l.code]).map((l) =>
  ch(`lang_${l.code}`, `${l.flag}・${LANGUAGE_CHANNELS[l.code]![0]}`, 'chat', { aliases: LANGUAGE_CHANNELS[l.code], topic: { fr: `Salon ${l.nativeLabel}.`, en: `${l.nativeLabel} channel.` } }),
);

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
    boosts: ['boosts', 'boost', 'server-boosts'],
    general: [...NAMES.general],
    polls: [...NAMES.polls],
    giveaways: [...NAMES.giveaways],
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
    channelNames: LANGUAGE_CHANNELS,
  },
  fivem: { statusChannelNames: ['stats', 'server-status', 'status', 'statut'] },
  structure: {
    categories: [
      cat('information', '📢 INFORMATION', 'public', [
        STD.welcome(),
        STD.rules(),
        STD.announcements(),
        ch('howToPlay', '🗺️・how-to-play', 'readonly', { aliases: ['guide', 'comment-jouer', 'tutorial'], topic: { fr: 'Guide du joueur : rejoindre, jouer, progresser.', en: 'Player guide: join, play, progress.' } }),
        ch('leaderboards', '🏆・leaderboards', 'readonly', { aliases: ['leaderboard', 'classements', 'classement'], topic: { fr: 'Classements de la saison (`/leaderboard`).', en: 'Season leaderboards (`/leaderboard`).' } }),
        STD.events(),
      ], ['infos', 'informations']),
      cat('store', '🛒 STORE', 'public', [
        ch('store', '🛍️・store', 'readonly', { aliases: NAMES.store, topic: { fr: 'Battle Pass premium et cosmétiques.', en: 'Premium Battle Pass and cosmetics.' } }),
        STD.payment(),
        STD.giveaways(),
      ], ['shop', 'boutique']),
      cat('community', '💬 COMMUNITY', 'public', [
        STD.general(),
        ch('boosts', '💎・boosts', 'readonly', { aliases: ['boost', 'server-boosts'], topic: { fr: 'Merci aux boosters du serveur !', en: 'Thanks to our server boosters!' } }),
        ch('clips', '📸・clips-and-screenshots', 'chat', { aliases: NAMES.screenshots, topic: { fr: 'Vos meilleurs clips et captures.', en: 'Your best clips and screenshots.' } }),
        ch('stats', '📊・stats', 'readonly', { aliases: NAMES.serverStatus, topic: { fr: 'Statut du serveur FiveM en direct.', en: 'Live FiveM server status.' } }),
        ch('streamers', '📺・streamers', 'readonly', { aliases: ['streams', 'live'], topic: { fr: 'Streamers partenaires et lives en cours.', en: 'Partner streamers and current lives.' } }),
        STD.polls(),
        ...languageStructure,
      ], ['communaute', 'communauté']),
      cat('competition', '🏆 COMPETITION', 'public', [
        ch('tournamentInfo', '📅・tournament-info', 'readonly', { aliases: ['tournaments', 'tournois'], topic: { fr: 'Format, règles et inscriptions des tournois.', en: 'Tournament format, rules and sign-ups.' } }),
        ch('tournamentResults', '📊・tournament-results', 'readonly', { aliases: ['resultats', 'results'], topic: { fr: 'Résultats officiels des tournois.', en: 'Official tournament results.' } }),
        voice('tournamentVoice', '🔊 Tournament'),
      ], ['competitions', 'esport']),
      cat('support', '🛠️ SUPPORT', 'public', [
        STD.ticket(),
        STD.bugs(),
        STD.suggestions(),
        voice('supportVoice1', '🔊 Support 1', 'support-voice'),
        voice('supportVoice2', '🔊 Support 2', 'support-voice'),
        voice('supportVoice3', '🔊 Support 3', 'support-voice'),
        { key: 'privateSupport', name: '🔒 Private Support', type: 'voice', preset: 'staff' },
      ], ['aide', 'help']),
      cat('staff', '👑 STAFF', 'staff', [
        STD.staffChat(),
        ch('staffAnnouncements', '📢・staff-announcements', 'staff', { aliases: ['staff-annonces'], topic: { fr: 'Annonces internes et logs sécurité.', en: 'Internal announcements and security logs.' } }),
        STD.staffTasks(),
        ch('playerReports', '🚨・player-reports', 'staff', { aliases: ['reports', 'signalements'], topic: { fr: 'Signalements de joueurs et logs de modération.', en: 'Player reports and moderation logs.' } }),
        ch('tournamentManagement', '🎯・tournament-management', 'staff', { aliases: ['tournaments-management'], topic: { fr: 'Organisation des tournois et logs Battle Royale.', en: 'Tournament organisation and Battle Royale logs.' } }),
        ch('eventManagement', '🏆・event-management', 'staff', { aliases: ['events-management'], topic: { fr: 'Organisation des événements et logs d’annonces.', en: 'Event organisation and announcement logs.' } }),
        STD.bugManagement(),
        ch('staffTemplates', '📚・staff-templates', 'staff', { aliases: ['templates', 'modeles'], topic: { fr: 'Modèles de messages et d’embeds (`/embed template`).', en: 'Message and embed templates (`/embed template`).' } }),
        voice('staffVoice', '🔊 Staff Voice'),
      ]),
      ticketCategory('ticketsSupport', '🎫 GENERAL SUPPORT', ['general-support', 'support-tickets']),
      ticketCategory('ticketsBug', '🐛 BUG REPORT', ['bug-report', 'bugs-tickets']),
      ticketCategory('ticketsReport', '🚨 PLAYER REPORT', ['player-report', 'reports-tickets']),
      ticketCategory('ticketsAppeal', '⚠️ BAN APPEAL', ['ban-appeal', 'appeals', 'unban']),
      ticketCategory('ticketsPayment', '💳 PAYMENT SUPPORT', ['payment-support', 'payments-tickets']),
    ],
  },
  infoMessages: [
    {
      key: 'how-to-play',
      channelNames: ['how-to-play', 'guide', 'comment-jouer'],
      embeds: infoEmbeds(
        'how-to-play',
        {
          title: '🗺️ Comment jouer',
          description: 'Tout ce qu’il faut savoir pour votre première partie sur **Redemption Story Battle Royale**, de la connexion au classement.',
          fields: [
            { name: '1. Rejoindre le serveur', value: 'Lancez **FiveM**, ouvrez la liste des serveurs et cherchez **Redemption Story**, ou tapez l’adresse publiée dans {channel:announcements} (`F8` → `connect <adresse>`). Le statut du serveur est visible en direct dans {channel:stats}.', inline: false },
            { name: '2. Lier votre compte', value: 'Tapez `/br-link` sur le Discord et suivez les instructions : votre progression (XP, niveaux, Battle Pass, classements) est alors synchronisée avec votre profil Discord.', inline: false },
            { name: '3. Le lobby', value: 'Au spawn vous arrivez dans le lobby : choisissez un mode (**solo**, **duo**, **squad**), formez votre équipe et rejoignez la file. La partie démarre dès que le lobby est plein ou que le compte à rebours se termine.', inline: false },
            { name: '4. Le largage et le loot', value: 'Choisissez votre point de chute sur la carte, puis fouillez bâtiments et caisses : armes (rareté commune → légendaire), armures, soins, munitions. Les zones à haut risque offrent le meilleur loot.', inline: false },
            { name: '5. La zone', value: 'Une zone bleue se referme par paliers : restez à l’intérieur ou perdez de la vie chaque seconde. Les dernières zones forcent l’affrontement — anticipez vos déplacements et vos véhicules.', inline: false },
            { name: '6. XP, niveaux et Battle Pass', value: 'Chaque partie rapporte de l’**XP** selon le placement, les éliminations et les dégâts. L’XP fait monter votre **niveau** et avance votre **Battle Pass** (récompenses gratuites ; la version premium débloque des cosmétiques exclusifs, voir {channel:store}).', inline: false },
            { name: '7. Classements', value: 'Victoires, éliminations, niveau et K/D sont classés chaque saison dans {channel:leaderboards}.', inline: false },
            { name: 'Commandes utiles', value: '`/profile` — vos statistiques · `/leaderboard` — le top de la saison · `/battlepass` — votre progression · `/br-link` — lier votre compte', inline: false },
            { name: 'Besoin d’aide ?', value: 'Ouvrez un ticket dans {channel:ticket} ou rejoignez un vocal **Support**.', inline: false },
          ],
        },
        {
          title: '🗺️ How to play',
          description: 'Everything you need to know for your first match on **Redemption Story Battle Royale**, from connecting to the leaderboard.',
          fields: [
            { name: '1. Join the server', value: 'Launch **FiveM**, open the server list and search for **Redemption Story**, or type the address posted in {channel:announcements} (`F8` → `connect <address>`). The live server status is in {channel:stats}.', inline: false },
            { name: '2. Link your account', value: 'Type `/br-link` on Discord and follow the instructions: your progress (XP, levels, Battle Pass, leaderboards) is then synced with your Discord profile.', inline: false },
            { name: '3. The lobby', value: 'You spawn in the lobby: pick a mode (**solo**, **duo**, **squad**), build your team and join the queue. The match starts as soon as the lobby is full or the countdown ends.', inline: false },
            { name: '4. Drop and loot', value: 'Pick your landing spot on the map, then search buildings and crates: weapons (common → legendary rarity), armour, heals, ammo. High-risk areas hold the best loot.', inline: false },
            { name: '5. The zone', value: 'A blue zone shrinks in stages: stay inside or lose health every second. The final zones force the fight — plan your moves and vehicles ahead.', inline: false },
            { name: '6. XP, levels and Battle Pass', value: 'Every match grants **XP** based on placement, eliminations and damage. XP raises your **level** and advances your **Battle Pass** (free rewards; the premium track unlocks exclusive cosmetics, see {channel:store}).', inline: false },
            { name: '7. Leaderboards', value: 'Wins, kills, level and K/D are ranked every season in {channel:leaderboards}.', inline: false },
            { name: 'Useful commands', value: '`/profile` — your stats · `/leaderboard` — the season top · `/battlepass` — your progress · `/br-link` — link your account', inline: false },
            { name: 'Need help?', value: 'Open a ticket in {channel:ticket} or join a **Support** voice channel.', inline: false },
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
          description: 'Les classements sont mis à jour automatiquement à chaque fin de partie et remis à zéro à chaque saison. Liez votre compte avec `/br-link` pour y apparaître.',
          fields: [
            { name: 'Catégories', value: '• **Victoires** — parties gagnées\n• **Éliminations** — kills cumulés\n• **Niveau** — XP de la saison\n• **K/D** — ratio éliminations / morts', inline: false },
            { name: 'Saisons', value: 'À la fin de chaque saison, les meilleurs reçoivent le rôle 🏆 Tournament Winner et des récompenses exclusives, annoncées dans {channel:announcements}.', inline: false },
            { name: 'Commandes', value: '`/leaderboard metric:wins` · `/leaderboard metric:kills` · `/leaderboard metric:level` · `/leaderboard metric:kd` (option `season` pour une saison passée) · `/profile` pour vos statistiques.', inline: false },
          ],
        },
        {
          title: '🏆 Leaderboards',
          description: 'Leaderboards are updated automatically at the end of every match and reset every season. Link your account with `/br-link` to appear in them.',
          fields: [
            { name: 'Categories', value: '• **Wins** — matches won\n• **Kills** — total eliminations\n• **Level** — season XP\n• **K/D** — kills / deaths ratio', inline: false },
            { name: 'Seasons', value: 'At the end of every season the best players receive the 🏆 Tournament Winner role and exclusive rewards, announced in {channel:announcements}.', inline: false },
            { name: 'Commands', value: '`/leaderboard metric:wins` · `/leaderboard metric:kills` · `/leaderboard metric:level` · `/leaderboard metric:kd` (`season` option for a past season) · `/profile` for your own stats.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'store',
      channelNames: [...NAMES.store],
      embeds: infoEmbeds(
        'store',
        {
          title: '🛍️ Boutique',
          description: 'Soutenez le serveur et personnalisez votre expérience. Tout est **cosmétique** : aucun avantage en jeu n’est vendu.',
          fields: [
            { name: '⭐ Battle Pass premium', value: 'Débloque la piste premium de la saison : skins, emotes, parachutes, traînées et XP bonus à chaque palier. Progression visible avec `/battlepass`.', inline: false },
            { name: '🎨 Cosmétiques', value: 'Skins de personnage, d’armes et de véhicules, packs saisonniers et bundles exclusifs.', inline: false },
            { name: '💎 Boosts', value: 'Le boost Discord du serveur offre un rôle exclusif et un remerciement dans {channel:boosts}.', inline: false },
            { name: 'Acheter', value: 'Boutique officielle : `https://store.redemption-story.example` *(lien à remplacer par votre boutique Tebex)*. Moyens de paiement et remboursements : {channel:paymentMethods}.', inline: false },
            { name: 'Un problème ?', value: 'Ouvrez un ticket **💳 Payment Support** dans {channel:ticket}.', inline: false },
          ],
        },
        {
          title: '🛍️ Store',
          description: 'Support the server and customise your experience. Everything is **cosmetic**: no in-game advantage is sold.',
          fields: [
            { name: '⭐ Premium Battle Pass', value: 'Unlocks the season’s premium track: skins, emotes, parachutes, trails and bonus XP at every tier. Track your progress with `/battlepass`.', inline: false },
            { name: '🎨 Cosmetics', value: 'Character, weapon and vehicle skins, seasonal packs and exclusive bundles.', inline: false },
            { name: '💎 Boosts', value: 'Boosting the Discord server grants an exclusive role and a thank-you in {channel:boosts}.', inline: false },
            { name: 'Buy', value: 'Official store: `https://store.redemption-story.example` *(replace with your Tebex store link)*. Payment methods and refunds: {channel:paymentMethods}.', inline: false },
            { name: 'Issue?', value: 'Open a **💳 Payment Support** ticket in {channel:ticket}.', inline: false },
          ],
        },
      ),
    },
    paymentMethodsInfo({
      shopLabel: { fr: 'la boutique officielle ({channel:store})', en: 'the official store ({channel:store})' },
      delivery: { fr: 'Battle Pass et cosmétiques sont crédités **automatiquement** sur votre compte lié (`/br-link`) dans les minutes qui suivent le paiement. Reconnectez-vous au serveur si l’objet n’apparaît pas.', en: 'Battle Pass and cosmetics are credited **automatically** to your linked account (`/br-link`) within minutes of payment. Reconnect to the server if the item does not show up.' },
    }),
    {
      key: 'tournament-info',
      channelNames: ['tournament-info', 'tournaments', 'tournois'],
      embeds: infoEmbeds(
        'tournament-info',
        {
          title: '📅 Tournois',
          description: 'Des tournois sont organisés régulièrement, avec des récompenses en jeu et le rôle 🏆 Tournament Winner pour les vainqueurs.',
          fields: [
            { name: 'Format type', value: '• **Mode** : solo, duo ou squad selon l’événement\n• **Manches** : 4 à 6 parties, lobby privé\n• **Points** : placement (1er = 15 pts, dégressif) + 1 pt par élimination\n• **Égalité** : départagée au nombre de victoires puis d’éliminations', inline: false },
            { name: 'Inscription', value: 'Chaque tournoi est publié comme événement : inscrivez-vous via le bouton de l’événement dans {channel:events} (organisé avec `/event`). Activez la notification 🏆 Tournois pour être prévenu.', inline: false },
            { name: 'Règles', value: 'Le règlement général s’applique ({channel:rules}) : tout cheat, exploit ou team-up non autorisé entraîne une disqualification immédiate. Les litiges se traitent par ticket.', inline: false },
            { name: 'Résultats', value: 'Publiés dans {channel:tournamentResults} après vérification par l’équipe. Le vocal 🔊 Tournament est réservé aux participants pendant l’événement.', inline: false },
          ],
        },
        {
          title: '📅 Tournaments',
          description: 'Tournaments are organised regularly, with in-game rewards and the 🏆 Tournament Winner role for the winners.',
          fields: [
            { name: 'Typical format', value: '• **Mode**: solo, duo or squad depending on the event\n• **Rounds**: 4 to 6 matches, private lobby\n• **Points**: placement (1st = 15 pts, decreasing) + 1 pt per elimination\n• **Tie-break**: number of wins, then eliminations', inline: false },
            { name: 'Sign-up', value: 'Every tournament is posted as an event: sign up with the event button in {channel:events} (organised with `/event`). Enable the 🏆 Tournaments notification to be informed.', inline: false },
            { name: 'Rules', value: 'The general rules apply ({channel:rules}): any cheat, exploit or unauthorised teaming leads to immediate disqualification. Disputes go through tickets.', inline: false },
            { name: 'Results', value: 'Posted in {channel:tournamentResults} once verified by the team. The 🔊 Tournament voice channel is reserved for participants during the event.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'streamers',
      channelNames: ['streamers', 'streams', 'live'],
      embeds: infoEmbeds(
        'streamers',
        {
          title: '📺 Streamers',
          description: 'Vous streamez Redemption Story Battle Royale ? Obtenez le rôle 🎥 Streamer : vos lives sont mis en avant ici et vous êtes invité aux événements créateurs.',
          fields: [
            { name: 'Conditions', value: '• Streamer régulièrement le serveur (au moins 1 live par semaine)\n• Respecter le règlement en live comme en jeu\n• Chaîne Twitch, YouTube, Kick ou TikTok publique', inline: false },
            { name: 'Demande', value: 'Ouvrez un ticket **Support général** dans {channel:ticket} avec le lien de votre chaîne et vos horaires habituels. Réponse sous 48 h.', inline: false },
          ],
        },
        {
          title: '📺 Streamers',
          description: 'Streaming Redemption Story Battle Royale? Get the 🎥 Streamer role: your lives are featured here and you are invited to creator events.',
          fields: [
            { name: 'Requirements', value: '• Stream the server regularly (at least 1 live per week)\n• Follow the rules on stream and in game\n• Public Twitch, YouTube, Kick or TikTok channel', inline: false },
            { name: 'Request', value: 'Open a **General Support** ticket in {channel:ticket} with your channel link and usual schedule. Answer within 48 h.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'stats',
      channelNames: ['stats', 'server-status', 'status', 'statut'],
      embeds: infoEmbeds(
        'stats',
        { title: '📊 Statut du serveur', description: 'Ce salon affiche le **statut en direct du serveur FiveM** : en ligne / hors ligne, joueurs connectés, pic de la journée et maintenance en cours. Le message est mis à jour automatiquement par le bot.\n\n• `/fivem status` — statut à la demande\n• `/fivem players` — liste des joueurs connectés\n• Une maintenance est annoncée ici et dans {channel:announcements}.\n\nSi le serveur apparaît hors ligne alors que vous êtes connecté, prévenez l’équipe dans {channel:bugs}.' },
        { title: '📊 Server status', description: 'This channel shows the **live status of the FiveM server**: online / offline, connected players, daily peak and ongoing maintenance. The message is updated automatically by the bot.\n\n• `/fivem status` — status on demand\n• `/fivem players` — connected players\n• Maintenance is announced here and in {channel:announcements}.\n\nIf the server shows offline while you are connected, tell the team in {channel:bugs}.' },
      ),
    },
  ],
};
