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
7. [Serveur de logs central](#serveur-de-logs-central)
8. [Commandes](#commandes)
9. [Variables](#variables)
10. [Traduction automatique en anglais](#traduction-automatique-en-anglais)
11. [Intégration FiveM](#intégration-fivem)
12. [Architecture & extension](#architecture--extension)
13. [Tests](#tests)
14. [Dépannage](#dépannage)

---

## Fonctionnalités

| Module | Description |
| --- | --- |
| 🌍 Langue du bot | Le bot répond en français ou en anglais selon la langue du serveur (`/config module:general`) |
| 🇬🇧 Traduction automatique | Écrivez en français : annonces, embeds (« comment jouer »…), bienvenue et panneaux de tickets reçoivent automatiquement une version anglaise (DeepL / Google / MyMemory, cache, variables protégées) |
| 📢 Annonces | `/announce` : création interactive (embed, texte, mentions, boutons, salon), publication immédiate ou programmée, édition, duplication, archivage, aperçu |
| 🎨 Embed Builder | `/embed` : création sans code, aperçu live, vos propres templates réutilisables, import/export JSON |
| 👋 Bienvenue / Départ | Message, embed, image générée, DM, boutons, rôle automatique, variables documentées |
| 🎭 Rôles | Auto-roles (arrivée, bot, vérifié, spécial), role menus (boutons / select), reaction roles, rôles de notifications |
| 🎫 Tickets | 11 types configurables, titre demandé à l'ouverture (= nom du salon), formulaire, numérotation, ajout/retrait, transfert ; fermeture sans suppression (catégorie « Tickets fermés ») avec 📄 Transcript (HTML/TXT/PDF + DM au membre, sur demande) · 🔓 Rouvrir · 🗑️ Supprimer |
| 🛡️ Modération | ban, tempban, unban, kick, warn (seuils automatiques), timeout, `/clear` (messages ou salon entier), `/unban-all` (débannissement de masse), slowmode, lock/unlock, mute-salon (sourdine programmée), lockdown, historique des sanctions |
| 🚨 Anti-raid | anti-spam, anti-mass-mention, anti-link/invite/pub, anti-compte-récent, anti-bot, anti-mass-join → lockdown automatique, anti-nuke (audit log : bans/kicks/salons/rôles/webhooks en masse, bots ajoutés → strip des rôles dangereux / kick / ban) |
| 📜 Logs | 15 catégories (dont 🎮 Jeu), un salon par catégorie, historique consultable dans le dashboard ; modifications `/config` et dashboard, paramètres du serveur, webhooks, emojis, applications ajoutées |
| 🗂️ Serveur de logs central | `/template logs` : un serveur Discord dédié reçoit **tous les logs** de vos serveurs (un salon par type de log, une section par serveur) et les **logs en jeu** FiveM (connexions, kills, parties, sanctions, admin, anticheat) |
| 📅 Événements | inscriptions, participants max, rappels automatiques (24h, 1h, 30, 10, 5 min) |
| 🎁 Giveaways | rôle requis, nombre minimal de messages, tirage automatique, reroll |
| 📊 Sondages | oui/non, choix multiples, anonyme, durée, résultats automatiques |
| 🔊 Salons vocaux | « Créer un salon » : rejoindre un lobby crée un salon vocal au nom du membre, avec le drapeau et le nom dans sa langue (selon ses rôles), supprimé quand il se vide |
| 🎮 FiveM | API REST + Socket.IO, statut serveur en direct, whitelist, bans synchronisés (choix « en jeu » à chaque ban), pseudo du compte → surnom Discord, rôles Discord → groupes en jeu (ACE), stats ; adaptateurs ESX / QBCore / custom |
| ⚔️ Battle Royale | profils, XP/niveaux, wins, kills, K/D, `/stat`, classement en direct (message mis à jour tout seul), Battle Pass |
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
DEEPL_API_KEY=               # optionnel, traduction automatique en anglais (voir plus bas)
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
- Pages : Dashboard, Serveurs, Membres, Tickets, Embeds, Annonces, Bienvenue, Rôles, Reaction Roles, Salons vocaux, Logs, Hub de logs, Modération, Giveaways, Événements, FiveM, Whitelist, Battle Royale, School RP, Shop, Paramètres (+ une vue Administration globale pour les `OWNER_IDS`).
- Chaque modification est appliquée **immédiatement** au bot (cache invalidé + Socket.IO).

Voir [`dashboard/README.md`](dashboard/README.md) pour la structure et l'ajout de pages.

---

## Serveur de logs central

Un serveur Discord **dédié aux logs** : il reçoit une copie de **tous les logs** de vos serveurs (RS Battle Royale, RS Studio…) et les **logs en jeu** du serveur FiveM, rangés par serveur et par type. Chaque log garde ses couleurs et ses champs ; l'en-tête indique le serveur d'origine (nom + icône), le pied de page l'action (`mod.ban`, `message.delete`…).

### Mise en place (5 minutes)

1. **Créez un serveur Discord vide** (bouton ➕ de Discord → *Créer le mien*), par exemple « RS Logs ».
2. **Invitez le bot** sur ce serveur avec le lien habituel (`permissions=8`, Administrateur) — ou au minimum **Gérer les salons** + **Gérer les rôles** + Voir les salons / Envoyer des messages / Intégrer des liens.
3. Sur ce nouveau serveur, tapez **`/template logs`**.
4. Dans le menu, **choisissez les serveurs** à relier (RS Battle Royale et RS Studio sont pré-cochés). Seuls les serveurs où **vous êtes administrateur ou propriétaire** apparaissent : le bot le vérifie sur chaque serveur.
5. Sous le menu, un bouton par **serveur FiveM** déclaré sur ces serveurs : cliquez pour activer ses logs en jeu (⬜ non → 🎮 oui → 💬 oui + chat en jeu).
6. Cliquez sur **🏗️ Créer la structure**. Le bot crée les catégories et salons (privés : @everyone ne les voit pas), affiche la progression, puis épingle un **📌 sommaire** qui explique tout. **C'est fini** : les logs arrivent.

Relancer `/template logs` affiche l'état (serveurs, jeux, salons manquants) et propose **Réparer / compléter** (recrée les salons supprimés, ajoute un nouveau serveur — rien n'est dupliqué) et **Retirer une source** (les salons sont conservés). Tout se gère aussi dans le dashboard : **Sécurité → Hub de logs** (salon de chaque type de log, copie locale oui/non, nom de section, ajout / retrait de serveurs et de jeux, bouton *Créer les salons manquants*).

### Structure créée

| Catégorie | Salons |
| --- | --- |
| `🌐 GÉNÉRAL` | `📌・sommaire` · `🔨・sanctions-globales` (toutes les sanctions de tous les serveurs + jeu) · `🚨・alertes-sécurité` (anti-raid, anti-nuke, lockdown, salon piège, bots / applications ajoutés, anticheat) · `🤖・bot-système` (démarrage, erreurs, déploiements, serveurs rejoints / quittés, changements de configuration) |
| `🎯 RS BATTLE ROYALE · MODÉRATION` (une section par serveur, emoji selon le serveur) | `🔨・sanctions` · `🧹・clear-salons` · `🚨・sécurité` · `🔄・sync-fivem` |
| `… · MESSAGES & MEMBRES` | `🗑️・messages-supprimés` · `✏️・messages-modifiés` · `🧨・suppressions-en-masse` · `📥・arrivées` · `📤・départs` · `🏷️・pseudos` · `🎭・rôles-membres` · `✉️・invitations` · `🔊・vocal` |
| `… · SERVEUR & ACTIVITÉ` | `📁・salons` · `🎖️・rôles` · `⚙️・paramètres` · `🎫・tickets` · `📝・whitelist` · `📢・annonces` · `📅・événements` · `🛒・boutique` · `⚔️・battle-royale` · `🎓・school-rp` · `🤖・config-bot` |
| `🎮 JEU · <serveur de jeu>` | `🟢・connexions` · `🏷️・comptes-pseudos` · `💀・kills` · `🏆・parties` · `🔨・sanctions-jeu` · `🛡️・actions-admin` · `💬・chat-jeu` (si activé) · `🚨・anticheat` · `⚙️・serveur-jeu` |

Les salons de modules inutiles pour un serveur ne sont pas créés (un salon « module » n'existe que si le module est actif sur ce serveur ou prévu pour son type : pas de `whitelist` ni de `boutique` pour RS Battle Royale, pas de `sync-fivem` sans serveur FiveM). Leurs logs éventuels vont dans le salon de la catégorie, sinon `config-bot`.

### Règles

- **Sécurité** : un serveur ne peut être relié que par son **propriétaire**, un membre **Administrateur** de CE serveur (relu sur Discord au moment du lien) ou un propriétaire du bot (`OWNER_IDS`) — inviter le bot sur un serveur ne permet donc pas de récupérer les logs d'un serveur qu'on ne gère pas. Il faut aussi être administrateur du serveur de logs. Chaque lien est journalisé dans les logs du serveur relié.
- Un serveur est relié à **un seul** serveur de logs (10 serveurs Discord et 10 serveurs de jeu maximum par serveur de logs). Un serveur de logs ne peut pas être lui-même relié à un autre.
- **Délier** : depuis le serveur de logs (`/template logs` → *Retirer une source*, dashboard) ou depuis le serveur relié (`/config module:logs` → *Délier du serveur de logs*, dashboard → Hub de logs).
- **Copie locale** : par défaut, chaque serveur continue de publier dans ses propres salons de logs ; décochez « Aussi en local » (dashboard) ou cliquez *Ne plus publier ici* (`/config module:logs`) pour n'utiliser que le serveur de logs. L'historique du dashboard reste complet dans tous les cas.
- **Débit** : les logs sont regroupés (jusqu'à 10 par message, envoi toutes les 2 secondes, nouvel essai automatique si Discord limite le débit) : un serveur très actif ne sature pas Discord.

### Ajouter les logs en jeu (FiveM)

1. Mettez à jour la ressource **`rs_bridge`** (version 1.2 : nouveau fichier `server/logs.lua`) — même installation que d'habitude ([`docs/INSTALL-BATTLEROYALE.md`](docs/INSTALL-BATTLEROYALE.md), section « Logs en jeu »). Rien à ajouter dans `server.cfg` : les logs utilisent les mêmes `rs_bridge_url` / `rs_bridge_guild` / `rs_bridge_server_key` / `rs_bridge_api_key`.
2. Dans `/template logs` (ou le dashboard → Hub de logs), activez le serveur de jeu (🎮), puis **Créer / Réparer**.
3. Connexions, déconnexions, connexions refusées, groupes en jeu, sanctions, annonces / redémarrages txAdmin, ressources démarrées / arrêtées et kills (`baseevents`) arrivent tout seuls. Le chat en jeu : `Config.Logs.Chat = true` dans `config.lua` + « 💬 oui + chat ». Pour les parties, comptes et l'anticheat du gamemode : `exports.rs_bridge:Log('match_end', { … })` (exemples dans le guide).

---

## Commandes

Toute la configuration passe par **une seule commande** : `/config module:<module>` ouvre le panneau complet du module (boutons, menus, formulaires, aperçus). Les autres commandes sont des actions.

| `/config module:` | Contenu du panneau |
| --- | --- |
| `general` | Type de serveur, langue du bot, rôles admin/staff, modules actifs, couleur, footer, traduction automatique en anglais (on/off + mise en page) |
| `permissions` | Qui peut utiliser chaque commande : rôles autorisés par commande ou par catégorie, commande désactivée, retour au défaut |
| `logs` | Salon de chaque catégorie de logs, salon de logs privé en un clic |
| `bienvenue` | Bienvenue et départ : salon, message, embed, image, DM, boutons, test |
| `tickets` | Raisons de ticket, catégorie d'ouverture, rôles d'accès, questions, message d'accueil, panneau, salon des transcripts, catégorie « Tickets fermés », relances automatiques |
| `moderation` | Seuils de warns, rôle mute, anti-raid, anti-nuke, lockdown, salon piège `get-banned` |
| `roles` | Auto-roles, role menus, reaction roles, rôles de notifications |
| `fivem` | Serveurs FiveM, statut, synchronisation bans/pseudos/rôles, rôles Discord → groupes en jeu (🛡️ Groupes), salon compteur, installation |
| `battleroyale` | Saisons, Battle Pass, outils de stats et d'XP, 📺 Affichage (classement en direct, salon `/stat`) |
| `whitelist` | Questions, salon de review, rôles, DM des décisions |
| `school` | Salons, rôles, classes, maisons, clubs |
| `shop` | Produits, catégories, Tebex, annonces produits |
| `vocal` | Salons vocaux temporaires : lobbies « Créer un salon », catégorie, limite de membres, règles de langue (rôle → drapeau + nom), droits du créateur |

`/template logs` (admin) transforme le serveur courant en **serveur de logs central** (voir [Serveur de logs central](#serveur-de-logs-central)).

| Catégorie | Commandes d'action |
| --- | --- |
| Administration | `/info` (fiche du serveur avec IDs), `/dm user|all|status|cancel`, `/help`, `/status`, `/template logs` (serveur de logs central) |
| Annonces & embeds | `/announce create|edit|delete|duplicate|schedule|preview|publish|archive|list`, `/embed create|edit|variables|template` |
| Tickets | `/ticket close|add|remove|transcript|rename|info|list` (+ boutons dans chaque ticket, dont 📌 « Ticket permanent ») |
| Modération | `/ban`, `/tempban`, `/unban` (option `en_jeu` : appliquer aussi sur les serveurs FiveM), `/kick`, `/warn`, `/warnings list|remove|clear`, `/timeout`, `/untimeout`, `/mute`, `/unmute`, `/clear messages|salon`, `/unban-all`, `/slowmode`, `/lock`, `/unlock`, `/mute-salon`, `/lockdown on|off|status`, `/case`, `/history` |
| Communauté | `/event`, `/giveaway`, `/poll` |
| Whitelist | `/whitelist apply|status|review|list` |
| Battle Royale | `/stat [joueur]` (ouverte à tous : vos stats ou celles d'un joueur, pseudo en jeu proposé automatiquement), `/leaderboard`, `/battlepass`, `/br-link` |
| School RP | `/school register|profile|apply|announce|house|club` |
| Shop | `/shop catalog|order` |

Les commandes Battle Royale, School RP et Shop ne sont proposées que sur les serveurs du type correspondant (`/config module:general`).

### Permissions des commandes (`/config module:permissions`)

- **🔒 Par défaut** : chaque commande exige son niveau (`staff` = rôles staff ou Modérer/Gérer le serveur, `admin` = rôles admin, 🛡️ RS Team ou Administrateur) et les permissions Discord prévues.
- **👥 Rôles autorisés** : ces rôles peuvent utiliser la commande même sans être staff (niveau et permissions Discord ignorés, celles du bot restent vérifiées) ; les autres membres sont refusés, sauf les administrateurs Discord. Les boutons / formulaires ouverts par la commande suivent la même règle.
- **⛔ Désactivée** : personne ne peut l'utiliser, sauf le propriétaire du serveur.
- `/config` et `/help` sont verrouillées (jamais restreignables) ; le propriétaire du serveur et `OWNER_IDS` passent toujours.

### Salons vocaux temporaires (`/config module:vocal`)

- Un membre rejoint un salon **lobby** (par défaut le salon « Créer un salon » `1553447736790093944` s'il existe) : le bot crée un salon vocal à son nom et l'y déplace. S'il a déjà un salon actif, il y est simplement renvoyé (une création par membre toutes les 10 s au maximum).
- **Nom selon la langue** : les règles `rôle → drapeau + modèle` sont évaluées dans l'ordre (ex. rôle Français → `🇫🇷 Salon de {name}`, rôle English → `🇬🇧 {name}'s lobby`) ; sans rôle de langue, la règle de repli (anglais par défaut) s'applique. 11 langues proposées (fr, en, es, de, it, pt, ar, tr, pl, ru, nl), bouton « Détecter les rôles ». `{name}` = pseudo nettoyé, nom limité à 100 caractères.
- Le salon reprend les permissions, le débit et la limite du lobby (limite et catégorie réglables) ; le créateur peut le gérer (renommer, limite, déplacer des membres). S'il part, ses droits passent au membre présent depuis le plus longtemps.
- **Suppression** 5 s après le départ du dernier membre (une reconnexion rapide l'annule). Les salons actifs sont enregistrés en base : au redémarrage, ceux restés vides sont supprimés et ceux disparus oubliés. Permissions requises pour le bot : Gérer les salons, Déplacer des membres ; une erreur est notée dans les logs **Vocal**.

### Tickets : ouverture et fermeture (`/config module:tickets`)

- **Ouverture** : le bouton du panneau (ou le choix d'une raison) affiche toujours un formulaire : **Titre du ticket** (obligatoire, 50 caractères), puis les questions de la raison (4 au maximum), puis **Message** (facultatif) s'il reste une place (5 champs max par fenêtre Discord). Le salon prend le nom du titre (minuscules, espaces → `-`, accents et emojis conservés, caractères interdits retirés) ; si le titre est inutilisable, le format de nom de la raison sert de repli, et `-<numéro>` n'est ajouté que si un salon porte déjà ce nom. Le titre apparaît dans l'embed d'accueil ; le message facultatif est posté dans le ticket au nom du membre.
- **Fermeture** (bouton 🔒 ou `/ticket close`) : le salon n'est **plus supprimé**. Le membre qui l'a ouvert et les membres ajoutés perdent l'accès (le staff le garde), les relances s'arrêtent et le salon est déplacé dans la catégorie « Tickets fermés » : catégorie propre à la raison si définie, sinon le réglage du serveur (⚙️ Options du panneau tickets ou dashboard → Tickets → Réglages), sinon la catégorie `1557072815700574240` si elle existe sur le serveur (RS Battle Royale), sinon le salon reste en place. Une catégorie pleine (50 salons) laisse le salon en place (noté dans les logs).
- Le bot poste ensuite un message réservé au staff : **📄 Transcript** (génère le transcript, l'enregistre — base + salon des transcripts — et l'envoie en DM au membre ; le bouton passe à « Transcript envoyé », DM fermés signalés au staff), **🔓 Rouvrir** (accès rendu, catégorie d'origine, relances relancées) et **🗑️ Supprimer** (confirmation puis suppression après 5 s, sans transcript). Sans clic sur 📄, aucun transcript n'est généré et rien n'est envoyé au membre.
- Le bouton « Claim » (prise en charge) n'existe plus ; les relances mentionnent les rôles d'accès de la raison (ou personne).

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

## Traduction automatique en anglais

Vous écrivez vos messages en français, le bot ajoute **automatiquement la version anglaise** :

| Où | Ce qui est traduit |
| --- | --- |
| Annonces (`/announce`, dashboard, programmées) | Texte et embed — retraduits à chaque modification (les messages publiés sont mis à jour) |
| Embeds (`/embed create` et `/embed edit`, dashboard « Embeds » → Envoyer) | Titre, description, champs, pied de page, auteur — idéal pour les messages « comment jouer » |
| Bienvenue | Message, embed et message privé : le **modèle** est traduit une seule fois, avant le remplacement des variables |
| Panneaux de tickets | Embed du panneau + raisons du menu : libellé « FR / EN » s'il tient (100 caractères), sinon libellé français et description anglaise |

**Activer** : `/config module:general` → bouton **🇬🇧 Traduction EN** (et **Mise en page**), ou Dashboard → **Paramètres → Traduction automatique**. Désactivée par défaut.
Chaque message garde ensuite son propre interrupteur **« Version anglaise »** (formulaire d'annonce, envoi d'embed, bienvenue, panneau de tickets, bouton 🇬🇧 des builders `/announce` et `/embed`), pré-réglé sur le choix du serveur.

**Mise en page** :
- **Embed anglais séparé** (par défaut) : dans le même message, l'embed français (pied de page 🇫🇷) puis l'embed anglais (🇬🇧) ; la grande image n'est pas dupliquée.
- **Texte à la suite** : la traduction est ajoutée sous une ligne `🇬🇧 ─────────` (dans le texte, ou dans l'embed lui-même ; embed séparé si la place manque).
Un message texte sans embed reçoit toujours la traduction après cette ligne. Les limites Discord (2000 caractères de texte, 4096 de description, 6000 par message…) sont toujours respectées : la partie anglaise est raccourcie si nécessaire.

**Ce qui n'est jamais traduit** : variables `{user}` `{server}`…, mentions `<@…>` `<#…>` `<@&…>`, emojis personnalisés `<:nom:id>`, horodatages `<t:…>`, liens, blocs de code et code, mise en forme Markdown (gras, titres, citations, listes…), URLs, couleurs et images. Un texte déjà en anglais n'est pas retraduit.

**Fournisseur** (choisi automatiquement, par ordre de priorité) :
1. **DeepL** si `DEEPL_API_KEY` est renseignée — meilleure qualité. Une clé **gratuite** donne **500 000 caractères par mois** :
   1. créez un compte sur https://www.deepl.com/pro-api et choisissez l'offre **DeepL API Free** (une carte bancaire est demandée pour vérifier l'identité, rien n'est débité) ;
   2. dans **Compte → Clés d'API**, copiez la clé (elle se termine par `:fx`) ;
   3. ajoutez `DEEPL_API_KEY=votre-clé:fx` dans `.env`, puis redémarrez le bot. Le point d'accès gratuit (`api-free.deepl.com`) est choisi automatiquement grâce au suffixe `:fx` ; une clé Pro utilise `api.deepl.com`.
2. **Google Cloud Translation** si `GOOGLE_TRANSLATE_API_KEY` est renseignée (clé d'API Google Cloud, API « Cloud Translation » activée).
3. Sinon **MyMemory**, gratuit et sans clé (≈ 5 000 caractères / jour ; ≈ 50 000 avec `MYMEMORY_EMAIL=votre@adresse`). Il sert aussi de secours si DeepL / Google échouent.

Le fournisseur actif est affiché dans `/config module:general` et dans les Paramètres du dashboard.

**Coût et fiabilité** : chaque traduction est mise en cache (mémoire + table `TranslationCache`, clé SHA-256 du texte) : renvoyer un message, republier un panneau ou accueillir 1 000 membres ne consomme le quota qu'une fois. Si la traduction échoue ou dépasse 15 secondes, le message part **en français seul** (avertissement dans les logs) : un envoi n'est jamais bloqué. Dans le dashboard, l'aperçu « Avec la version anglaise » montre le message exact qui sera envoyé.

---

## Intégration FiveM

Le bot expose une API REST (`/api/fivem/...`) et un namespace Socket.IO (`/fivem`) protégés par `FIVEM_API_KEY`. Les serveurs FiveM envoient : statut, joueurs, version, maintenance, statistiques Battle Royale, sanctions, **logs en jeu** (`POST /logs`, vers le [serveur de logs central](#serveur-de-logs-central)) ; et interrogent la whitelist.

Les frameworks **ESX**, **QBCore** et **custom** sont pris en charge via des adaptateurs (`src/services/fivem/adapters`). Documentation complète, exemples `curl` et script Lua : [`docs/FIVEM.md`](docs/FIVEM.md).

**Serveur RS Battle Royale : guide d'installation pas à pas (Windows, en français) → [`docs/INSTALL-BATTLEROYALE.md`](docs/INSTALL-BATTLEROYALE.md)** — copie de `rs_bridge`, lignes `server.cfg`, déclaration du serveur, test, et extraits Lua pour le développeur du gamemode (création de compte, kills, fin de partie, ban, groupes).

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

Les tests (Vitest) couvrent les systèmes critiques : serveur de logs central (table action → route complète, routage local / hub / section générale / replis / copie locale, sécurité des liens, plan `/template logs` idempotent et limites Discord, file d'envoi groupée 10 embeds / 6000 caractères / 429, logs en jeu : schéma, rendu, API), tickets (fermeture sans suppression, catégorie « Tickets fermés », transcript à la demande, réouverture, titre → nom du salon, formulaire d'ouverture), permissions, traductions de l'interface, traduction automatique (protection des variables, composition bilingue et limites Discord, fournisseurs, cache, repli en cas d'échec — sans aucun accès réseau), rôles, sanctions, `/clear salon`, `/unban-all`, permissions des commandes par rôle, salons vocaux temporaires, annonces, programmation, FiveM (rôles → groupes en jeu, option « en jeu » des bans, statut), Battle Royale (classement en direct, `/stat`), base de données (mockée). Aucune base MySQL n'est nécessaire pour les lancer.

```bash
npm run check            # vérifications statiques (aussi exécutées par npm test)
npm run check -- --verbose
```

`scripts/checks/` : customIds ⇄ handlers (chaque bouton / menu / modal généré a un handler qui traite son action, aucun handler orphelin, admin requis sur la configuration), clés de traduction fr/en (littérales, dynamiques, codes d'erreur, parité), références mortes (commandes supprimées, anciennes variables), ressource Lua `rs_bridge` ⇄ API FiveM (routes, en-têtes, corps — dont le lot de `POST /logs` —, champs de réponse), migrations ⇄ `schema.prisma` (table par table, colonne par colonne ; `SHADOW_DATABASE_URL=mysql://…` ajoute la comparaison sur une vraie base), actions de logs ⇄ routes du serveur de logs central (chaque `action` journalisée a sa route dans `src/services/logs/routes.ts`).

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
| Rien n'arrive dans le serveur de logs | Le serveur est-il relié (`/template logs` sur le serveur de logs) ? Le salon existe-t-il encore (*Réparer / compléter*) ? Le bot peut-il écrire dans la catégorie ? Logs en jeu : `rs_bridge` 1.2 et serveur de jeu activé (🎮). |
| `/template logs` ne propose pas un serveur | Vous devez être administrateur ou propriétaire de ce serveur, et il ne doit pas être déjà relié à un autre serveur de logs. |
| Pas de version anglaise | Activez-la (`/config module:general` ou Paramètres) et vérifiez l'interrupteur « Version anglaise » du message. Les logs indiquent l'erreur du fournisseur (`DeepL: quota exceeded`, `invalid key`…) ; le message part alors en français seul. |

Les logs sont écrits dans `logs/bot.log` et `logs/error.log` (le token n'y apparaît jamais).

---

© Redemption Story Studio — usage interne.
