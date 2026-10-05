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
8. [Variables](#variables)
9. [Intégration FiveM](#intégration-fivem)
10. [Architecture & extension](#architecture--extension)
11. [Tests](#tests)
12. [Dépannage](#dépannage)

---

## Fonctionnalités

| Module | Description |
| --- | --- |
| 🌍 Langue du bot | Le bot répond en français ou en anglais selon la langue du serveur (`/config module:general`) |
| 📢 Annonces | `/announce` : création interactive (embed, texte, mentions, boutons, salon), publication immédiate ou programmée, édition, duplication, archivage, aperçu |
| 🎨 Embed Builder | `/embed` : création sans code, aperçu live, vos propres templates réutilisables, import/export JSON |
| 👋 Bienvenue / Départ | Message, embed, image générée, DM, boutons, rôle automatique, variables documentées |
| 🎭 Rôles | Auto-roles (arrivée, bot, vérifié, spécial), role menus (boutons / select), reaction roles, rôles de notifications |
| 🎫 Tickets | 11 types configurables, formulaire, numérotation, claim, ajout/retrait, transfert, transcripts HTML/TXT/PDF |
| 🛡️ Modération | ban, tempban, unban, kick, warn (seuils automatiques), timeout, `/clear` (messages ou salon entier), `/unban-all` (débannissement de masse), slowmode, lock/unlock, mute-salon (sourdine programmée), lockdown, historique des sanctions |
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

(Le lien exact est affiché par `npm run setup`.) Placez le rôle du bot **au-dessus** des rôles qu'il doit gérer (notifications, mute…).

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

1. `/config module:general` → type de serveur (**Prison**, **Battle Royale**, **School** ou **Shop**), langue du bot, rôles admin et staff, modules actifs, couleur. Un rôle nommé **🛡️ RS Team** est reconnu automatiquement comme équipe sur tous les serveurs.
2. `/config module:logs` → un salon par catégorie de logs, ou tout dans un salon privé créé en un clic.
3. `/config module:permissions` (facultatif) → par défaut chaque commande exige son niveau (staff, admin…) ; vous pouvez autoriser des rôles précis sur une commande ou une catégorie entière, ou désactiver une commande.
4. `/config module:bienvenue`, `/config module:tickets`, `/config module:moderation`, `/config module:roles`… : chaque module s'ouvre dans un panneau complet.

Tout est aussi modifiable depuis le dashboard.

---

## Dashboard web

Démarre avec le bot sur `DASHBOARD_URL` (par défaut http://localhost:3000).

- Connexion via **Discord OAuth2** ; accès réservé aux administrateurs des serveurs (ou `OWNER_IDS`).
- Pages : Dashboard, Serveurs, Membres, Tickets, Embeds, Annonces, Bienvenue, Rôles, Reaction Roles, Logs, Modération, Giveaways, Événements, FiveM, Whitelist, Battle Royale, School RP, Shop, Paramètres (+ une vue Administration globale pour les `OWNER_IDS`).
- Chaque modification est appliquée **immédiatement** au bot (cache invalidé + Socket.IO).

Voir [`dashboard/README.md`](dashboard/README.md) pour la structure et l'ajout de pages.

---

## Commandes

Toute la configuration passe par **une seule commande** : `/config module:<module>` ouvre le panneau complet du module (boutons, menus, formulaires, aperçus). Les autres commandes sont des actions.

| `/config module:` | Contenu du panneau |
| --- | --- |
| `general` | Type de serveur, langue du bot, rôles admin/staff, modules actifs, couleur, footer |
| `permissions` | Qui peut utiliser chaque commande : rôles autorisés par commande ou par catégorie, commande désactivée, retour au défaut |
| `logs` | Salon de chaque catégorie de logs, salon de logs privé en un clic |
| `bienvenue` | Bienvenue et départ : salon, message, embed, image, DM, boutons, test |
| `tickets` | Raisons de ticket, catégorie d'ouverture, rôles d'accès, questions, message d'accueil, panneau, salon des transcripts, relances automatiques |
| `moderation` | Seuils de warns, rôle mute, anti-raid, anti-nuke, lockdown, salon piège `get-banned` |
| `roles` | Auto-roles, role menus, reaction roles, rôles de notifications |
| `fivem` | Serveurs FiveM, statut, synchronisation bans/pseudos/rôles, salon compteur, installation |
| `battleroyale` | Saisons, Battle Pass, outils de stats et d'XP |
| `whitelist` | Questions, salon de review, rôles, DM des décisions |
| `school` | Salons, rôles, classes, maisons, clubs |
| `shop` | Produits, catégories, Tebex, annonces produits |

| Catégorie | Commandes d'action |
| --- | --- |
| Administration | `/info` (fiche du serveur avec IDs), `/dm user|all|status|cancel`, `/help`, `/status` |
| Annonces & embeds | `/announce create|edit|delete|duplicate|schedule|preview|publish|archive|list`, `/embed create|edit|variables|template` |
| Tickets | `/ticket close|add|remove|claim|transcript|rename|info|list` (+ boutons dans chaque ticket, dont 📌 « Ticket permanent ») |
| Modération | `/ban`, `/tempban`, `/unban`, `/kick`, `/warn`, `/warnings list|remove|clear`, `/timeout`, `/untimeout`, `/mute`, `/unmute`, `/clear messages|salon`, `/unban-all`, `/slowmode`, `/lock`, `/unlock`, `/mute-salon`, `/lockdown on|off|status`, `/case`, `/history` |
| Communauté | `/event`, `/giveaway`, `/poll` |
| Whitelist | `/whitelist apply|status|review|list` |
| Battle Royale | `/profile`, `/leaderboard`, `/battlepass`, `/br-link` |
| School RP | `/school register|profile|apply|announce|house|club` |
| Shop | `/shop catalog|order` |

Les commandes Battle Royale, School RP et Shop ne sont proposées que sur les serveurs du type correspondant (`/config module:general`).

### Permissions des commandes (`/config module:permissions`)

- **🔒 Par défaut** : chaque commande exige son niveau (`staff` = rôles staff ou Modérer/Gérer le serveur, `admin` = rôles admin, 🛡️ RS Team ou Administrateur) et les permissions Discord prévues.
- **👥 Rôles autorisés** : ces rôles peuvent utiliser la commande même sans être staff (niveau et permissions Discord ignorés, celles du bot restent vérifiées) ; les autres membres sont refusés, sauf les administrateurs Discord. Les boutons / formulaires ouverts par la commande suivent la même règle.
- **⛔ Désactivée** : personne ne peut l'utiliser, sauf le propriétaire du serveur.
- `/config` et `/help` sont verrouillées (jamais restreignables) ; le propriétaire du serveur et `OWNER_IDS` passent toujours.

### `/unban-all [raison] [inclure_jeu]`

Débannit tous les membres bannis (niveau `admin` par défaut, modifiable dans `/config module:permissions`). Le bot affiche le nombre de bannis, puis il faut taper `UNBAN ALL` dans un formulaire. Le débannissement tourne en arrière-plan (~2 par seconde) avec une barre de progression, un bouton **Annuler** et un rapport final ; une seule case de modération récapitulative est créée et l'opération est journalisée dans les logs Sécurité et Modération. `inclure_jeu:false` ne relaie pas les débannissements vers les serveurs FiveM.

---

## Variables

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
| `{language}` | Langue du serveur |
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

- **Ajouter un serveur Discord** : invitez le bot, `/config module:general`. Rien à coder.
- **Ajouter une commande** : un fichier dans `src/commands/<categorie>/` avec `defineCommand`. Elle est chargée et déployée automatiquement.
- **Ajouter un type de ticket / un rôle / un embed** : depuis Discord ou le dashboard.
- **Ajouter un module** : `src/modules/<nom>/index.ts` (`defineModule`) + clé dans `MODULE_KEYS`.
- **Ajouter un framework FiveM** : un adaptateur dans `src/services/fivem/adapters/`.

---

## Tests

```bash
npm test
```

Les tests (Vitest) couvrent les systèmes critiques : tickets, permissions, traductions de l'interface, rôles, sanctions, `/clear salon`, `/unban-all`, permissions des commandes par rôle, annonces, programmation, base de données (mockée). Aucune base MySQL n'est nécessaire pour les lancer.

```bash
npm run check            # vérifications statiques (aussi exécutées par npm test)
npm run check -- --verbose
```

`scripts/checks/` : customIds ⇄ handlers (chaque bouton / menu / modal généré a un handler qui traite son action, aucun handler orphelin, admin requis sur la configuration), clés de traduction fr/en (littérales, dynamiques, codes d'erreur, parité), références mortes (commandes supprimées, anciennes variables), ressource Lua `rs_bridge` ⇄ API FiveM (routes, en-têtes, corps, champs de réponse), migrations ⇄ `schema.prisma` (table par table, colonne par colonne ; `SHADOW_DATABASE_URL=mysql://…` ajoute la comparaison sur une vraie base).

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
