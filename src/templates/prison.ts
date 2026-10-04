import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_PLAYER, QUESTION_PROOF, ROLE_NAMES, STD, cat, ch, infoEmbeds, paymentMethodsInfo, rulesEmbeds, ticketCategory, ticketPanelEmbed, welcomeContent } from './common';
import type { ServerTemplate } from './types';

const STAFF = [...ROLE_NAMES.support, ...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam, 'Staff'];
const WHITELIST = ['whitelist-info', 'whitelist', 'candidatures', 'candidature', 'applications', 'wl'];
const LORE = ['lore', 'presentation', 'présentation', 'histoire', 'story'];
const RP_RULES = ['regles-rp', 'règles-rp', 'rp-rules', 'reglement-rp', 'règlement-rp'];
const PATCH_NOTES = ['patch-notes', 'patchnotes', 'changelog', 'updates', 'mises-a-jour'];
const welcome = welcomeContent({
  tagline: {
    fr: 'Bienvenue sur **Redemption Story WL**, serveur Prison RP whitelist. Lisez le règlement, puis déposez votre candidature pour rejoindre la détention.',
    en: 'Welcome to **Redemption Story WL**, a whitelisted Prison RP server. Read the rules, then apply to join the facility.',
  },
  extraFields: [
    { fr: { name: '📝 Whitelist', value: 'Candidature : {channel:whitelist} (`/whitelist apply`)' }, en: { name: '📝 Whitelist', value: 'Application: {channel:whitelist} (`/whitelist apply`)' } },
    { fr: { name: '📖 Lore', value: 'L’histoire du pénitencier : {channel:lore}' }, en: { name: '📖 Lore', value: 'The penitentiary’s story: {channel:lore}' } },
  ],
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
    whitelist: WHITELIST,
    lore: LORE,
    rpRules: RP_RULES,
    patchNotes: PATCH_NOTES,
    general: [...NAMES.general],
    screenshots: [...NAMES.screenshots],
    support: [...NAMES.support],
    suggestions: [...NAMES.suggestions],
    bugs: [...NAMES.bugs],
    events: [...NAMES.events],
    serverStatus: [...NAMES.serverStatus],
    store: [...NAMES.store],
    paymentMethods: [...NAMES.paymentMethods],
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
        fr: 'Roleplay** — Le RP se joue en jeu : pas de métagaming, de powergaming ni de règlement de comptes hors RP sur le Discord. Règlement RP détaillé dans {channel:rpRules} ; les signalements se font par ticket.',
        en: 'Roleplay** — RP happens in game: no metagaming, powergaming or out-of-character disputes on Discord. Detailed RP rules in {channel:rpRules}; reports go through tickets.',
      },
    }),
  },
  logChannels: {
    MODERATION: ['mod-logs', 'moderation', 'sanctions', 'reports', 'signalements', ...NAMES.staffChat],
    WHITELIST: ['whitelist-review', 'whitelist-logs', 'wl-logs', 'candidatures-staff', ...NAMES.staffChat],
    SECURITY: ['security-logs', 'securite', ...NAMES.logs, ...NAMES.staffChat],
    SYSTEM: [...NAMES.bugManagement, ...NAMES.logs, ...NAMES.staffChat],
    TICKET: [...NAMES.staffTasks, 'ticket-logs', ...NAMES.staffChat],
    MEMBER: ['member-logs', ...NAMES.logs, ...NAMES.staffChat],
    MESSAGE: ['message-logs', ...NAMES.logs, ...NAMES.staffChat],
    ROLE: [...NAMES.logs, ...NAMES.staffChat],
    CHANNEL: [...NAMES.logs, ...NAMES.staffChat],
    VOICE: [...NAMES.logs, ...NAMES.staffChat],
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
        categoryNames: ['tickets-whitelist', 'whitelist-tickets', 'tickets'],
        createCategoryName: '📝 Tickets Whitelist',
        staffRoleNames: STAFF,
        questions: [
          { id: 'identifier', label: { fr: 'Identifiant FiveM (license:…)', en: 'FiveM identifier (license:…)' }, placeholder: { fr: 'Visible dans vos paramètres FiveM', en: 'Visible in your FiveM settings' }, style: 'short', required: false },
          QUESTION_DETAILS,
        ],
      },
      {
        key: 'support',
        emoji: '🎫',
        label: { fr: 'Support', en: 'Support' },
        description: { fr: 'Aide, question ou problème technique', en: 'Help, question or technical issue' },
        categoryNames: ['tickets-support', 'support-tickets', 'tickets'],
        createCategoryName: '🎫 Tickets Support',
        staffRoleNames: STAFF,
        questions: [
          { id: 'topic', label: { fr: 'Sujet', en: 'Topic' }, placeholder: { fr: 'Connexion, bug, personnage, question…', en: 'Connection, bug, character, question…' }, style: 'short', required: true },
          QUESTION_DETAILS,
        ],
      },
      {
        key: 'report',
        emoji: '🚨',
        label: { fr: 'Signalement', en: 'Report' },
        description: { fr: 'Signaler un joueur ou un comportement', en: 'Report a player or behaviour' },
        categoryNames: ['tickets-signalement', 'signalement-tickets', 'reports-tickets', 'tickets'],
        createCategoryName: '🚨 Tickets Signalement',
        staffRoleNames: [...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam],
        questions: [
          QUESTION_PLAYER,
          { id: 'when', label: { fr: 'Quand et où ?', en: 'When and where?' }, placeholder: { fr: 'Date, heure, lieu (cour, bloc B, Discord…)', en: 'Date, time, place (yard, block B, Discord…)' }, style: 'short', required: true },
          QUESTION_DETAILS,
          QUESTION_PROOF,
        ],
      },
      {
        key: 'unban',
        emoji: '⚠️',
        label: { fr: 'Demande d’unban', en: 'Unban request' },
        description: { fr: 'Contester un bannissement ou une sanction', en: 'Appeal a ban or a sanction' },
        categoryNames: ['tickets-unban', 'unban-tickets', 'unban', 'ban-appeal', 'tickets'],
        createCategoryName: '⚠️ Tickets Unban',
        staffRoleNames: [...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam],
        questions: [
          { id: 'sanction', label: { fr: 'Sanction reçue (date, raison)', en: 'Sanction received (date, reason)' }, placeholder: { fr: 'Ex. ban le 12/03 pour RDM', en: 'E.g. banned on 03/12 for RDM' }, style: 'short', required: true },
          { id: 'appeal', label: { fr: 'Pourquoi devrions-nous la lever ?', en: 'Why should we lift it?' }, placeholder: { fr: 'Expliquez calmement votre situation', en: 'Calmly explain your situation' }, style: 'paragraph', required: true },
        ],
      },
    ],
    panel: {
      channelNames: [...NAMES.ticket],
      style: 'SELECT',
      embed: ticketPanelEmbed({ subtitle: { fr: 'Whitelist, support, signalement ou demande d’unban.', en: 'Whitelist, support, report or unban request.' } }),
    },
  },
  notifications: {
    items: [NOTIF.announcements, NOTIF.events, NOTIF.whitelist, NOTIF.updates],
    panelChannelNames: [...NAMES.notifications, ...NAMES.welcome],
  },
  language: { panelChannelNames: [...NAMES.languages], announcements: false },
  fivem: { statusChannelNames: [...NAMES.serverStatus] },
  structure: {
    categories: [
      cat('information', '📢 INFORMATION', 'public', [
        STD.welcome(),
        STD.rules(),
        STD.announcements(),
        ch('whitelist', '📝・whitelist-info', 'readonly', { aliases: WHITELIST, topic: { fr: 'Comment obtenir la whitelist (`/whitelist apply`).', en: 'How to get whitelisted (`/whitelist apply`).' } }),
        ch('patchNotes', '🛠️・patch-notes', 'readonly', { aliases: PATCH_NOTES, topic: { fr: 'Notes de mise à jour du serveur.', en: 'Server update notes.' } }),
        STD.serverStatus(),
      ], ['infos', 'informations']),
      cat('roleplay', '🔒 ROLEPLAY', 'public', [
        ch('lore', '📖・lore', 'readonly', { aliases: LORE, topic: { fr: 'Présentation et histoire du pénitencier.', en: 'Presentation and story of the penitentiary.' } }),
        ch('rpRules', '📕・règles-rp', 'readonly', { aliases: RP_RULES, topic: { fr: 'Règlement RP détaillé (RDM, VDM, metagaming…).', en: 'Detailed RP rules (RDM, VDM, metagaming…).' } }),
        ch('screenshots', '📸・screenshots', 'chat', { aliases: NAMES.screenshots, topic: { fr: 'Vos captures et clips RP.', en: 'Your RP screenshots and clips.' } }),
        STD.general('💬・général'),
      ], ['rp']),
      cat('support', '🛠️ SUPPORT', 'public', [STD.ticket(), STD.bugs(), STD.suggestions()], ['aide', 'help']),
      cat('staff', '👑 STAFF', 'staff', [
        STD.staffChat(),
        STD.staffTasks(),
        ch('whitelistReview', '📝・whitelist-review', 'staff', { aliases: ['whitelist-logs', 'wl-logs', 'candidatures-staff'], topic: { fr: 'Candidatures whitelist à examiner (`/whitelist review`).', en: 'Whitelist applications to review (`/whitelist review`).' } }),
        ch('reports', '🚨・reports', 'staff', { aliases: ['signalements', 'mod-logs', 'sanctions'], topic: { fr: 'Signalements et logs de modération.', en: 'Reports and moderation logs.' } }),
        STD.logs(),
      ]),
      ticketCategory('ticketsWhitelist', '📝 Tickets Whitelist', ['tickets-whitelist', 'whitelist-tickets']),
      ticketCategory('ticketsSupport', '🎫 Tickets Support', ['tickets-support', 'support-tickets']),
      ticketCategory('ticketsReport', '🚨 Tickets Signalement', ['tickets-signalement', 'reports-tickets']),
      ticketCategory('ticketsUnban', '⚠️ Tickets Unban', ['tickets-unban', 'unban-tickets', 'ban-appeal']),
    ],
  },
  infoMessages: [
    {
      key: 'whitelist',
      channelNames: WHITELIST,
      embeds: infoEmbeds(
        'whitelist',
        {
          title: '📝 Whitelist — comment postuler',
          description: 'L’accès au serveur est réservé aux joueurs whitelistés. La procédure est simple et se fait entièrement sur Discord.',
          fields: [
            { name: '1. Lisez les règlements', value: '{channel:rules} et {channel:rpRules} — toute candidature qui les ignore est refusée. Le lore ({channel:lore}) vous aidera à construire un personnage cohérent.', inline: false },
            { name: '2. Postulez', value: 'Utilisez `/whitelist apply` (identifiant FiveM `license:…` conseillé) et répondez au formulaire : histoire de votre personnage, expérience RP, disponibilités, motivation.', inline: false },
            { name: '3. Critères', value: '• 16 ans minimum, micro fonctionnel\n• Une histoire de personnage crédible dans l’univers carcéral (pas de super-criminel ni de passé irréaliste)\n• Connaissance des bases du RP (RDM, VDM, metagaming, powergaming)\n• Aucune sanction récente sur le serveur', inline: false },
            { name: '4. Délai et réponse', value: 'Un membre de l’équipe examine chaque dossier sous **48 h**. Suivez l’état avec `/whitelist status` ; vous êtes prévenu en message privé et recevez le rôle 🔓 Whitelisted une fois accepté. En cas de refus, vous pouvez repostuler après 7 jours.', inline: false },
            { name: 'Question ?', value: 'Ouvrez un ticket **📝 Whitelist** dans {channel:ticket}.', inline: false },
          ],
        },
        {
          title: '📝 Whitelist — how to apply',
          description: 'Access to the server is reserved for whitelisted players. The process is simple and happens entirely on Discord.',
          fields: [
            { name: '1. Read the rules', value: '{channel:rules} and {channel:rpRules} — any application ignoring them is rejected. The lore ({channel:lore}) will help you build a consistent character.', inline: false },
            { name: '2. Apply', value: 'Use `/whitelist apply` (FiveM identifier `license:…` recommended) and answer the form: character backstory, RP experience, availability, motivation.', inline: false },
            { name: '3. Criteria', value: '• 16 years old minimum, working microphone\n• A credible character backstory in a prison setting (no super-criminal or unrealistic past)\n• Knowledge of RP basics (RDM, VDM, metagaming, powergaming)\n• No recent sanction on the server', inline: false },
            { name: '4. Delay and answer', value: 'A team member reviews every application within **48 h**. Track it with `/whitelist status`; you are notified by DM and receive the 🔓 Whitelisted role once accepted. If rejected, you can apply again after 7 days.', inline: false },
            { name: 'Question?', value: 'Open a **📝 Whitelist** ticket in {channel:ticket}.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'rp-rules',
      channelNames: RP_RULES,
      embeds: infoEmbeds(
        'rp-rules',
        {
          title: '📕 Règlement RP — Redemption Story WL',
          description: [
            '**1. Micro obligatoire** — Le RP se joue au micro, de qualité correcte, sans musique ni bruit de fond. Pas de micro = pas de RP.',
            '**2. RDM (Random Deathmatch)** — Interdit de blesser ou tuer un joueur sans raison RP construite et sans interaction préalable. Une bagarre se joue, elle ne se déclenche pas gratuitement.',
            '**3. VDM (Vehicle Deathmatch)** — Interdit d’utiliser un véhicule comme arme (transports, véhicules du personnel).',
            '**4. Metagaming** — Interdit d’utiliser en jeu une information obtenue hors RP (Discord, stream, messages privés). Le hors-RP se fait entre doubles parenthèses `(( … ))`.',
            '**5. Powergaming** — Pas d’actions irréalistes ni imposées sans laisser de réponse à l’autre (« je te désarme et tu ne peux rien faire »). Le `/me` décrit, il n’impose pas.',
            '**6. Fail RP** — Restez cohérent avec votre personnage et l’univers carcéral : pas de « no fear » face aux gardiens armés, pas de fuite systématique, pas de comportement irréaliste pour échapper aux conséquences.',
            '**7. Valeur de la vie** — Votre personnage tient à sa vie : sous la menace, il obéit. Une mort RP (si validée par le staff) implique un nouveau personnage.',
            '**8. Gardiens et administration** — Le personnel pénitentiaire est joué par des rôles de confiance : pas d’abus de pouvoir, pas de corruption non validée par le staff.',
            '**9. Respect du staff** — Les décisions du staff s’appliquent immédiatement, en jeu ou sur le Discord ; elles se contestent ensuite par ticket **⚠️ Demande d’unban** dans {channel:ticket}, jamais en public.',
            '**10. Sanctions** — Avertissement, retrait de whitelist, bannissement temporaire ou définitif selon la gravité. Tout signalement passe par ticket **🚨 Signalement** avec preuves (clips, captures).',
          ].join('\n\n'),
        },
        {
          title: '📕 RP rules — Redemption Story WL',
          description: [
            '**1. Microphone required** — RP is played on mic, with decent quality, no music or background noise. No mic = no RP.',
            '**2. RDM (Random Deathmatch)** — Hurting or killing a player without a built RP reason and prior interaction is forbidden. A fight is played, it does not start for free.',
            '**3. VDM (Vehicle Deathmatch)** — Using a vehicle as a weapon (transports, staff vehicles) is forbidden.',
            '**4. Metagaming** — Using in game information obtained out of RP (Discord, streams, DMs) is forbidden. Out-of-character talk goes between double brackets `(( … ))`.',
            '**5. Powergaming** — No unrealistic actions and nothing forced on others without letting them respond (“I disarm you and you can’t do anything”). `/me` describes, it does not impose.',
            '**6. Fail RP** — Stay consistent with your character and the prison setting: no “no fear” in front of armed guards, no systematic escape, no unrealistic behaviour to dodge consequences.',
            '**7. Value of life** — Your character cares about their life: under threat, they comply. An RP death (if validated by the staff) means a new character.',
            '**8. Guards and administration** — Prison staff are played by trusted roles: no abuse of power, no corruption unless validated by the staff.',
            '**9. Respect the staff** — Staff decisions apply immediately, in game or on Discord; they can be appealed afterwards through an **⚠️ Unban request** ticket in {channel:ticket}, never in public.',
            '**10. Sanctions** — Warning, whitelist removal, temporary or permanent ban depending on severity. Every report goes through a **🚨 Report** ticket with evidence (clips, screenshots).',
          ].join('\n\n'),
        },
      ),
    },
    {
      key: 'lore',
      channelNames: LORE,
      embeds: infoEmbeds(
        'lore',
        {
          title: '📖 Pénitencier de Redemption — présentation',
          description: 'Perché sur une falaise battue par les vents, le **pénitencier de Redemption** accueille depuis 1974 les détenus que l’État ne sait plus où placer : braqueurs repentis, petites frappes, caïds déchus et quelques innocents qui attendent encore leur procès. Derrière ses murs, une société à part entière s’est construite, avec ses codes, ses alliances et ses dettes.\n\nIci, chacun écrit sa propre histoire : purger sa peine en silence, prendre la tête d’un bloc, négocier avec l’administration ou préparer la grande évasion. Les gardiens, eux, tiennent la ligne entre l’ordre et le chaos — pas toujours du bon côté.\n\n*Ce texte est un point de départ : l’équipe peut le modifier à tout moment pour l’adapter à l’histoire du serveur.*',
          fields: [
            { name: '🏛️ Les lieux', value: '• **Bloc A** — nouveaux arrivants et courtes peines\n• **Bloc B** — longues peines, territoire des gangs\n• **La cour** — promenade, sport et règlements de comptes\n• **L’atelier et la cuisine** — travail, contrebande\n• **Le quartier d’isolement** — pour ceux qui ont trop parlé', inline: false },
            { name: '👥 Les factions', value: '• **Détenus** — gangs, indépendants, « anciens »\n• **Gardiens** — surveillants, chef de bloc, directeur\n• **Personnel civil** — infirmerie, aumônerie, avocats et visiteurs', inline: false },
            { name: '🎭 Votre personnage', value: 'Construisez une histoire crédible : pourquoi est-il ici, combien de temps, qui l’attend dehors ? Respectez les règles de {channel:rpRules} et déposez votre candidature dans {channel:whitelist}.', inline: false },
          ],
        },
        {
          title: '📖 Redemption Penitentiary — presentation',
          description: 'Perched on a windswept cliff, **Redemption Penitentiary** has housed since 1974 the inmates the State no longer knows where to put: repentant robbers, small-time crooks, fallen kingpins and a few innocents still waiting for trial. Behind its walls, a whole society has grown, with its codes, its alliances and its debts.\n\nHere, everyone writes their own story: serve your time quietly, take over a block, negotiate with the administration or plan the great escape. The guards hold the line between order and chaos — not always on the right side.\n\n*This text is a starting point: the team can edit it at any time to fit the server’s story.*',
          fields: [
            { name: '🏛️ The places', value: '• **Block A** — newcomers and short sentences\n• **Block B** — long sentences, gang territory\n• **The yard** — walks, sports and score settling\n• **The workshop and the kitchen** — work, smuggling\n• **Solitary** — for those who talked too much', inline: false },
            { name: '👥 The factions', value: '• **Inmates** — gangs, independents, “old-timers”\n• **Guards** — officers, block chief, warden\n• **Civilian staff** — infirmary, chaplaincy, lawyers and visitors', inline: false },
            { name: '🎭 Your character', value: 'Build a credible story: why are they here, for how long, who waits for them outside? Follow the rules in {channel:rpRules} and apply in {channel:whitelist}.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'server-status',
      channelNames: [...NAMES.serverStatus],
      embeds: infoEmbeds(
        'server-status',
        { title: '📡 Statut du serveur', description: 'Ce salon affiche le **statut en direct du serveur FiveM** : en ligne / hors ligne, joueurs connectés, pic de la journée et maintenance en cours. Le message est mis à jour automatiquement par le bot une fois le serveur ajouté avec `/fivem add`.\n\n• `/fivem status` — statut à la demande\n• `/fivem players` — joueurs connectés\n• Les maintenances sont annoncées ici et dans {channel:announcements} ; les nouveautés dans {channel:patchNotes}.\n\nSi le serveur apparaît hors ligne alors que vous êtes connecté, prévenez l’équipe dans {channel:bugs}.' },
        { title: '📡 Server status', description: 'This channel shows the **live status of the FiveM server**: online / offline, connected players, daily peak and ongoing maintenance. The message is updated automatically by the bot once the server is added with `/fivem add`.\n\n• `/fivem status` — status on demand\n• `/fivem players` — connected players\n• Maintenance is announced here and in {channel:announcements}; new features in {channel:patchNotes}.\n\nIf the server shows offline while you are connected, tell the team in {channel:bugs}.' },
      ),
    },
    paymentMethodsInfo({
      optional: true,
      shopLabel: { fr: 'la boutique du serveur ({channel:store})', en: 'the server store ({channel:store})' },
      delivery: { fr: 'Les packs de soutien (cosmétiques, tenues, priorité de file d’attente) sont crédités en jeu dans les minutes qui suivent le paiement ; aucun avantage RP n’est vendu.', en: 'Supporter packs (cosmetics, outfits, queue priority) are credited in game within minutes of payment; no RP advantage is sold.' },
    }),
  ],
};
