# Intégration FiveM — Redemption Story Bot

Ce document décrit **tout ce qu'il faut brancher côté serveur de jeu** pour relier un serveur FiveM (ESX, QBCore ou framework custom) au bot : statut en temps réel, statistiques Battle Royale, whitelist, sanctions, maintenance, webhook Tebex.

---

## 1. Vue d'ensemble

```
FiveM (Lua)  ──REST (x-api-key)──▶  /api/fivem/servers/:guildId/:serverKey/…   ──▶ FiveMService ──▶ Discord
             ◀──Socket.IO /fivem──▶  (événements temps réel, optionnel)
Tebex        ──Webhook────────────▶  /api/shop/tebex  (x-webhook-secret)         ──▶ ShopService
Bot          ──polling 60 s──────▶  http://<host>/info.json + /players.json      (si `host` configuré)
```

Deux modes complémentaires :

| Mode | Quand l'utiliser | Ce que fait le bot |
|------|------------------|--------------------|
| **Push (REST / Socket.IO)** | Toujours recommandé | Le serveur envoie son statut, ses stats, ses sanctions. |
| **Polling** | Si `host` est renseigné (`/fivem add … host:`) | Toutes les 60 s le bot lit `/info.json` et `/players.json` (endpoints natifs FiveM, timeout 5 s). |

Un serveur sans nouvelles depuis **3 minutes** est marqué 🔴 hors ligne automatiquement.

---

## 2. Déclarer le serveur dans Discord

```
/fivem add key:main name:"Redemption Prison" framework:ESX host:http://1.2.3.4:30120 api_key:<clé optionnelle>
/fivem status-channel key:main channel:#statut-serveur
```

- `key` : identifiant court unique par Discord (`[a-z0-9_-]{2,64}`), utilisé dans toutes les URLs.
- `framework` : `ESX` · `QBCORE` · `CUSTOM` — choisit l'**adaptateur** qui normalise vos payloads (§ 5).
- `host` : active le polling (facultatif).
- `api_key` : clé propre au serveur. Sinon la clé globale `FIVEM_API_KEY` (fichier `.env`) est utilisée.

Autres commandes : `/fivem list`, `/fivem status [key]`, `/fivem maintenance <key> on|off`, `/fivem players <key>`, `/fivem remove <key>`.

Le message de statut (embed violet 🟢 / 🔴 / 🟠, joueurs x/y, version, dernière mise à jour `<t:R>`, uptime) est **édité** toutes les 60 s, jamais reposté.

---

## 3. Authentification REST

| En-tête | Valeur |
|---------|--------|
| `x-api-key` | `FIVEM_API_KEY` (global) **ou** la clé propre au serveur (`FiveMServer.apiKey`). `Authorization: Bearer <clé>` est aussi accepté. |
| `x-server-key` | Optionnel. S'il est présent, il doit être identique au `:serverKey` de l'URL. |
| `Content-Type` | `application/json` |

Le serveur est identifié par l'URL : `/servers/:guildId/:serverKey/…`.

Réponses : toujours JSON. Erreurs : `{ "error": "<code>", "message": "<lisible>" }` — jamais de stack trace.

| HTTP | `error` | Cause |
|------|---------|-------|
| 400 | `validation` | Payload invalide (détail Zod dans `message`) |
| 400 | `invalid_json` / `invalid_guild` / `server_key_mismatch` | Corps ou en-têtes incohérents |
| 401 | `unauthorized` | Clé API invalide |
| 403 | `disabled` | Serveur désactivé |
| 404 | `not_found` | Serveur / route inconnue |
| 413 | `payload_too_large` | Corps > 512 ko |
| 429 | `rate_limited` | > **120 requêtes / minute / IP** (`Retry-After` fourni) |
| 500 | `internal` | Erreur interne (loguée côté bot) |

Base URL : `${DASHBOARD_URL}/api/fivem` (le dashboard monte `createFiveMRouter(client)` sur `/api/fivem`).

---

## 4. Endpoints

Préfixe commun : `B = /api/fivem/servers/:guildId/:serverKey`

### 4.1 `POST B/status` — heartbeat / statut

```json
{
  "online": true,
  "players": 42,
  "maxPlayers": 64,
  "version": "FXServer 7290",
  "maintenance": false,
  "playerList": [
    { "id": 1, "name": "John", "identifiers": ["license:abc…", "discord:123456789012345678"], "ping": 45 }
  ]
}
```
Tous les champs sauf `online` ont une valeur par défaut. Réponse `200 { ok, status }`. Met à jour `lastStatus`, `lastSeenAt` et le message Discord. Envoyer toutes les **30–60 s**.

### 4.2 `GET B/status`
Retourne le statut résolu (`online` tient compte de la fraîcheur), sans la liste des joueurs.

### 4.3 `POST B/stats` — statistiques Battle Royale (fin de partie)

Payload **normalisé** (framework `CUSTOM`) — un objet ou un tableau (max 200) :
```json
{
  "identifier": "license:abc…",
  "season": 3,
  "mode": "increment",
  "wins": 1, "kills": 7, "deaths": 1, "matches": 1, "damage": 1540, "top10": 1,
  "xp": 350, "playtimeMinutes": 18
}
```
- `mode` : `increment` (défaut, valeurs **ajoutées**) ou `set` (valeurs remplacées).
- `season` : facultatif → saison courante (Battle Pass actif, sinon la plus récente).
- Le profil est retrouvé par `identifier`. **Si le joueur n'a pas lié son identifiant via `/br-link`**, la réponse est `202` avec `unlinked: true` et `unlinkedIdentifiers: [...]` ; les stats ne sont pas conservées — affichez-lui un message en jeu l'invitant à faire `/br-link license:…` sur Discord.
- Formules : `level = floor(sqrt(xp / 100)) + 1`, `K/D = kills / max(1, deaths)`. L'XP alimente aussi le Battle Pass (`battlePassXp` → palier).

Réponse : `{ ok, applied, unlinked, unlinkedIdentifiers, results: [{ applied, profileId?, season?, level? }] }`.

### 4.4 `GET B/whitelist/:identifier`
`identifier` = `license:…`, ou un **Discord ID** (`123…` ou `discord:123…`).
```json
{ "ok": true, "identifier": "license:abc", "whitelisted": true, "status": "ACCEPTED", "discordId": "1234567890" }
```
`status` ∈ `PENDING | ACCEPTED | REJECTED | null`.

### 4.5 `GET B/whitelist`
Liste des acceptés : `{ ok, count, whitelist: [{ discordId, identifier, acceptedAt }] }` — pratique pour un cache local au démarrage de la ressource.

### 4.6 `POST B/sanctions` — sanction prise en jeu

```json
{ "identifier": "license:abc…", "discordId": "1234567890", "type": "BAN", "reason": "Cheat", "duration": 86400, "staff": "Admin Bob" }
```
- `identifier` **ou** `discordId` requis ; `type` ∈ `BAN | KICK | WARN` ; `duration` en secondes (BAN + duration ⇒ `TEMPBAN`).
- Crée un `Sanction` (métadonnées `{ source: "fivem", serverKey, identifier, staff }`) et un log **MODERATION**. Le Discord ID est déduit du profil BR ou de la whitelist si absent.
- Réponse `201 { ok, caseNumber, userId }`.

### 4.7 `GET B/players`
Liste des joueurs connus (dernier statut, ou `players.json` si `host` configuré).

### 4.8 `POST B/maintenance`
```json
{ "enabled": true }
```
Bascule la maintenance (embed 🟠) et émet `maintenance` aux sockets du serveur.

### 4.9 `GET /api/fivem/health`
`{ ok: true, service: "fivem", uptime }` — sans auth.

---

## 5. Adaptateurs (ESX / QBCore / Custom)

L'adaptateur est choisi par `FiveMServer.framework`. Il **normalise** les payloads `stats` et `sanctions` ; `status` et `maintenance` ont toujours le format normalisé.

| Framework | Stats acceptées | Sanctions acceptées |
|-----------|-----------------|---------------------|
| **CUSTOM** | Payload normalisé strict (§ 4.3) | Payload normalisé strict (§ 4.6) |
| **ESX** | `identifier`/`license`, `season?`, champs à plat ou dans `stats`/`data` : `wins|victories`, `kills`, `deaths`, `matches|played|games`, `damage|damage_dealt`, `top10`, `xp|experience`, `playtimeMinutes|playtime` | `identifier`, `type|action` (`ban|kick|warn`, insensible à la casse), `reason|motif`, `duration|time|expire`, `staff|admin|author` ; `target: { identifier, discord }` accepté |
| **QBCORE** | `license|identifier` ou `citizenid` (→ `citizenid:<cid>`), champs à plat ou dans `metadata`/`stats` : `wins`, `kills`, `deaths`, `matches|games|rounds`, `damage`, `top10`, `xp`, `playtime` | `license|citizenid`, `action|type`, `reason`, `expire|duration`, `admin|staff` |

Convar de maintenance lue en polling : `maintenance`/`sv_maintenance` (tous), `esx_maintenance` (ESX), `qb_maintenance` (QBCore).

---

## 6. Socket.IO — namespace `/fivem` (optionnel, temps réel)

Connexion : `io("${DASHBOARD_URL}/fivem", { auth: { apiKey, serverKey, guildId } })`.

Événements **entrants** (mêmes schémas Zod que REST, réponse via *ack* `{ ok, … }` ou `{ ok:false, error, message }`) :

| Événement | Payload |
|-----------|---------|
| `status` | § 4.1 |
| `stats` | § 4.3 (objet ou tableau) |
| `sanction` | § 4.6 |
| `player:join` | `{ id, name, identifiers, ping? }` → ajouté à la liste, compteur mis à jour |
| `player:leave` | `{ id, name?, reason? }` |
| `whitelist:check` | `"license:…"` ou `{ identifier }` → ack `{ ok, whitelisted, status, discordId }` |

Événements **sortants** (du bot vers le serveur) :

| Événement | Payload | Quand |
|-----------|---------|-------|
| `ready` | `{ serverKey, guildId, maintenance }` | À la connexion |
| `whitelist:updated` | `{ discordId, identifier, status }` | Une candidature est acceptée / refusée dans Discord |
| `maintenance` | `{ enabled }` | `/fivem maintenance` ou `POST /maintenance` |
| `error:event` | `{ event, error }` | Payload invalide |

> FiveM n'a pas de client Socket.IO Lua natif. Deux options : utiliser **REST depuis Lua** (recommandé, § 7) et un **pont Node.js** (`socket.io-client`) côté machine de jeu pour recevoir `whitelist:updated` / `maintenance`, ou une ressource Node (FXServer supporte les ressources JS côté serveur : `server_script 'bridge.js'` avec `socket.io-client` bundlé).

---

## 7. Exemples

### 7.1 curl

```bash
BASE="https://bot.example.com/api/fivem/servers/123456789012345678/main"
KEY="change-me-fivem-api-key"

# Heartbeat
curl -s -X POST "$BASE/status" -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"online":true,"players":2,"maxPlayers":64,"version":"7290","playerList":[{"id":1,"name":"John","identifiers":["license:abc"]}]}'

# Stats fin de partie (lot)
curl -s -X POST "$BASE/stats" -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '[{"identifier":"license:abc","wins":1,"kills":5,"deaths":1,"matches":1,"xp":300,"playtimeMinutes":15}]'

# Whitelist
curl -s "$BASE/whitelist/license:abc" -H "x-api-key: $KEY"
curl -s "$BASE/whitelist" -H "x-api-key: $KEY"

# Sanction
curl -s -X POST "$BASE/sanctions" -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"identifier":"license:abc","type":"KICK","reason":"AFK","staff":"Bob"}'

# Maintenance
curl -s -X POST "$BASE/maintenance" -H "x-api-key: $KEY" -H "content-type: application/json" -d '{"enabled":true}'
```

### 7.2 Ressource Lua (serveur) — `rs_bridge/server.lua`

```lua
-- fxmanifest.lua : fx_version 'cerulean' / game 'gta5' / server_script 'server.lua'
local BASE   = GetConvar('rs_api_base', 'https://bot.example.com/api/fivem/servers/<GUILD_ID>/<SERVER_KEY>')
local APIKEY = GetConvar('rs_api_key', 'change-me-fivem-api-key')
local HEADERS = { ['content-type'] = 'application/json', ['x-api-key'] = APIKEY }

local function post(path, body, cb)
  PerformHttpRequest(BASE .. path, function(status, text)
    if cb then cb(status, text and json.decode(text) or nil) end
    if status >= 400 then print(('[rs_bridge] %s -> %s %s'):format(path, status, text or '')) end
  end, 'POST', json.encode(body), HEADERS)
end

local function get(path, cb)
  PerformHttpRequest(BASE .. path, function(status, text) cb(status, text and json.decode(text) or nil) end, 'GET', '', HEADERS)
end

local function license(src)
  for _, id in ipairs(GetPlayerIdentifiers(src)) do if id:sub(1, 8) == 'license:' then return id end end
end

-- 1) Heartbeat toutes les 45 s
CreateThread(function()
  while true do
    local list = {}
    for _, src in ipairs(GetPlayers()) do
      list[#list + 1] = { id = tonumber(src), name = GetPlayerName(src), identifiers = GetPlayerIdentifiers(src), ping = GetPlayerPing(src) }
    end
    post('/status', {
      online = true, players = #list, maxPlayers = GetConvarInt('sv_maxClients', 32),
      version = GetConvar('version', ''), maintenance = GetConvar('maintenance', 'false') == 'true', playerList = list,
    })
    Wait(45000)
  end
end)

-- 2) Whitelist à la connexion (deferrals)
AddEventHandler('playerConnecting', function(name, setKick, deferrals)
  local src = source
  deferrals.defer()
  Wait(0)
  deferrals.update('Vérification whitelist…')
  local lic = license(src)
  if not lic then return deferrals.done('Licence introuvable.') end
  get('/whitelist/' .. lic, function(status, data)
    if status == 200 and data and data.whitelisted then
      deferrals.done()
    else
      deferrals.done('Vous n\'êtes pas whitelisté. Faites /whitelist apply sur Discord.')
    end
  end)
end)

-- 3) Stats de fin de partie (appelé par votre gamemode)
-- exports['rs_bridge']:ReportMatch({ { identifier = 'license:…', wins = 1, kills = 5, deaths = 1, matches = 1, damage = 900, top10 = 1, xp = 300, playtimeMinutes = 15 }, ... })
exports('ReportMatch', function(rows)
  post('/stats', rows, function(status, data)
    if data and data.unlinked then
      for _, lic in ipairs(data.unlinkedIdentifiers or {}) do
        for _, src in ipairs(GetPlayers()) do
          if license(src) == lic then
            TriggerClientEvent('chat:addMessage', src, { args = { 'Redemption', 'Liez votre compte sur Discord : /br-link ' .. lic } })
          end
        end
      end
    end
  end)
end)

-- 4) Sanctions (ex: depuis votre menu admin)
-- exports['rs_bridge']:ReportSanction(targetSrc, 'BAN', 'Cheat', 86400, GetPlayerName(adminSrc))
exports('ReportSanction', function(target, kind, reason, duration, staff)
  post('/sanctions', { identifier = license(target), type = kind, reason = reason, duration = duration, staff = staff })
end)
```

Convars à ajouter dans `server.cfg` : `set rs_api_base "https://…/api/fivem/servers/<GUILD_ID>/<SERVER_KEY>"` et `set rs_api_key "<clé>"`.

### 7.3 Pont Node.js Socket.IO (optionnel)

```js
const { io } = require('socket.io-client');
const socket = io('https://bot.example.com/fivem', { auth: { apiKey: process.env.RS_API_KEY, serverKey: 'main', guildId: '123456789012345678' } });
socket.on('ready', (info) => console.log('connected', info));
socket.on('whitelist:updated', ({ discordId, identifier, status }) => { /* rafraîchir le cache whitelist du serveur */ });
socket.on('maintenance', ({ enabled }) => { /* ExecuteCommand(`set maintenance ${enabled}`) via RCON / ressource */ });
socket.emit('status', { online: true, players: 0, maxPlayers: 64 }, (ack) => console.log(ack));
```

---

## 8. Webhook Tebex — `/api/shop/tebex`

Monté par le dashboard via `createShopWebhookRouter()` sur `/api/shop`.

| En-tête | Valeur |
|---------|--------|
| `x-webhook-secret` | `TEBEX_WEBHOOK_SECRET` si défini dans l'environnement, **sinon `FIVEM_API_KEY`** (aucune variable dédiée dans `env.ts` pour l'instant). |

Payload normalisé (à produire depuis votre endpoint Tebex ou une fonction serverless qui relaie le webhook Tebex natif) :
```json
{ "transactionId": "tbx-1234", "packageId": "5581234", "discordId": "123456789012345678", "status": "paid", "quantity": 1, "note": "…" }
```
`status` accepte les valeurs internes (`PENDING|PAID|DELIVERED|CANCELLED|REFUNDED`) ou les alias Tebex (`complete`, `payment.completed`, `refund`, `chargeback`, `declined`, …).

Logique : commande retrouvée par `tebexTransactionId`, sinon dernière commande `PENDING` du client (`discordId`) pour le produit dont `tebexPackageId = packageId`, sinon **création** d'une commande au statut reçu. Réponses : `200/201 { ok, orderId, status, created }`, `202 { ok:false, reason: "unknown_package" | "no_order" }`, `400 validation`, `401 unauthorized`.

---

## 9. Récapitulatif côté serveur de jeu

1. Déclarer le serveur : `/fivem add`, noter l'URL de base et la clé.
2. Installer la ressource `rs_bridge` (§ 7.2) : heartbeat `/status`, vérification `/whitelist/:identifier` dans `playerConnecting`, appel de `ReportMatch` à la fin de chaque partie, `ReportSanction` depuis le menu admin.
3. (Optionnel) Renseigner `host` pour le polling `info.json` / `players.json` — ouvrir le port HTTP du serveur FiveM au bot.
4. (Optionnel) Pont Socket.IO pour recevoir `whitelist:updated` / `maintenance` en temps réel.
5. Demander aux joueurs Battle Royale de lier leur identifiant : `/br-link license:…`.
6. Shop : configurer `tebexPackageId` sur chaque produit (`/shop product add … tebex_package:`) et relayer les webhooks Tebex vers `/api/shop/tebex`.
