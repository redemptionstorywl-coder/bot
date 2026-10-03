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
6. [Dashboard web](#dashboard-web)
7. [Commandes](#commandes)
8. [Variables de template](#variables-de-template)
9. [Intégration FiveM](#intégration-fivem)
10. [Architecture & extension](#architecture--extension)
11. [Tests](#tests)
12. [Dépannage](#dépannage)

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
| 🛡️ Modération | ban, tempban, unban, kick, warn (seuils automatiques), timeout, purge, slowmode, lock/unlock, lockdown, historique des sanctions |
| 🚨 Anti-raid | anti-spam, anti-mass-mention, anti-link/invite/pub, anti-compte-récent, anti-bot, anti-mass-join → lockdown automatique |
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
3. `/guild-config staff-role` / `admin-role` → rôles autorisés à modérer / configurer.
4. `/guild-config log-channel` → un salon par catégorie de logs.
5. `/language-roles reset-defaults` (Battle Royale) puis `/language-panel` → panneau de choix de langue.
6. `/welcome-config`, `/autorole`, `/ticket-panel`, `/notifications setup`… ou **tout faire depuis le dashboard**.

`/guild-config show` affiche l'état complet. Chaque module s'active/désactive avec `/guild-config module` ou depuis la page **Paramètres** du dashboard.

---

## Dashboard web

Démarre avec le bot sur `DASHBOARD_URL` (par défaut http://localhost:3000).

- Connexion via **Discord OAuth2** ; accès réservé aux administrateurs des serveurs (ou `OWNER_IDS`).
- Pages : Dashboard, Serveurs, Membres, Tickets, Embeds, Annonces, Bienvenue, Rôles, Reaction Roles, Logs, Modération, Giveaways, Événements, FiveM, Whitelist, Battle Royale, School RP, Shop, Traductions, Paramètres (+ une vue Administration globale pour les `OWNER_IDS`).
- Chaque modification est appliquée **immédiatement** au bot (cache invalidé + Socket.IO).

Voir [`dashboard/README.md`](dashboard/README.md) pour la structure et l'ajout de pages.

---

## Commandes

La liste à jour est disponible avec `/help` (48 commandes). Principales commandes :

| Catégorie | Commandes |
| --- | --- |
| Administration | `/dm user|all|status|cancel` (messages privés via le bot), `/guild-config type|show|language|languages|staff-role|admin-role|log-channel|module|brand-color|translation-mode|language-channel`, `/help`, `/status`, `/fivem add|remove|list|status|maintenance|status-channel|players` |
| Langue & rôles | `/language`, `/language-panel publish|refresh|preview`, `/language-roles set|remove|list|reset-defaults`, `/autorole add|remove|list`, `/rolemenu create|add-role|remove-role|publish|edit|delete|list`, `/reactionrole create|remove|list`, `/notifications setup|panel|add|remove|list` |
| Bienvenue / départ | `/welcome-config enable|channel|message|embed-json|image|dm|dm-message|dm-embed|buttons|language-prompt|test|show`, `/leave-config enable|channel|message|embed-json|image|logs|test|show` |
| Annonces & embeds | `/announce create|edit|delete|duplicate|schedule|preview|publish|archive|list`, `/embed create|edit|variables|template` |
| Tickets | `/ticket-panel create|list|delete`, `/ticket-type create|edit|delete|list|questions`, `/ticket close|add|remove|claim|transcript|rename|info|list` |
| Modération | `/ban`, `/tempban`, `/unban`, `/kick`, `/warn`, `/warnings list|remove|clear`, `/timeout`, `/untimeout`, `/mute`, `/unmute`, `/purge`, `/slowmode`, `/lock`, `/unlock`, `/lockdown on|off|status`, `/case`, `/history`, `/mod-config thresholds|mute-role|dm|show`, `/antiraid status|spam|mentions|links|whitelist|new-account|bots|mass-join|exempt` |
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
