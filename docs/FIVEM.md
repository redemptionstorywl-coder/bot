# Intégration FiveM — Redemption Story Bot

Ce document décrit comment relier un serveur FiveM (Battle Royale, ESX, QBCore ou standalone) au bot :
**bans synchronisés dans les deux sens (avec choix à chaque action), pseudo du compte en jeu → surnom Discord, liaison automatique des comptes, rôles « compte lié » / « en jeu », rôles Discord → groupes en jeu (ACE), salon compteur de joueurs, contrôle à la connexion (ban, Discord requis, rôle requis, whitelist), temps de jeu, statistiques Battle Royale (classement en direct, `/stat`), statut en temps réel, maintenance, webhook Tebex.**

> Installation pas à pas pour le serveur **RS Battle Royale** (Windows, sans connaissances techniques) : [`INSTALL-BATTLEROYALE.md`](INSTALL-BATTLEROYALE.md).

Une ressource prête à l'emploi est fournie : **`fivem-resource/rs_bridge/`** (Lua, aucune dépendance obligatoire).

---

## 1. Installation (5 minutes)

### 1.1 Côté Discord

`/config module:fivem` → **➕ Ajouter** :
- **Clé du serveur** : identifiant court unique (`[a-z0-9_-]{2,64}`), utilisé dans les URLs et dans `config.lua` (`Config.ServerKey`).
- **Framework** : `CUSTOM` pour la ressource `rs_bridge` (payload normalisé). `ESX` / `QBCORE` acceptent en plus les formats natifs de ces frameworks (§ 7).
- **Hôte** (facultatif) : `http://IP:30120` pour que le bot lise aussi `/info.json` et `/players.json` toutes les 60 s.
- **Clé API propre** (facultatif) : clé propre au serveur ; sinon la clé globale `FIVEM_API_KEY` du `.env` du bot.

La vue du serveur affiche l'encart **📦 Installation** (URL de l'API, GuildId, clé du serveur) et regroupe tous les réglages :
maintenance, salon du message de statut (auto-mis à jour), salon compteur, options de synchronisation (menu « options actives »),
format du pseudo, rôles « compte lié » / « en jeu » / « requis » (bouton 🎭 Rôles), liste des joueurs en ligne, test de connexion, suppression.

### 1.2 Côté serveur FiveM

1. Copier le dossier `fivem-resource/rs_bridge` dans `resources/` (ou `resources/[redemption]/`).
2. Réglages de connexion dans `server.cfg` (les convars passent avant `config.lua`) :
   ```cfg
   set rs_bridge_url "https://bot.mondomaine.fr"      # DASHBOARD_URL du bot, sans / final
   set rs_bridge_guild "123456789012345678"           # ID du serveur Discord
   set rs_bridge_server_key "br"                      # clé déclarée dans /config module:fivem
   set rs_bridge_api_key "votre-clé-FIVEM_API_KEY"    # ou la clé propre au serveur
   add_ace resource.rs_bridge command.add_principal allow     # groupes en jeu (§ 2.3)
   add_ace resource.rs_bridge command.remove_principal allow
   ensure rs_bridge          # après es_extended / qb-core si utilisés
   ```
3. Éditer `rs_bridge/config.lua` si besoin : `Config.Framework` = `standalone` | `esx` | `qbcore` ; `Config.Locale` = `fr` | `en` ;
   `Config.GroupsMode` = `highest` | `all` ; à défaut de convars, `Config.BotUrl` / `Config.GuildId` / `Config.ServerKey` / `Config.ApiKey`.
4. Redémarrer. La console affiche `[rs_bridge] Connecté au bot (…)` ou la cause exacte (401 clé refusée, 404 GuildId/ServerKey inconnus, bot injoignable).
5. Brancher votre menu admin sur les exports (§ 3) — ou laisser `Config.TxAdminHooks = true` si vous sanctionnez via txAdmin.
6. Gamemode Battle Royale : `exports.rs_bridge:SetPlayerName(source, pseudo)` à la création du compte (et à chaque changement de pseudo), `exports.rs_bridge:AddStats(source, { kills = 1 })` pendant la partie et / ou `exports.rs_bridge:AddMatchStats(source, {...})` à la fin (§ 3).

> Les joueurs n'ont **rien à faire** : si Discord est ouvert sur leur PC au lancement de FiveM, FiveM fournit l'identifiant `discord:<id>` et le bot lie automatiquement leur compte (profil Battle Royale, rôle, surnom). `/br-link` (joueur) et le bouton **🔗 Lier un membre** de `/config module:fivem` (admin) restent disponibles pour les cas manuels.

### 1.3 Permissions Discord du bot

| Permission | Pour |
|------------|------|
| **Gérer les pseudos** (Manage Nicknames) | Pseudo en jeu → surnom |
| **Gérer les rôles** | Rôles « compte lié » / « en jeu » |
| **Bannir / Expulser des membres**, **Exclure temporairement** | Bans / kicks venant du jeu |
| **Gérer les salons** | Renommer le salon compteur |

L'URL d'invitation du bot (`README.md`, `npm run setup`, dashboard) demande `permissions=8` (Administrateur), qui inclut tout ce qui précède.
Intents requis (déjà activés dans `src/core/Client.ts`) : `Guilds`, `GuildMembers` (**intent privilégié** « Server Members » à cocher dans le portail développeur), `GuildModeration` (événements de ban).

---

## 2. Synchronisation jeu ⇄ Discord

### 2.1 Options par serveur (`/config module:fivem`, `FiveMSyncService.updateSyncSettings`)

| Réglage (panneau) | Champ `FiveMServer` | Défaut | Effet |
|---|---|---|---|
| Bans jeu → Discord | `syncBansToDiscord` | ✅ | Ban / tempban / unban pris en jeu → appliqué sur Discord |
| Bans Discord → jeu | `syncBansToGame` | ✅ | Ban / unban Discord (commande, clic droit, fin de tempban) → serveurs de jeu |
| Kicks jeu → Discord | `syncKicks` | ❌ | Kick en jeu → kick Discord |
| Pseudos | `syncNicknames` | ✅ | Pseudo en jeu → surnom Discord |
| Format du pseudo | `nicknameFormat` | `{name}` | Variables `{name}` `{id}` (ID serveur) `{level}` (niveau BR). 32 caractères max après rendu |
| Rôle « compte lié » | `linkedRoleId` | — | Rôle donné quand le compte FiveM est lié |
| Rôle « en jeu » | `onlineRoleId` | — | Rôle « En jeu » donné à la connexion, retiré à la déconnexion / serveur hors ligne / démarrage du bot si le serveur est hors ligne |
| Salon compteur | `playerCountChannelId` | — | Salon vocal (ou catégorie) renommé `🟢 En ligne : 23/64` / `🔴 Hors ligne` / `🟠 Maintenance` |
| Discord requis | `requireDiscord` | ❌ | Refuse la connexion si aucun Discord lié ou si le joueur n'est pas membre du serveur Discord |
| Rôle requis | `requireRoleId` | — | Rôle Discord requis pour se connecter (implique Discord lié + membre) |
| Whitelist requise | `requireWhitelist` | ❌ | Candidature whitelist acceptée requise (`/whitelist`) |
| Groupes en jeu (🛡️ Groupes) | `roleGroups` | `[]` | `[{ roleId, group }]`, ordre = priorité : rôles Discord → groupes ACE en jeu (§ 2.3) |
| (sélecteur vidé) | — | — | Retire le rôle / salon correspondant |

Le panneau `/config module:fivem` (et le dashboard) appellent `fivemSyncService.updateSyncSettings(guildId, key, patch)` (patch validé par Zod `syncSettingsSchema`, `src/services/fivem/sync.ts`).

### 2.2 Flux

```
BAN JEU → DISCORD
  menu admin / txAdmin ──exports.rs_bridge:BanPlayer──▶ ban local KVP + DropPlayer
                         └─POST /sanctions {type:BAN, identifiers, duration?, staff}
  bot : discordId ← payload.discordId | identifiant discord: | FiveMPlayer/profil BR/whitelist par licence
        syncBansToDiscord ? moderationService.ban(reason "[FiveM] raison (staff)", duration)  → case #, DM, log
                          : Sanction enregistrée seule
        anti-écho : marqueur mémoire fromGame:ban:<guild>:<user> (30 s) → l'écouteur Discord→jeu ignore ce ban
        relais : BAN poussé aux AUTRES serveurs FiveM du guild (syncBansToGame)
  KICK → kick Discord si syncKicks · WARN → avertissement Discord si le membre est présent · UNBAN → unban Discord

BAN DISCORD → JEU
  /ban, clic droit Bannir, escalade d'avertissements, fin de tempban (unban)
  GuildBanAdd / GuildBanRemove (src/events/guild*.fivem.ts)
  └─ pour chaque serveur du guild avec syncBansToGame :
       socket `player:ban|player:unban` si un pont Socket.IO est connecté
       + FiveMPendingAction (file persistée) ─── GET /actions (rs_bridge, toutes les 10 s)
            BAN   → ban local KVP (discord:<id> + licences connues) + DropPlayer des joueurs connectés
            UNBAN → suppression des bans locaux
  /unban-all : chaque unban est marqué (fivemSyncService.markBulk) → inclure_jeu:true = relayé sans log par membre,
               inclure_jeu:false = non relayé (marqueur bulk:skip:unban:<guild>:<user>, 30 s) : les bans en jeu restent
  À la connexion, POST /check refuse de toute façon un membre banni de Discord (ban vérifié via l'API, cache 60 s).

CONNEXION
  playerConnecting → ban local KVP ? refus
                   → POST /check {identifiers} → { allowed, reason, message, banned, whitelisted, linked, discordId }
                     ordre : ban Discord → Discord requis (non lié / pas membre) → rôle requis → whitelist
                     bot injoignable : Config.FailOpen (true = laisser entrer)
  playerJoining    → POST /players/join → FiveMPlayer (licence, steam, fivem, nom, session)
                     identifiant discord: + membre présent → profil BR lié automatiquement (identifier = licence)
                     rôles linkedRole + onlineRole, surnom formaté
  playerDropped    → POST /players/leave → durée de session ajoutée à FiveMPlayer.playtimeMinutes
                     et BattleRoyaleProfile.playtimeMinutes, rôle « en jeu » retiré
  POST /status (30 s) → diff de la liste : arrivées / départs manqués rattrapés, compteur mis à jour
  Serveur sans nouvelles 3 min → hors ligne : toutes les sessions fermées, rôle « en jeu » retiré à tous

PSEUDO
  SetPlayerName(source, nom) / nom FiveM / nom du personnage ESX-QBCore (Config.NameSource)
  └─ POST /players/name (ou join / status) → nettoyage (codes ^1, ~r~, contrôles, invisibles ; liens,
     @everyone et noms vides ignorés) → format → 32 caractères → member.setNickname si différent
     Jamais le propriétaire du serveur ni un membre dont le rôle le plus haut ≥ celui du bot.
     Le pseudo reçu par /players/name est retenu (FiveMPlayer.gameName) : il est réappliqué à chaque connexion
     à la place du nom FiveM (pas d'aller-retour du surnom) et sert de pseudo au classement et à /stat.

RÔLES DISCORD → GROUPES EN JEU (§ 2.3)
  GuildMemberUpdate (rôle associé gagné / perdu, membre déjà venu en jeu)
  └─ FiveMPendingAction SET_GROUPS { discordId, license, identifiers, groups, group, managedGroups } ── GET /actions
  Connexion : réponses de POST /check et POST /players/join (champs groups, group, managedGroups)
  rs_bridge : add_principal / remove_principal identifier.discord:<id> + identifier.license:<…> group.<nom>,
              TriggerEvent('rs_bridge:groupsChanged', source, groupes, principal), exports GetGroups / GetGroup / HasGroup

BAN AVEC CHOIX (« en jeu » / « aussi sur Discord »)
  /ban, /tempban, /unban en_jeu:<oui|non> · dashboard (fiche membre, case « Aussi en jeu »)
    non précisé → réglage syncBansToGame de chaque serveur ; oui → tous les serveurs actifs ; non → aucun
    (marqueur bulk:force|skip:<ban|unban>:<guild>:<user>, 30 s, lu par GuildBanAdd / GuildBanRemove)
    /unban en_jeu d'un membre non banni de Discord → UNBAN envoyé aux serveurs de jeu seulement
  exports.rs_bridge:Ban(source, raison, duréeSec, alsoDiscord, staff) / Unban(identifiant, raison, alsoDiscord, staff)
    → POST /sanctions { …, syncDiscord } : true / false explicite, absent = réglage syncBansToDiscord
```

### 2.3 Rôles Discord → groupes en jeu

`/config module:fivem` → serveur → **🛡️ Groupes** (ou dashboard → FiveM → serveur → Synchronisation → *Groupes en jeu*) :
associez un rôle Discord à un groupe (`admin`, `mod`, `vip`… : minuscules, chiffres, `_ - .`, 32 caractères max).
**L'ordre est la priorité** : le premier groupe détenu par le membre est son groupe principal.

- Côté jeu, `Config.GroupsMode = 'highest'` (défaut) ne donne que le groupe principal (idéal si `group.admin` hérite de `group.mod` dans `server.cfg`) ; `'all'` donne tous les groupes détenus.
- Les groupes gérés par le bot que le joueur n'a plus sont retirés (`remove_principal`) : ne les donnez pas aussi à la main dans `server.cfg`.
- `server.cfg` doit autoriser la ressource : `add_ace resource.rs_bridge command.add_principal allow` et `add_ace resource.rs_bridge command.remove_principal allow`.
- Gamemode : `AddEventHandler('rs_bridge:groupsChanged', function(src, groups, primary) … end)`, `exports.rs_bridge:GetGroups(src)`, `GetGroup(src)`, `HasGroup(src, 'mod')`. Console : `rsbridge groups <id>`.
- Délai : immédiat à la connexion ; ≈ `Config.ActionsInterval` (10 s) après un changement de rôle sur Discord. Un membre qui n'est jamais venu en jeu reçoit ses groupes à sa première connexion.

### 2.4 Données

| Modèle | Rôle |
|--------|------|
| `FiveMServer` (+ champs de sync) | Réglages par serveur |
| `FiveMPlayer` | Un joueur suivi par licence : `discordId`, `steam`, `fivemId`, dernier `name`, `serverKey`, `lastSeenAt`, `sessionStartedAt`, `playtimeMinutes`, `online` |
| `FiveMPendingAction` | File des actions Discord → jeu (`BAN`/`UNBAN`/`KICK`/`MESSAGE`), marquées `deliveredAt` lorsqu'elles sont servies. Délivrées purgées après 7 j ; non délivrées ignorées après 7 j |

`/stat` affiche en plus le statut en jeu (serveur) et la dernière connexion ; le bouton **👥 Joueurs** de `/config module:fivem` affiche la liaison Discord de chaque joueur.
`FiveMPendingAction.type` : `BAN` / `UNBAN` / `KICK` / `MESSAGE` / `SET_GROUPS`.

---

## 3. Exports de la ressource `rs_bridge`

| Export | Effet |
|--------|-------|
| `BanPlayer(source, reason, durationSeconds?, staffName?)` | Ban local + DropPlayer + `POST /sanctions` BAN (durée nulle = permanent) |
| `BanIdentifier(identifier, reason, durationSeconds?, staffName?)` | Idem pour un joueur hors ligne (`license:…`, `discord:…`, `steam:…`) |
| `UnbanPlayer(identifier, staffName?, reason?)` | Supprime le ban local + `POST /sanctions` UNBAN |
| `KickPlayer(source, reason, staffName?)` | DropPlayer + `POST /sanctions` KICK |
| `WarnPlayer(source, reason, staffName?)` | Notification en jeu + `POST /sanctions` WARN |
| `Ban(source \| identifiant, reason, durationSec?, alsoDiscord?, staffName?)` | Ban local + DropPlayer + `POST /sanctions` BAN avec `syncDiscord` (`nil` = réglage du serveur) |
| `Unban(identifier, reason?, alsoDiscord?, staffName?)` | Lève le ban local + `POST /sanctions` UNBAN avec `syncDiscord` |
| `SetPlayerName(source, name)` | Pseudo du compte en jeu → surnom Discord (à la création du compte puis à chaque changement), retenu par le bot |
| `AddStats(source, { kills?, deaths?, damage?, xp?, win?, top10?, matches? })` | Stats en direct, cumulées puis envoyées en lot toutes les `Config.StatsFlushInterval` s (pas de partie comptée) |
| `FlushStats()` | Envoie tout de suite les stats en direct en attente |
| `AddMatchStats(source, { kills, deaths, win, damage, top10, xp, season? })` | Stats de fin de partie (compte une partie) → `POST /stats` |
| `AddMatchStatsBatch({ { source, kills, … }, … })` | Idem en une requête (max 200) |
| `GetGroups(source)` / `GetGroup(source)` / `HasGroup(source, name)` | Groupes en jeu du joueur (rôles Discord, § 2.3) |

Événements locaux : `rs_bridge:action` (chaque action reçue du bot, pour l'appliquer aussi dans votre système de ban ESX/QBCore) et `rs_bridge:groupsChanged` (source, groupes, principal).
Console : `rsbridge` (réglages + test de connexion), `rsbridge unban <identifiant>`, `rsbridge groups <id>`.
Les stats en direct (`AddStats`) et de fin de partie (`AddMatchStats`) s'additionnent : n'envoyez pas deux fois la même statistique.
Hooks txAdmin (`Config.TxAdminHooks`) : `txAdmin:events:playerBanned`, `playerWarned`, `playerKicked`, `actionRevoked` (révocation de ban → UNBAN).

Exemples :
```lua
-- ESX (esx_adminplus, menu perso…)
exports.rs_bridge:BanPlayer(targetId, 'Cheat', 7 * 86400, GetPlayerName(adminId))
-- QBCore : dans qb-adminmenu, après l'insertion en base du ban
exports.rs_bridge:BanPlayer(targetId, reason, banTime - os.time(), GetPlayerName(src))
-- Battle Royale : fin de partie
exports.rs_bridge:AddMatchStats(src, { kills = 7, deaths = 1, win = true, damage = 1540, top10 = true, xp = 350 })
```

---

## 4. Authentification REST

| En-tête | Valeur |
|---------|--------|
| `x-api-key` | `FIVEM_API_KEY` (global) **ou** la clé propre au serveur (`FiveMServer.apiKey`). `Authorization: Bearer <clé>` est aussi accepté. |
| `x-server-key` | Optionnel. S'il est présent, il doit être identique au `:serverKey` de l'URL. |
| `Content-Type` | `application/json` |

Le serveur est identifié par l'URL : `/servers/:guildId/:serverKey/…`. Base URL : `${DASHBOARD_URL}/api/fivem`.

Réponses : toujours JSON. Erreurs : `{ "error": "<code>", "message": "<lisible>" }` — jamais de stack trace.

| HTTP | `error` | Cause |
|------|---------|-------|
| 400 | `validation` | Payload invalide (détail Zod dans `message`) |
| 400 | `invalid_json` / `invalid_guild` / `server_key_mismatch` | Corps ou en-têtes incohérents |
| 401 | `unauthorized` | Clé API invalide |
| 403 | `disabled` | Serveur désactivé |
| 404 | `not_found` | Serveur / route inconnue |
| 413 | `payload_too_large` | Corps > 512 ko |
| 429 | `rate_limited` | > **120 requêtes / minute / IP** (`Retry-After` fourni). `rs_bridge` en consomme ~8/min + 1 par connexion. |
| 500 | `internal` | Erreur interne (loguée côté bot) |

---

## 5. Endpoints

Préfixe commun : `B = /api/fivem/servers/:guildId/:serverKey`

| Méthode | Route | Corps | Réponse |
|---------|-------|-------|---------|
| POST | `B/status` | `{ online, players, maxPlayers, version?, maintenance?, playerList?: [{ id, name, identifiers, ping? }] }` | `{ ok, status }` — heartbeat 30–60 s, diff des joueurs |
| GET | `B/status` | — | Statut résolu sans la liste des joueurs |
| POST | `B/check` | `{ identifiers: [...], name? }` | `{ ok, allowed, reason?, message?, banned, banReason?, banExpiresAt?, whitelisted, linked, discordId, groups, group, managedGroups }` |
| POST | `B/players/join` | `{ id, name, identifiers, ping? }` | `{ ok, players, discordId, linked, member, nickname, groups, group, managedGroups }` |
| POST | `B/players/leave` | `{ id, name?, identifiers?, reason? }` | `{ ok, players, minutes, discordId }` |
| POST | `B/players/name` | `{ discordId? \| identifiers, name, id? }` | `{ ok, discordId, nickname }` (`nickname` null = ignoré : nom invalide, hiérarchie, option désactivée) |
| GET | `B/players` | — | Joueurs connus (dernier statut ou `players.json`) |
| GET | `B/actions` | — | `{ ok, count, actions: [{ id, type: BAN\|UNBAN\|KICK\|MESSAGE\|SET_GROUPS, discordId?, license?, identifiers?, reason?, expiresAt?, staff?, message?, groups?, group?, managedGroups?, createdAt }] }` — max 50, marquées délivrées |
| GET | `B/bans/:discordId` | — | `{ ok, discordId, banned, reason, expiresAt }` (ban Discord, cache 60 s) |
| POST | `B/sanctions` | `{ identifier?, identifiers?, discordId?, type: BAN\|KICK\|WARN\|UNBAN, reason, duration?, staff, syncDiscord? }` | `201 { ok, caseNumber, userId, discord: banned\|unbanned\|kicked\|warned\|recorded, propagated }` |
| POST | `B/stats` | Objet ou tableau (max 200) de stats normalisées (§ 5.1) | `{ ok, applied, unlinked, unlinkedIdentifiers, results }` (`202` si non lié) |
| GET | `B/whitelist/:identifier` | — | `{ ok, identifier, whitelisted, status, discordId }` |
| GET | `B/whitelist` | — | `{ ok, count, whitelist: [{ discordId, identifier, acceptedAt }] }` |
| POST | `B/maintenance` | `{ enabled }` | `{ ok, maintenance }` |
| GET | `/api/fivem/health` | — | `{ ok, service, uptime }` (sans auth) |

### 5.1 Stats Battle Royale

```json
{ "identifier": "license:abc…", "season": 3, "mode": "increment", "wins": 1, "kills": 7, "deaths": 1, "matches": 1, "damage": 1540, "top10": 1, "xp": 350, "playtimeMinutes": 0 }
```
- `mode` : `increment` (défaut) ou `set`. `season` : facultatif → saison courante.
- Profil retrouvé par `identifier` (licence) — lié automatiquement dès que le joueur se connecte avec Discord ouvert. Sinon `202 unlinked`.
- **Temps de jeu** : calculé par le bot à partir des sessions (join/leave). N'envoyez `playtimeMinutes` que si vous n'utilisez pas `/players/join|leave` (sinon double comptage).
- Formules : `level = floor(sqrt(xp / 100)) + 1`, `K/D = kills / max(1, deaths)`. L'XP alimente aussi le Battle Pass.

### 5.2 Sanctions

- Cible : `discordId` explicite, sinon identifiant `discord:` dans `identifiers`, sinon liaison connue de la licence.
- `BAN` + `duration` (secondes) ⇒ tempban (levé automatiquement sur Discord, puis UNBAN relayé aux serveurs).
- `syncDiscord` (BAN / UNBAN) : `true` / `false` force (ou empêche) l'action Discord pour cet appel ; absent = réglage `syncBansToDiscord` du serveur.
- La raison Discord est `[FiveM] <raison> (<staff>)`. Si l'action Discord est impossible (membre absent, hiérarchie, option désactivée, déjà banni), la sanction est **enregistrée** (`discord: "recorded"`) avec un log MODERATION.

---

## 6. Curl

```bash
BASE="https://bot.example.com/api/fivem/servers/123456789012345678/br"
KEY="change-me-fivem-api-key"
H=(-H "x-api-key: $KEY" -H "content-type: application/json")

curl -s -X POST "$BASE/check" "${H[@]}" -d '{"identifiers":["license:abc","discord:222222222222222222"]}'
curl -s -X POST "$BASE/players/join" "${H[@]}" -d '{"id":1,"name":"John","identifiers":["license:abc","discord:222222222222222222"]}'
curl -s -X POST "$BASE/players/name" "${H[@]}" -d '{"identifiers":["license:abc"],"name":"^1Viper"}'
curl -s -X POST "$BASE/sanctions" "${H[@]}" -d '{"identifiers":["license:abc","discord:222222222222222222"],"type":"BAN","reason":"Cheat","duration":86400,"staff":"Bob"}'
curl -s "$BASE/actions" -H "x-api-key: $KEY"
curl -s "$BASE/bans/222222222222222222" -H "x-api-key: $KEY"
curl -s -X POST "$BASE/players/leave" "${H[@]}" -d '{"id":1,"identifiers":["license:abc"]}'
```

---

## 7. Adaptateurs (ESX / QBCore / Custom)

L'adaptateur est choisi par `FiveMServer.framework`. Il **normalise** les payloads `stats` et `sanctions` ; `status` et `maintenance` ont toujours le format normalisé.

| Framework | Stats acceptées | Sanctions acceptées |
|-----------|-----------------|---------------------|
| **CUSTOM** | Payload normalisé strict (§ 5.1) | Payload normalisé strict (§ 5.2 : `identifier?`, `identifiers?`, `discordId?`, `type`, `reason`, `duration?`, `staff`) |
| **ESX** | `identifier`/`license`, `season?`, champs à plat ou dans `stats`/`data` : `wins|victories`, `kills`, `deaths`, `matches|played|games`, `damage|damage_dealt`, `top10`, `xp|experience`, `playtimeMinutes|playtime` | `identifier`, `type|action` (`ban|kick|warn|unban`, insensible à la casse), `identifiers` (liste), `reason|motif`, `duration|time|expire`, `staff|admin|author` ; `target: { identifier, discord }` accepté |
| **QBCORE** | `license|identifier` ou `citizenid` (→ `citizenid:<cid>`), champs à plat ou dans `metadata`/`stats` : `wins`, `kills`, `deaths`, `matches|games|rounds`, `damage`, `top10`, `xp`, `playtime` | `license|citizenid`, `action|type` (`ban|kick|warn|unban`), `identifiers`, `reason`, `expire|duration`, `admin|staff` |

Convar de maintenance lue en polling : `maintenance`/`sv_maintenance` (tous), `esx_maintenance` (ESX), `qb_maintenance` (QBCore).

---

---

## 8. Socket.IO — namespace `/fivem` (optionnel, temps réel)

Connexion : `io("${DASHBOARD_URL}/fivem", { auth: { apiKey, serverKey, guildId } })`. FiveM n'a pas de client Socket.IO Lua : `rs_bridge` utilise uniquement REST (polling `/actions` 10 s). Un pont Node (`socket.io-client`) reste possible pour du temps réel.

Entrants (mêmes schémas que REST, ack `{ ok, … }` ou `{ ok:false, error, message }`) : `status`, `stats`, `sanction`, `player:join`, `player:leave`, `player:name`, `check`, `whitelist:check`.

Sortants :

| Événement | Payload | Quand |
|-----------|---------|-------|
| `ready` | `{ serverKey, guildId, maintenance }` | À la connexion |
| `player:ban` / `player:unban` | `{ id?, discordId, license?, identifiers?, reason?, expiresAt?, staff }` | Ban / unban Discord (l'action est aussi tracée en base et marquée délivrée) |
| `whitelist:updated` | `{ discordId, identifier, status }` | Candidature acceptée / refusée |
| `maintenance` | `{ enabled }` | bouton Maintenance de `/config module:fivem` ou `POST /maintenance` |
| `error:event` | `{ event, error }` | Payload invalide |

---

## 9. FAQ

**Le surnom n'est pas appliqué.** Le bot doit avoir *Gérer les pseudos* et son rôle le plus haut doit être **au-dessus** du rôle le plus haut du membre. Le **propriétaire du serveur** ne peut jamais être renommé par un bot (limite Discord). Les noms vides, faits uniquement de symboles/emojis, contenant un lien, une invitation ou `@everyone` sont ignorés. Un échec est retenté au plus toutes les 30 min.

**Les rôles ne sont pas donnés.** *Gérer les rôles* + rôle du bot au-dessus de `linked_role` / `online_role` / rôles gérés. Le membre doit être sur le serveur Discord.

**Le compte ne se lie pas automatiquement.** FiveM ne fournit `discord:<id>` que si l'application Discord **de bureau** est ouverte au lancement de FiveM. Sinon : `/br-link license:…` (joueur) ou **🔗 Lier un membre** dans `/config module:fivem` (admin).

**Le salon compteur ne change pas tout de suite.** Discord limite le renommage d'un salon à 2 fois par 10 minutes : le bot renomme au plus toutes les 6 minutes et applique le dernier état connu ensuite.

**Intents.** `GuildMembers` (privilégié, à activer dans le portail développeur Discord → Bot → *Server Members Intent*) pour lire les membres et rôles ; `GuildModeration` pour recevoir les bans/unbans.

**Boucles ban jeu ↔ Discord ?** Non : un ban venant du jeu pose un marqueur de 30 s (`fromGame:ban:<guild>:<user>`) ; l'écouteur Discord → jeu l'ignore. Il est relayé directement aux *autres* serveurs du guild.

**Le bot est hors ligne pendant une connexion.** `Config.FailOpen = true` laisse entrer (les bans locaux KVP restent appliqués) ; `false` refuse. Les actions Discord → jeu attendent dans `FiveMPendingAction` (7 jours).

**Double comptage du temps de jeu.** N'envoyez pas `playtimeMinutes` dans `/stats` si `rs_bridge` gère les connexions.

---

## 10. Webhook Tebex — `/api/shop/tebex`

Monté par le dashboard via `createShopWebhookRouter()` sur `/api/shop`.

| En-tête | Valeur |
|---------|--------|
| `x-webhook-secret` | `TEBEX_WEBHOOK_SECRET` (`.env`) si défini, **sinon `FIVEM_API_KEY`**. |

Payload normalisé (à produire depuis votre endpoint Tebex ou une fonction serverless qui relaie le webhook Tebex natif) :
```json
{ "transactionId": "tbx-1234", "packageId": "5581234", "discordId": "123456789012345678", "status": "paid", "quantity": 1, "note": "…" }
```
`status` accepte les valeurs internes (`PENDING|PAID|DELIVERED|CANCELLED|REFUNDED`) ou les alias Tebex (`complete`, `payment.completed`, `refund`, `chargeback`, `declined`, …).

Logique : commande retrouvée par `tebexTransactionId`, sinon dernière commande `PENDING` du client (`discordId`) pour le produit dont `tebexPackageId = packageId`, sinon **création** d'une commande au statut reçu. Réponses : `200/201 { ok, orderId, status, created }`, `202 { ok:false, reason: "unknown_package" | "no_order" }`, `400 validation`, `401 unauthorized`.

---

---

## 11. Récapitulatif côté serveur de jeu

1. `/config module:fivem` → ➕ Ajouter, puis régler la vue du serveur (rôles, salon compteur, options).
2. Copier `fivem-resource/rs_bridge`, ajouter dans `server.cfg` les convars `rs_bridge_url` / `rs_bridge_guild` / `rs_bridge_server_key` / `rs_bridge_api_key`, les deux `add_ace resource.rs_bridge …` et `ensure rs_bridge`.
3. Brancher le menu admin sur `BanPlayer` / `UnbanPlayer` / `KickPlayer` / `WarnPlayer` (ou laisser les hooks txAdmin).
4. Gamemode BR : `SetPlayerName` à la création du compte, `AddStats` / `AddMatchStats` pour les stats, `Ban` pour le menu admin, `rs_bridge:groupsChanged` / `GetGroups` pour les droits.
5. Bot : rôle placé au-dessus des rôles gérés et des membres à renommer ; intent *Server Members* activé.
6. Shop : `tebexPackageId` sur chaque produit et webhooks Tebex relayés vers `/api/shop/tebex`.
