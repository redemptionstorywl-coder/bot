import { NAMES, NOTIF, QUESTION_DETAILS, QUESTION_PLAYER, QUESTION_PROOF, ROLE_NAMES, STD, cat, ch, infoEmbeds, paymentMethodsInfo, rulesEmbeds, ticketCategory, ticketPanelEmbed, welcomeContent } from './common';
import type { ServerTemplate } from './types';

const STAFF = [...ROLE_NAMES.support, ...ROLE_NAMES.moderator, ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam, 'Staff'];
const TEACHERS = ['Professeur', 'Teacher', 'Directeur', 'Principal', ...ROLE_NAMES.admin, ...ROLE_NAMES.rsTeam];
const REGISTRATION = ['inscriptions', 'inscription', 'registration', 'registrations', 'whitelist'];
const APPLICATIONS = ['candidatures', 'candidature', 'applications', 'recrutement'];
const SCHEDULE = ['horaires', 'schedule', 'emploi-du-temps', 'planning'];
const welcome = welcomeContent({
  tagline: {
    fr: 'Bienvenue à **Redemption Story School RP**. Lisez le règlement, choisissez votre langue et inscrivez-vous pour rejoindre votre classe.',
    en: 'Welcome to **Redemption Story School RP**. Read the rules, pick your language and register to join your class.',
  },
  extraFields: [
    { fr: { name: '🎓 Inscription', value: 'Candidature : {channel:whitelist} (`/school register`)' }, en: { name: '🎓 Registration', value: 'Application: {channel:whitelist} (`/school register`)' } },
    { fr: { name: '🗓️ Horaires', value: 'Planning de la semaine : {channel:schedule}' }, en: { name: '🗓️ Schedule', value: 'Weekly schedule: {channel:schedule}' } },
  ],
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
    whitelist: [...REGISTRATION, ...APPLICATIONS],
    applications: [...APPLICATIONS],
    schedule: SCHEDULE,
    classes: ['classes', 'classe'],
    houses: ['maisons', 'maison', 'houses'],
    clubs: ['clubs', 'club'],
    schoolLife: ['vie-scolaire', 'school-life'],
    support: [...NAMES.support],
    suggestions: [...NAMES.suggestions],
    bugs: [...NAMES.bugs],
    events: [...NAMES.events],
    screenshots: [...NAMES.screenshots],
    store: [...NAMES.store],
    paymentMethods: [...NAMES.paymentMethods],
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
        fr: 'Roleplay** — Restez dans votre personnage en jeu : pas de métagaming ni de powergaming. Les conflits RP ne se règlent pas sur le Discord (règlement RP détaillé ci-dessous).',
        en: 'Roleplay** — Stay in character in game: no metagaming or powergaming. RP conflicts are not settled on Discord (detailed RP rules below).',
      },
    }),
  },
  logChannels: {
    MODERATION: ['mod-logs', 'moderation', 'sanctions', ...NAMES.staffChat],
    WHITELIST: ['inscriptions-staff', 'whitelist-logs', 'registration-logs', ...APPLICATIONS, ...NAMES.staffChat],
    SCHOOL: ['school-logs', ...NAMES.logs, ...NAMES.staffChat],
    SECURITY: ['security-logs', 'securite', ...NAMES.staffChat],
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
        emoji: '🎓',
        label: { fr: 'Inscription', en: 'Registration' },
        description: { fr: 'Question sur votre inscription ou votre classe', en: 'Question about your registration or class' },
        categoryNames: ['tickets-inscription', 'inscription-tickets', 'tickets'],
        createCategoryName: '🎓 Tickets Inscription',
        staffRoleNames: [...STAFF, 'Professeur', 'Teacher'],
        questions: [
          { id: 'character', label: { fr: 'Prénom et nom de votre personnage', en: 'Your character’s first and last name' }, placeholder: { fr: 'Ex. Léa Martin', en: 'E.g. Lea Martin' }, style: 'short', required: true },
          { id: 'status', label: { fr: 'Rôle souhaité', en: 'Desired role' }, placeholder: { fr: 'Élève / Professeur / Personnel', en: 'Student / Teacher / Staff' }, style: 'short', required: true },
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
          { id: 'topic', label: { fr: 'Sujet', en: 'Topic' }, placeholder: { fr: 'Connexion, bug, rôle, question…', en: 'Connection, bug, role, question…' }, style: 'short', required: true },
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
          { id: 'when', label: { fr: 'Quand et où ?', en: 'When and where?' }, placeholder: { fr: 'Date, heure, lieu (cour, salle 204, Discord…)', en: 'Date, time, place (yard, room 204, Discord…)' }, style: 'short', required: true },
          QUESTION_DETAILS,
          QUESTION_PROOF,
        ],
      },
      {
        key: 'application',
        emoji: '📝',
        label: { fr: 'Candidature', en: 'Application' },
        description: { fr: 'Postuler comme professeur, personnel ou staff', en: 'Apply as a teacher, school staff or moderator' },
        categoryNames: ['tickets-candidature', 'candidature-tickets', 'applications-tickets', 'tickets'],
        createCategoryName: '📝 Tickets Candidature',
        staffRoleNames: TEACHERS,
        questions: [
          { id: 'position', label: { fr: 'Poste visé', en: 'Position' }, placeholder: { fr: 'Professeur (matière), surveillant, modérateur…', en: 'Teacher (subject), supervisor, moderator…' }, style: 'short', required: true },
          { id: 'experience', label: { fr: 'Votre expérience RP / staff', en: 'Your RP / staff experience' }, placeholder: { fr: 'Serveurs, rôles tenus, durée', en: 'Servers, roles held, duration' }, style: 'paragraph', required: true },
          { id: 'availability', label: { fr: 'Disponibilités hebdomadaires', en: 'Weekly availability' }, placeholder: { fr: 'Ex. soirs de semaine + week-end', en: 'E.g. weekday evenings + weekends' }, style: 'short', required: true },
          { id: 'motivation', label: { fr: 'Motivation', en: 'Motivation' }, placeholder: { fr: 'Pourquoi vous, pourquoi ce poste ?', en: 'Why you, why this position?' }, style: 'paragraph', required: true },
        ],
      },
    ],
    panel: {
      channelNames: [...NAMES.ticket],
      style: 'SELECT',
      embed: ticketPanelEmbed({ subtitle: { fr: 'Inscription, support, signalement ou candidature.', en: 'Registration, support, report or application.' } }),
    },
  },
  notifications: {
    items: [NOTIF.announcements, NOTIF.events, NOTIF.whitelist, NOTIF.updates],
    panelChannelNames: [...NAMES.notifications, ...NAMES.welcome],
  },
  language: { panelChannelNames: [...NAMES.languages], announcements: false },
  fivem: { statusChannelNames: ['server-status', 'status', 'statut', 'stats'] },
  structure: {
    categories: [
      cat('information', '📢 INFORMATION', 'public', [
        STD.welcome('👋・bienvenue'),
        STD.rules('📜・règlement'),
        STD.announcements('📢・annonces'),
        ch('schedule', '🗓️・horaires', 'readonly', { aliases: SCHEDULE, topic: { fr: 'Planning hebdomadaire des cours et activités.', en: 'Weekly schedule of classes and activities.' } }),
        ch('inscriptions', '🎓・inscriptions', 'readonly', { aliases: REGISTRATION, topic: { fr: 'Comment rejoindre l’école (`/school register`).', en: 'How to join the school (`/school register`).' } }),
      ], ['infos', 'informations']),
      cat('school', '🏫 ÉCOLE', 'public', [
        ch('classes', '📚・classes', 'readonly', { aliases: ['classe'], topic: { fr: 'Classes de l’année (`/school class list`).', en: 'This year’s classes (`/school class list`).' } }),
        ch('houses', '🏠・maisons', 'readonly', { aliases: ['houses', 'maison'], topic: { fr: 'Les maisons et leur classement (`/school house leaderboard`).', en: 'Houses and their ranking (`/school house leaderboard`).' } }),
        ch('clubs', '🎭・clubs', 'chat', { aliases: ['club'], topic: { fr: 'Clubs de l’école : rejoignez-en un avec `/school club join`.', en: 'School clubs: join one with `/school club join`.' } }),
        ch('schoolLife', '🏫・vie-scolaire', 'chat', { aliases: ['school-life'], topic: { fr: 'Discussions RP entre élèves et professeurs.', en: 'RP discussions between students and teachers.' } }),
        ch('teachersRoom', '👩‍🏫・salle-des-professeurs', 'staff', { aliases: ['salle-des-profs', 'teachers-room', 'professeurs'], topic: { fr: 'Réservée aux professeurs et à la direction.', en: 'Teachers and management only.' } }),
      ], ['ecole', 'school']),
      cat('community', '💬 COMMUNAUTÉ', 'public', [
        STD.general('💬・général'),
        STD.suggestions(),
        ch('screenshots', '📸・screenshots', 'chat', { aliases: NAMES.screenshots, topic: { fr: 'Vos captures et moments RP.', en: 'Your screenshots and RP moments.' } }),
        STD.polls('📊・sondages'),
        STD.giveaways(),
      ], ['community', 'communaute']),
      cat('support', '🛠️ SUPPORT', 'public', [STD.ticket(), STD.bugs()], ['aide', 'help']),
      cat('staff', '👑 STAFF', 'staff', [
        STD.staffChat(),
        STD.staffTasks(),
        ch('applications', '📝・candidatures', 'staff', { aliases: APPLICATIONS, topic: { fr: 'Candidatures reçues (`/school apply`) et décisions.', en: 'Received applications (`/school apply`) and decisions.' } }),
        STD.logs(),
      ]),
      ticketCategory('ticketsRegistration', '🎓 Tickets Inscription', ['tickets-inscription', 'inscription-tickets']),
      ticketCategory('ticketsSupport', '🎫 Tickets Support', ['tickets-support', 'support-tickets']),
      ticketCategory('ticketsReport', '🚨 Tickets Signalement', ['tickets-signalement', 'reports-tickets']),
      ticketCategory('ticketsApplication', '📝 Tickets Candidature', ['tickets-candidature', 'applications-tickets']),
    ],
  },
  infoMessages: [
    {
      key: 'registration',
      channelNames: REGISTRATION,
      embeds: infoEmbeds(
        'registration',
        {
          title: '🎓 Inscription — rejoindre l’école',
          description: 'L’accès au serveur se fait sur dossier. Tout se passe sur Discord, en quelques minutes.',
          fields: [
            { name: '1. Lisez le règlement', value: '{channel:rules} — règlement général et règlement RP, indispensables avant de postuler.', inline: false },
            { name: '2. Créez votre profil', value: '`/school register` — prénom, nom, classe souhaitée et maison. Vous recevez le rôle 🎒 Élève en attente.', inline: false },
            { name: '3. Déposez votre dossier', value: '`/whitelist apply` — histoire de votre personnage, expérience RP, disponibilités. Suivez l’état avec `/whitelist status`.', inline: false },
            { name: '4. Validation', value: 'L’équipe pédagogique étudie chaque dossier sous **48 h**. Une fois accepté, vous recevez votre rôle (🎒 Élève ou 👩‍🏫 Professeur), votre classe ({channel:classes}) et votre maison ({channel:houses}).', inline: false },
            { name: 'Professeur ou personnel ?', value: 'Les candidatures professeur / staff passent par `/school apply` ou un ticket **📝 Candidature** dans {channel:ticket}.', inline: false },
            { name: 'Question ?', value: 'Ouvrez un ticket **🎓 Inscription** dans {channel:ticket}.', inline: false },
          ],
        },
        {
          title: '🎓 Registration — joining the school',
          description: 'Access to the server is granted on application. Everything happens on Discord in a few minutes.',
          fields: [
            { name: '1. Read the rules', value: '{channel:rules} — general and RP rules, mandatory before applying.', inline: false },
            { name: '2. Create your profile', value: '`/school register` — first name, last name, desired class and house. You receive the 🎒 Pending Student role.', inline: false },
            { name: '3. Submit your file', value: '`/whitelist apply` — your character’s backstory, RP experience, availability. Track it with `/whitelist status`.', inline: false },
            { name: '4. Approval', value: 'The faculty reviews every file within **48 h**. Once accepted you receive your role (🎒 Student or 👩‍🏫 Teacher), your class ({channel:classes}) and your house ({channel:houses}).', inline: false },
            { name: 'Teacher or staff?', value: 'Teacher / staff applications go through `/school apply` or a **📝 Application** ticket in {channel:ticket}.', inline: false },
            { name: 'Question?', value: 'Open a **🎓 Registration** ticket in {channel:ticket}.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'rp-rules',
      channelNames: [...NAMES.rules],
      embeds: infoEmbeds(
        'rp-rules',
        {
          title: '🎭 Règlement RP — Redemption Story School RP',
          description: [
            '**1. Respect du RP** — Une fois en jeu, vous êtes votre personnage. Le hors-RP (HRP) se fait uniquement entre doubles parenthèses `(( … ))` ou sur le Discord, jamais au micro en pleine scène.',
            '**2. Pas de metagaming** — N’utilisez jamais en jeu une information que votre personnage n’a pas apprise en RP (Discord, stream, messages privés).',
            '**3. Pas de powergaming** — Pas d’actions irréalistes ni imposées aux autres sans leur laisser de réponse (« je te frappe et tu tombes KO »). Tout se joue, rien ne se décrète.',
            '**4. Uniforme et tenue** — L’uniforme est obligatoire en cours. Toute tenue hors contexte scolaire (armes, tenues extravagantes) est interdite dans l’enceinte.',
            '**5. Horaires** — Les cours suivent le planning de {channel:schedule}. Un élève absent sans motif RP s’expose à des sanctions RP (retenue, convocation).',
            '**6. Fair-play** — Pas de fail RP, pas de fuite systématique devant les conséquences, pas de « no fear ». Acceptez de perdre une scène.',
            '**7. Scènes sensibles** — Les scènes violentes ou dramatiques exigent l’accord préalable des participants (en HRP) et restent proportionnées au cadre scolaire.',
            '**8. Langue** — Le RP se joue en français, de manière cohérente avec le personnage (vocabulaire, âge, statut).',
            '**9. Respect du staff** — Les décisions des professeurs et de la direction (staff) sont appliquées immédiatement ; elles se contestent ensuite par ticket, jamais en jeu.',
            '**10. Sanctions** — Rappel, retrait de rôle, exclusion temporaire ou définitive selon la gravité. Les signalements se font par ticket **🚨 Signalement** dans {channel:ticket}, avec preuves.',
          ].join('\n\n'),
        },
        {
          title: '🎭 RP rules — Redemption Story School RP',
          description: [
            '**1. Respect the RP** — Once in game, you are your character. Out-of-character talk (OOC) happens only between double brackets `(( … ))` or on Discord, never on the mic mid-scene.',
            '**2. No metagaming** — Never use in game information your character did not learn in RP (Discord, streams, DMs).',
            '**3. No powergaming** — No unrealistic actions and nothing forced on others without letting them respond (“I hit you and you pass out”). Everything is played, nothing is declared.',
            '**4. Uniform and outfit** — The uniform is mandatory in class. Any outfit out of the school context (weapons, extravagant clothes) is forbidden on the premises.',
            '**5. Schedule** — Classes follow the schedule in {channel:schedule}. A student absent without an RP reason faces RP sanctions (detention, summons).',
            '**6. Fair play** — No fail RP, no systematic escape from consequences, no “no fear”. Accept losing a scene.',
            '**7. Sensitive scenes** — Violent or dramatic scenes require prior agreement from the participants (OOC) and stay proportionate to the school setting.',
            '**8. Language** — RP is played in French, consistently with the character (vocabulary, age, status).',
            '**9. Respect the staff** — Decisions from teachers and management (staff) apply immediately; they can be appealed afterwards through a ticket, never in game.',
            '**10. Sanctions** — Warning, role removal, temporary or permanent exclusion depending on severity. Reports go through a **🚨 Report** ticket in {channel:ticket}, with evidence.',
          ].join('\n\n'),
        },
      ),
    },
    {
      key: 'schedule',
      channelNames: SCHEDULE,
      embeds: infoEmbeds(
        'schedule',
        {
          title: '🗓️ Horaires — semaine type',
          description: 'Planning indicatif des sessions RP (heure de Paris). Les changements sont annoncés dans {channel:announcements} ; les professeurs peuvent modifier ce message ou publier un planning à jour avec `/embed`.',
          fields: [
            { name: 'Lundi', value: '19h00 – 20h00 · Cours (salle A)\n20h00 – 21h00 · Vie scolaire libre', inline: true },
            { name: 'Mardi', value: '19h00 – 20h30 · Cours (salle B)\n20h30 – 21h30 · Clubs', inline: true },
            { name: 'Mercredi', value: '18h00 – 20h00 · Activités de maison\n20h00 – 21h00 · Vie scolaire libre', inline: true },
            { name: 'Jeudi', value: '19h00 – 20h00 · Cours (salle A)\n20h00 – 21h00 · Permanence professeurs', inline: true },
            { name: 'Vendredi', value: '19h00 – 21h00 · Événement de la semaine ({channel:events})', inline: true },
            { name: 'Week-end', value: 'Samedi 15h00 – 18h00 · Sorties et clubs\nDimanche · Repos (serveur ouvert, RP libre)', inline: true },
            { name: 'Rappels', value: '• La ponctualité fait partie du RP.\n• Les absences se signalent en RP (mot d’excuse) ou dans {channel:schoolLife}.\n• Les points de maison sont comptés en fin de semaine ({channel:houses}).', inline: false },
          ],
        },
        {
          title: '🗓️ Schedule — typical week',
          description: 'Indicative schedule of RP sessions (Paris time). Changes are announced in {channel:announcements}; teachers can edit this message or post an updated schedule with `/embed`.',
          fields: [
            { name: 'Monday', value: '7:00 – 8:00 pm · Class (room A)\n8:00 – 9:00 pm · Free school life', inline: true },
            { name: 'Tuesday', value: '7:00 – 8:30 pm · Class (room B)\n8:30 – 9:30 pm · Clubs', inline: true },
            { name: 'Wednesday', value: '6:00 – 8:00 pm · House activities\n8:00 – 9:00 pm · Free school life', inline: true },
            { name: 'Thursday', value: '7:00 – 8:00 pm · Class (room A)\n8:00 – 9:00 pm · Teachers’ office hours', inline: true },
            { name: 'Friday', value: '7:00 – 9:00 pm · Event of the week ({channel:events})', inline: true },
            { name: 'Weekend', value: 'Saturday 3:00 – 6:00 pm · Outings and clubs\nSunday · Rest (server open, free RP)', inline: true },
            { name: 'Reminders', value: '• Punctuality is part of the RP.\n• Absences are reported in RP (excuse note) or in {channel:schoolLife}.\n• House points are counted at the end of the week ({channel:houses}).', inline: false },
          ],
        },
      ),
    },
    {
      key: 'classes',
      channelNames: ['classes', 'classe'],
      embeds: infoEmbeds(
        'classes',
        {
          title: '📚 Les classes',
          description: 'Chaque élève est affecté à une classe lors de son inscription. Une classe réunit un professeur principal, un salon dédié et un emploi du temps commun.',
          fields: [
            { name: 'Trouver sa classe', value: '`/school class list` — classes ouvertes et places disponibles · `/school profile` — votre classe et votre maison.', inline: false },
            { name: 'Changer de classe', value: 'Sur demande motivée en RP auprès de la direction, ou via un ticket **🎓 Inscription** dans {channel:ticket}.', inline: false },
            { name: 'Professeurs', value: 'Les professeurs gèrent leur classe avec `/school class create|assign|capacity` et publient leurs cours dans le salon de classe.', inline: false },
          ],
        },
        {
          title: '📚 Classes',
          description: 'Every student is assigned to a class when registering. A class gathers a head teacher, a dedicated channel and a shared schedule.',
          fields: [
            { name: 'Find your class', value: '`/school class list` — open classes and available seats · `/school profile` — your class and house.', inline: false },
            { name: 'Change class', value: 'On a motivated RP request to the management, or through a **🎓 Registration** ticket in {channel:ticket}.', inline: false },
            { name: 'Teachers', value: 'Teachers manage their class with `/school class create|assign|capacity` and post their lessons in the class channel.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'houses',
      channelNames: ['maisons', 'maison', 'houses'],
      embeds: infoEmbeds(
        'houses',
        {
          title: '🏠 Les maisons',
          description: 'Les élèves sont répartis en maisons qui s’affrontent toute l’année : chaque bonne action RP, résultat scolaire ou victoire en club rapporte des points. La maison en tête à la fin du trimestre remporte la coupe.',
          fields: [
            { name: 'Classement', value: '`/school house leaderboard` — classement en direct · `/school house list` — présentation des maisons.', inline: false },
            { name: 'Gagner des points', value: 'Les professeurs attribuent (ou retirent) des points avec `/school house points-add` / `points-remove`. Participation aux cours, événements ({channel:events}), clubs ({channel:clubs}) et comportement exemplaire.', inline: false },
            { name: 'Rejoindre', value: 'La maison est attribuée à l’inscription ({channel:inscriptions}). Les transferts restent exceptionnels et se décident en RP.', inline: false },
          ],
        },
        {
          title: '🏠 Houses',
          description: 'Students are sorted into houses that compete all year long: every good RP deed, school result or club victory earns points. The house leading at the end of the term wins the cup.',
          fields: [
            { name: 'Ranking', value: '`/school house leaderboard` — live ranking · `/school house list` — the houses.', inline: false },
            { name: 'Earn points', value: 'Teachers award (or remove) points with `/school house points-add` / `points-remove`. Class attendance, events ({channel:events}), clubs ({channel:clubs}) and exemplary behaviour.', inline: false },
            { name: 'Join', value: 'The house is assigned at registration ({channel:inscriptions}). Transfers remain exceptional and are decided in RP.', inline: false },
          ],
        },
      ),
    },
    {
      key: 'applications',
      channelNames: APPLICATIONS,
      embeds: infoEmbeds(
        'applications',
        {
          title: '📝 Candidatures — professeurs et staff',
          description: 'Ce salon reçoit les candidatures envoyées avec `/school apply` (professeur, personnel, modération) ainsi que les décisions. Il est réservé à la direction et au staff.',
          fields: [
            { name: 'Côté candidat', value: 'Le candidat lance `/school apply role:<poste>` et répond au formulaire (expérience, disponibilités, motivation), ou ouvre un ticket **📝 Candidature** dans {channel:ticket}. Il doit être inscrit (`/school register`) au préalable.', inline: false },
            { name: 'Côté staff', value: 'Chaque dossier apparaît ici avec des boutons **Accepter / Refuser** ; le candidat est prévenu en message privé. Le salon de réception se change avec `/school config application-channel`.', inline: false },
            { name: 'Critères', value: '• Règlement général et RP maîtrisés\n• Au moins 2 semaines de présence sur le serveur\n• Disponibilité régulière aux horaires de {channel:schedule}\n• Entretien RP avec la direction avant validation', inline: false },
          ],
        },
        {
          title: '📝 Applications — teachers and staff',
          description: 'This channel receives applications sent with `/school apply` (teacher, school staff, moderation) and the decisions. It is reserved to the management and the staff.',
          fields: [
            { name: 'Candidate side', value: 'The candidate runs `/school apply role:<position>` and answers the form (experience, availability, motivation), or opens a **📝 Application** ticket in {channel:ticket}. They must be registered (`/school register`) first.', inline: false },
            { name: 'Staff side', value: 'Every file shows up here with **Accept / Reject** buttons; the candidate is notified by DM. Change the receiving channel with `/school config application-channel`.', inline: false },
            { name: 'Criteria', value: '• General and RP rules mastered\n• At least 2 weeks on the server\n• Regular availability during the hours in {channel:schedule}\n• RP interview with the management before approval', inline: false },
          ],
        },
      ),
    },
    paymentMethodsInfo({
      optional: true,
      shopLabel: { fr: 'la boutique du serveur ({channel:store})', en: 'the server store ({channel:store})' },
      delivery: { fr: 'Les packs (cosmétiques, uniformes exclusifs) sont crédités en jeu dans les minutes qui suivent le paiement ; les dons n’ouvrent aucun avantage RP.', en: 'Packs (cosmetics, exclusive uniforms) are credited in game within minutes of payment; donations grant no RP advantage.' },
    }),
  ],
};
