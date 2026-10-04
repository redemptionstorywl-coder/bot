<div align="center">

# Redemption Story Studio — Discord Bot

**Bot Discord central, multi-serveur et multilingue** pour l'infrastructure Redemption Story Studio :
🔒 Prison RP (WL) · ⚔️ Battle Royale · 🎓 School RP · 🛒 Shop

Node.js 22 · TypeScript · discord.js v14 · Prisma · MySQL · Express · Socket.IO

</div>

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Prérequis](#prérequis)
3. [Installation pas à pas](#installation-pas-à-pas)
4. [Lancement](#lancement)
5. [Configuration du premier serveur](#configuration-du-premier-serveur)
6. [Templates de serveur](#templates-de-serveur)
7. [Dashboard web](#dashboard-web)
8. [Commandes](#commandes)
9. [Variables de template](#variables-de-template)
10. [Intégration FiveM](#intégration-fivem)
11. [Architecture & extension](#architecture--extension)
12. [Tests](#tests)
13. [Dépannage](#dépannage)

---

## Fonctionnalités

| Module | Description |
| --- | --- |
| 🌍 Multilingue | 10 langues (FR, EN, ES, DE, IT, AR, RU, PT, TR, PL), rôle par langue, panneau « Choose your language », `/language`, traductions modifiables depuis le dashboard |
| 📢 Annonces | `/announce` : création interactive, traductions par langue, programmation, édition, duplication, archivage ; diffusion par salons par langue ou multi-messages |
| 🎨 Embed Builder | `/embed` : création sans code, aperçu live, templates (Maintenance, Patch Note, Saison, Tournoi, Giveaway…), import/export JSON |
| 👋 Bienvenue / Départ | Message, embed, image générée, DM, boutons, rôle automatique, choix de langue, variables documentées |
| 🎭 Rôles | Auto-roles (arrivée, bot, vérifié, membre, spécial), role menus (boutons / select), reaction roles, rôles de notifications |
| 🎫 Tickets | 11 types configurables, formulaire, numérotation, claim, ajout/retrait, transfert, transcripts HTML/TXT/PDF |
| 🛡️ Modération | ban, tempban, unban, kick, warn (seuils automatiques), timeout, purge, slowmode, lock/unlock, mute-salon (sourdine programmée), lockdown, historique des sanctions |
| 🚨 Anti-raid | anti-spam, anti-mass-mention, anti-link/invite/pub, anti-compte-récent, anti-bot, anti-mass-join → lockdown automatique, anti-nuke (audit log : bans/kicks/salons/rôles/webhooks en masse, bots ajoutés → strip des rôles dangereux / kick / ban) |
| 📜 Logs | 14 catégories, un salon par catégorie, historique consultable dans le dashboard |
| 📅 Événements | inscriptions, participants max, rappels automatiques (24h, 1h, 30, 10, 5 min) |
| 🎁 Giveaways | rôle requis, nombre minimal de messages, tirage automatique, reroll |
| 📊 Sondages | oui/non, choix multiples, anonyme, durée, résultats automatiques |
| 🎮 FiveM | API REST + Socket.IO, statut serveur en direct, whitelist, sanctions, stats ; adaptateurs ESX / QBCore / custom |
| ⚔️ Battle Royale | profils, XP/niveaux, wins, kills, K/D, classements, Battle Pass |
| 🎓 School RP | inscriptions, élèves, professeurs, classes, maisons, clubs, candidatures |
| 🛒 Shop | catégories, produits, annonces produits, commandes, historique, webhook Tebex |
| 🌐 Dashboard | OAuth2 Discord, configuration complète de chaque serveur sans toucher au code, temps réel (Socket.IO) |

Tout est **par serveur** : un seul bot, une configuration indépendante par serveur Discord.

---

## Prérequis

- **Node.js 22 LTS** — https://nodejs.org (vérifiez avec `node -v`)
- **MySQL 8** (ou MariaDB 10.6+) — local, VPS ou hébergé
- Une **application Discord** — https://discord.com/developers/applications
- Windows, Linux ou macOS (le projet est compatible VPS et localhost)

---

## Installation pas à pas

### 1. Installer Node.js

Téléchargez l'installateur LTS sur https://nodejs.org puis vérifiez :

```bash
node -v   # v22.x
npm -v
```

### 2. Créer le bot Discord

1. Ouvrez https://discord.com/developers/applications → **New Application** → nommez-la « Redemption Story Studio ».
2. Onglet **Bot** → **Add Bot**.
3. Activez les **Privileged Gateway Intents** : `Presence Intent`, `Server Members Intent`, `Message Content Intent`.
4. Onglet **OAuth2** → notez le **Client ID** et générez un **Client Secret** (requis pour le dashboard).
5. Dans **OAuth2 → Redirects**, ajoutez `http://localhost:3000/auth/callback` (adaptez à votre domaine en production).

### 3. Récupérer le token

Onglet **Bot** → **Reset Token** → copiez le token. **Ne le partagez jamais** et ne le commitez jamais.

### 4. Créer la base MySQL

```sql
CREATE DATABASE redemption_story CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'rsbot'@'%' IDENTIFIED BY 'un-mot-de-passe-fort';
GRANT ALL PRIVILEGES ON redemption_story.* TO 'rsbot'@'%';
FLUSH PRIVILEGES;
```

### 5. Configurer `.env`

```bash
git clone <votre-depot> redemption-story-bot
cd redemption-story-bot
npm install
cp .env.example .env      # Windows : copy .env.example .env
```

Éditez `.env` :

```env
DISCORD_TOKEN=votre_token
CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=votre_client_secret
OWNER_IDS=votre_id_discord
DATABASE_URL="mysql://rsbot:un-mot-de-passe-fort@localhost:3306/redemption_story"
DASHBOARD_URL=http://localhost:3000
DASHBOARD_PORT=3000
SESSION_SECRET=une-longue-chaine-aleatoire
FIVEM_API_KEY=une-autre-chaine-aleatoire
TEBEX_WEBHOOK_SECRET=        # optionnel, webhook Tebex
```

Toutes les variables sont décrites dans [`.env.example`](.env.example).

### 6. Lancer Prisma

```bash
npx prisma generate          # génère le client
npx prisma migrate deploy    # applique les migrations (production)
# ou en développement :
npx prisma migrate dev --name init
```

### 7. Vérifier l'installation

```bash
npm run setup
```

Le script vérifie Node, le `.env`, la connexion MySQL, les migrations et le token Discord, et affiche clairement chaque erreur.

### 8. Inviter le bot

```
https://discord.com/oauth2/authorize?client_id=VOTRE_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

(Le lien exact est affiché par `npm run setup`.) Placez le rôle du bot **au-dessus** des rôles qu'il doit gérer (rôles langue, notifications, mute…).

---

## Lancement

```bash
npm run dev      # développement (rechargement automatique)
npm run build    # compilation TypeScript → dist/
npm start        # production
npm test         # tests
npm run deploy   # (re)déployer uniquement les slash commands
```

Les commandes slash sont déployées automatiquement au démarrage : instantanément sur `DEV_GUILD_ID` si défini, sinon globalement (jusqu'à 1 h de propagation).

En production, utilisez un gestionnaire de processus :

```bash
npm i -g pm2
pm2 start dist/src/index.js --name redemption-story-bot
pm2 save
```

---

### Déploiement sur Render / Railway / Heroku

Le dépôt contient un `render.yaml`. Sur Render : **New → Blueprint**, choisissez le dépôt, puis renseignez les variables (`DISCORD_TOKEN`, `CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `OWNER_IDS`, `DATABASE_URL` vers une base MySQL externe, `DASHBOARD_URL` = l'URL publique Render). Si vous créez le service à la main, utilisez :

- Build command : `npm ci && npm run build && npx prisma migrate deploy`
- Start command : `npm start`

Le dashboard écoute automatiquement sur le port `PORT` fourni par l'hébergeur. Ajoutez `https://VOTRE-APP.onrender.com/auth/callback` dans les redirections OAuth2 du Developer Portal.

---

## Configuration du premier serveur

1. `/guild-config type` → choisissez **Prison**, **Battle Royale**, **School** ou **Shop**. Les modules adaptés sont activés.
2. `/guild-config language` et `/guild-config languages` → langue par défaut et langues activées.
3. `/guild-config staff-role` / `admin-role` → rôles autorisés à modérer / configurer. Un rôle nommé **🛡️ RS Team** est reconnu automatiquement comme équipe (accès à toutes les commandes staff et admin, sans permissions Discord particulières).
4. `/guild-config log-channel` → un salon par catégorie de logs.
5. `/language-setup` → crée les rôles de langue manquants, un salon 🌍・langues en lecture seule et y publie le panneau de choix.
6. `/welcome-config`, `/autorole`, `/ticket-config`, `/notifications setup`… ou **tout faire depuis le dashboard**.

`/guild-config show` affiche l'état complet. Chaque module s'active/désactive avec `/guild-config module` ou depuis la page **Paramètres** du dashboard.

> Raccourci : `/template apply` crée la structure manquante et fait les étapes 1 à 6 en une fois à partir de vos salons et rôles (voir ci-dessous).

---

## Templates de serveur

`/template apply template:<shop|battle-royale|prison|school> [dry_run] [create_missing]` déploie **un serveur complet prêt à l'emploi en une commande** : la structure du modèle (catégories, salons, permissions) est créée si elle manque, les salons et rôles **déjà présents** sont réutilisés tels quels (rien n'est renommé ni déplacé), le bot est configuré et les messages par défaut sont publiés.

- **Structure déclarative** (`structure` dans `src/templates/<nom>.ts`) : chaque catégorie déclare son accès (`public`, `staff`, `tickets`, `languages`) et chaque salon son type (`text`, `announcement`, `voice`, `forum`), son preset de permissions et un topic FR/EN. Presets : `readonly` (@everyone lit, le bot et le staff écrivent), `chat` (tout le monde), `staff` (rôles staff / admin résolus + 🛡️ RS Team uniquement), `voice`, `support-voice` (vocal public limité à 3 participants). Les catégories `tickets` sont visibles du staff seulement (les tickets ajoutent leurs créateurs individuellement).
- **Création des salons manquants** : l'étape `structure` s'exécute en premier (`create_missing`, **activée par défaut**). Pour chaque catégorie / salon, un existant est reconnu par nom ou synonyme (`paiements` ≈ `💳・payment-methods`, un forum `suggestions` vaut un salon texte) et laissé intact — ses permissions ne sont pas touchées ; sinon il est créé dans la bonne catégorie avec les overwrites du preset. Les salons créés sont ensuite résolus par les étapes suivantes (bienvenue, règlement, infos, tickets, logs, panneaux…). `create_missing:false` revient au comportement « existant uniquement ». Sans permission **Gérer les salons**, l'étape est ❌ et les autres continuent avec l'existant. Les salons `announcement` et `forum` sont créés en texte si le serveur n'est pas communautaire.
- **Détection par nom** : les noms sont normalisés (minuscules, sans emoji, sans `・ - _`, sans accents) et chaque cible accepte plusieurs synonymes — `👋・welcome`, `bienvenue` ou `arrivées` désignent le même salon de bienvenue ; `🛡️ RS Team`, `Support`, `Manager`… les rôles d'équipe.
- **Plan avant action** : `dry_run:true` affiche chaque étape ✅ prête / ⚠️ ignorée (avec la raison) ; l'étape structure liste par catégorie 🆕 *sera créé* / ♻️ *existant*. Sans `dry_run`, le résumé indique le nombre de salons qui seront créés puis un bouton **Appliquer** confirme ; le rapport final liste chaque étape ✅ / ⚠️ / ❌ avec le détail (créés / réutilisés).
- **Idempotent** : relancer la commande ne recrée rien (noms reconnus), met à jour la configuration mais ne republie pas les messages déjà postés par le bot (règlement, infos, panneaux : marqueur `template:<étape>` cherché dans les 20 derniers messages du salon).
- **Tout passe par les services existants** (`/guild-config`, `/welcome-config`, `/ticket-config`, `/language-setup`, `/notifications`… restent utilisables ensuite pour ajuster).

| Étape | Ce qui est fait |
| --- | --- |
| Type & langues | `kind` du serveur, langue par défaut, langues activées |
| Structure | catégories et salons manquants créés avec permissions et topic FR/EN ; existants réutilisés |
| Rôles | rôles admin / staff ajoutés à la config ; auto-rôle JOIN (Member / Player…) et BOT |
| Logs | une catégorie de logs par salon staff (`orders` → SHOP, `bug-management` → SYSTEM, `player-reports` → MODERATION, `logs` → membres / messages / rôles / salons / vocal, `staff-chat` → le reste…) |
| Modération | DM des sanctions activé, rôle mute si un rôle `Muted` existe ; templates d'embeds par défaut |
| Bienvenue / départ | message + embed FR/EN (`{user}`, `{memberCount}`, liens vers règlement et tickets), image générée |
| Règlement | 9–10 règles numérotées (FR puis EN) publiées dans `rules` (+ règlement RP détaillé pour Prison et School) |
| Tickets | types par modèle avec leur catégorie (Shop : Support / Commande / Paiement / Bug / Partenariat ; BR : General Support / Bug Report / Player Report / Ban Appeal / Payment Support ; School : Inscription / Support / Signalement / Candidature ; Prison : Whitelist / Support / Signalement / Unban), rôles staff, questions ; panneau publié dans `create-ticket` |
| Langues | rôles de langue, panneau (salon `langues` ou à défaut `welcome`) ; BR : les salons `🇫🇷・french`… (créés si absents) deviennent les salons par langue (mode CHANNELS) |
| Notifications | rôles de notification (annonces, giveaways, mises à jour, shop / events, tournois, streams…) + panneau |
| FiveM | salon de statut (`stats` / `server-status`) si un serveur est configuré avec `/fivem add` |
| Infos | messages FR/EN par défaut (voir ci-dessous) |

**Structure et messages par défaut de chaque modèle**

| Modèle | Catégories | Messages par défaut |
| --- | --- | --- |
| 🛒 Shop | 📢 INFORMATION (welcome, rules, announcements, payment-methods, giveaways, polls, feedback) · 👀 SHOWCASE (previews, wip, updates, spoilers) · 🛒 RS SHOP (how-to-buy, forums paid-scripts / free-scripts) · 💬 COMMUNITY (general-chat, suggestions, support-chat, bug-reports, create-ticket) · 👑 STAFF (staff-chat, bug-management, staff-tasks, orders, vocal) · 🎫 Tickets | moyens de paiement (PayPal / carte via Tebex / crypto sur demande, délais, remboursements, ticket Paiement), comment acheter, feedback, wip, updates |
| ⚔️ Battle Royale | 📢 INFORMATION (welcome, rules, announcements, how-to-play, leaderboards, events) · 🛒 STORE (store, payment-methods, giveaways) · 💬 COMMUNITY (general-chat, boosts, clips-and-screenshots, stats, streamers, polls, 10 salons langue) · 🏆 COMPETITION (tournament-info, tournament-results, vocal Tournament) · 🛠️ SUPPORT (create-ticket, bug-reports, suggestions, vocaux Support 1–3, Private Support) · 👑 STAFF (staff-chat, staff-announcements, staff-tasks, player-reports, tournament-management, event-management, bug-management, staff-templates, vocal) · 5 catégories de tickets | how-to-play (guide complet : FiveM, `/br-link`, lobby, loot, zone, XP / niveaux, Battle Pass, commandes), leaderboards (`/leaderboard metric:wins\|kills\|level\|kd`), store (Battle Pass premium, cosmétiques, lien Tebex à remplacer), moyens de paiement, tournament-info (format, inscription via `/event`), streamers, stats (statut FiveM) |
| 🎓 School RP | 📢 INFORMATION (bienvenue, règlement, annonces, horaires, inscriptions) · 🏫 ÉCOLE (classes, maisons, clubs, vie-scolaire, salle-des-professeurs = staff) · 💬 COMMUNAUTÉ (général, suggestions, screenshots, sondages, giveaways) · 🛠️ SUPPORT (create-ticket, bug-reports) · 👑 STAFF (staff-chat, staff-tasks, candidatures, logs) · tickets Inscription / Support / Signalement / Candidature | inscriptions (`/school register`, `/whitelist apply`, rôles élève / professeur, maisons), règlement RP (10 règles), horaires (semaine type), classes, maisons (`/school house leaderboard`), candidatures (`/school apply`), moyens de paiement seulement si un salon `store` existe |
| 🔒 Prison RP | 📢 INFORMATION (welcome, rules, announcements, whitelist-info, patch-notes, server-status) · 🔒 ROLEPLAY (lore, règles-rp, screenshots, général) · 🛠️ SUPPORT (create-ticket, bug-reports, suggestions) · 👑 STAFF (staff-chat, staff-tasks, whitelist-review, reports, logs) · tickets Whitelist / Support / Signalement / Unban | whitelist-info (`/whitelist apply`, critères, délai 48 h), règlement RP prison (10 règles : micro, RDM, VDM, metagaming…), lore (présentation du pénitencier, modifiable), statut FiveM, moyens de paiement seulement si un salon `store` existe |

Les salons `giveaways`, `polls` et `events` ne sont pas persistés : ils sont rappelés en fin de rapport comme salons à indiquer dans `/giveaway create`, `/poll create` et `/event create`.

Pour ajouter un modèle : créer `src/templates/<nom>.ts` (type `ServerTemplate`, avec sa `structure` et ses `infoMessages`), l'enregistrer dans `src/templates/index.ts` et ajouter `admin.template.templates.<clé>` dans les locales.

---

## Dashboard web

Démarre avec le bot sur `DASHBOARD_URL` (par défaut http://localhost:3000).

- Connexion via **Discord OAuth2** ; accès réservé aux administrateurs des serveurs (ou `OWNER_IDS`).
- Pages : Dashboard, Serveurs, Membres, Tickets, Embeds, Annonces, Bienvenue, Rôles, Reaction Roles, Logs, Modération, Giveaways, Événements, FiveM, Whitelist, Battle Royale, School RP, Shop, Traductions, Paramètres (+ une vue Administration globale pour les `OWNER_IDS`).
- Chaque modification est appliquée **immédiatement** au bot (cache invalidé + Socket.IO).

Voir [`dashboard/README.md`](dashboard/README.md) pour la structure et l'ajout de pages.

---

## Commandes

La liste à jour est disponible avec `/help` (49 commandes). Principales commandes :

| Catégorie | Commandes |
| --- | --- |
| Administration | `/template list|apply` (pré-configuration complète par modèle), `/info` (fiche du serveur : catégories, salons, rôles avec IDs), `/dm user|all|status|cancel` (messages privés via le bot), `/guild-config type|show|language|languages|staff-role|admin-role|log-channel|module|brand-color|translation-mode|language-channel`, `/help`, `/status`, `/fivem add|remove|list|status|maintenance|status-channel|players` |
| Langue & rôles | `/language`, `/language-setup` (crée rôles + salon + panneau), `/autorole add|remove|list`, `/rolemenu create|add-role|remove-role|publish|edit|delete|list`, `/reactionrole create|remove|list`, `/notifications setup|panel|add|remove|list` |
| Bienvenue / départ | `/welcome-config` — panneau interactif éphémère (onglets Bienvenue / Départ : activation, salon, message, embed, image, DM, bouton langue, boutons liens, logs des départs, test) |
| Annonces & embeds | `/announce create|edit|delete|duplicate|schedule|preview|publish|archive|list`, `/embed create|edit|variables|template` |
| Tickets | `/ticket-config` (panneau interactif : raisons, catégories, accès, questions, panneau), `/ticket close|add|remove|claim|transcript|rename|info|list` |
| Modération | `/ban`, `/tempban`, `/unban`, `/kick`, `/warn`, `/warnings list|remove|clear`, `/timeout`, `/untimeout`, `/mute`, `/unmute`, `/clear` (N messages), `/clear-salon` (tout le salon), `/slowmode`, `/lock`, `/unlock`, `/mute-salon [duration] [channel] [reason]` (sourdine programmée, déverrouillage automatique), `/lockdown on|off|status`, `/case`, `/history`, `/mod-config thresholds|mute-role|dm|show`, `/antiraid status|spam|mentions|links|whitelist|new-account|bots|mass-join|exempt`, `/antiraid nuke status|enable|disable|threshold|punishment|whitelist|lockdown|bot-add|options` |
| Communauté | `/event create|edit|cancel|list|participants|remind`, `/giveaway create|end|reroll|cancel|list`, `/poll create|end|results|list` |
| Whitelist (Prison / School) | `/whitelist apply|status|review|list|config` |
| Battle Royale | `/profile`, `/leaderboard`, `/battlepass`, `/br-link`, `/br-admin season|stats|xp` |
| School RP | `/school register|profile|apply|announce|class|house|club|config` |
| Shop | `/shop catalog|announce|product|category|order` |

Les commandes Battle Royale, School RP et Shop ne sont proposées que sur les serveurs du type correspondant (`/guild-config type`).

---

## Variables de template

Utilisables dans les messages de bienvenue/départ, embeds, annonces, tickets :

| Variable | Valeur |
| --- | --- |
| `{user}` | Mention de l'utilisateur |
| `{username}` | Nom d'utilisateur |
| `{displayName}` | Pseudo sur le serveur |
| `{tag}` | Nom complet |
| `{server}` | Nom du serveur |
| `{memberCount}` | Nombre de membres |
| `{userId}` | ID de l'utilisateur |
| `{createdAt}` | Date de création du compte |
| `{joinedAt}` | Date d'arrivée |
| `{language}` | Langue de l'utilisateur |
| `{avatar}` | URL de l'avatar |
| `{date}` / `{time}` | Date / heure actuelles |

Exemple : `Bienvenue {user} sur {server} ! Nous sommes maintenant {memberCount} membres.`

---

## Traduction automatique

Le staff écrit une annonce dans une seule langue ; le bot génère les autres versions automatiquement à la publication (ou avant, avec le bouton « 🤖 Traduire automatiquement » du créateur d'annonces, pour relecture). Une traduction saisie à la main n'est jamais écrasée.

Comme Discord ne peut pas afficher un même message différemment selon le lecteur, `/language-setup` crée un **salon d'annonces par langue** (catégorie 📢 Annonces), visible uniquement par le rôle de cette langue : un membre 🇫🇷 ne voit que `📢・annonces-fr`, un membre 🇺🇸 que `📢・announcements-en`, chacun dans sa langue.

Fournisseurs (dans l'ordre, bascule automatique) :

| Variable | Fournisseur | Remarque |
| --- | --- | --- |
| `DEEPL_API_KEY` | DeepL (recommandé) | 500 000 caractères/mois gratuits avec une clé `:fx` |
| *(aucune)* | Google Translate (point d'accès gratuit non officiel) | Peut être limité ou indisponible ponctuellement |
| `MYMEMORY_EMAIL` | MyMemory | Secours, 50 000 caractères/jour avec un e-mail |

Les traductions sont mises en cache en base (`MachineTranslation`). Les variables `{user}`, mentions, liens, emojis et blocs de code sont protégés et jamais traduits. Désactivable par serveur dans Paramètres (« Traduction automatique des annonces »).

---

## Intégration FiveM

Le bot expose une API REST (`/api/fivem/...`) et un namespace Socket.IO (`/fivem`) protégés par `FIVEM_API_KEY`. Les serveurs FiveM envoient : statut, joueurs, version, maintenance, statistiques Battle Royale, sanctions ; et interrogent la whitelist.

Les frameworks **ESX**, **QBCore** et **custom** sont pris en charge via des adaptateurs (`src/services/fivem/adapters`). Documentation complète, exemples `curl` et script Lua : [`docs/FIVEM.md`](docs/FIVEM.md).

---

## Architecture & extension

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). En résumé :

- **Ajouter un serveur Discord** : invitez le bot, `/guild-config type`. Rien à coder.
- **Ajouter une langue** : ajoutez-la dans `src/config/constants.ts` (`LANGUAGES`) et créez `src/locales/<code>/*.json`.
- **Ajouter une commande** : un fichier dans `src/commands/<categorie>/` avec `defineCommand`. Elle est chargée et déployée automatiquement.
- **Ajouter un type de ticket / un rôle / un embed** : depuis Discord ou le dashboard.
- **Ajouter un module** : `src/modules/<nom>/index.ts` (`defineModule`) + clé dans `MODULE_KEYS`.
- **Ajouter un framework FiveM** : un adaptateur dans `src/services/fivem/adapters/`.

---

## Tests

```bash
npm test
```

Les 535 tests (Vitest) couvrent les systèmes critiques : tickets, permissions, traductions, rôles, sanctions, annonces, programmation, base de données (mockée). Aucune base MySQL n'est nécessaire pour les lancer.

---

## Dépannage

| Problème | Solution |
| --- | --- |
| `Configuration .env invalide` | Le message liste la variable fautive. Vérifiez `.env`. |
| `P1001: Can't reach database server` | MySQL arrêté ou `DATABASE_URL` incorrecte. |
| `Used disallowed intents` | Activez les 3 Privileged Intents dans le Developer Portal. |
| Les commandes n'apparaissent pas | Attendez jusqu'à 1 h (global) ou définissez `DEV_GUILD_ID`, puis `npm run deploy`. |
| `Missing Permissions` sur les rôles | Montez le rôle du bot au-dessus des rôles à gérer. |
| Le dashboard refuse la connexion | `DISCORD_CLIENT_SECRET` vide ou redirect URI non ajoutée dans OAuth2. |
| Image de bienvenue absente | `sharp` n'a pas pu s'installer : `npm rebuild sharp`. Le message est envoyé sans image. |

Les logs sont écrits dans `logs/bot.log` et `logs/error.log` (le token n'y apparaît jamais).

---

© Redemption Story Studio — usage interne.
