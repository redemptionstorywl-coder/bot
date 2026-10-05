# Installer le pont Discord sur le serveur « RS Battle Royale »

Guide pas à pas, sous Windows, sans connaissances techniques. Compter **15 minutes**.

À la fin :

- les **bans** passent du jeu à Discord et de Discord au jeu (avec une case pour choisir à chaque fois) ;
- le **pseudo choisi en jeu** devient le **surnom Discord** du joueur ;
- les **rôles Discord** (Staff, Modérateur…) donnent les **groupes en jeu** (admin, mod…) ;
- le **statut du serveur** (en ligne, joueurs, maintenance) s'affiche et se met à jour sur Discord ;
- les **statistiques** (victoires, kills…) arrivent sur Discord : commande `/stat` et **classement en direct**.

Ce qu'il vous faut :

| Élément | Où le trouver |
|---|---|
| Le dossier `fivem-resource/rs_bridge` | Dans le projet du bot (dépôt GitHub → bouton **Code → Download ZIP**, puis dézippez) |
| L'adresse du bot | `https://bot-f0v7.onrender.com` |
| L'ID de votre serveur Discord | Discord → **Paramètres utilisateur → Avancés → Mode développeur** (activer), puis **clic droit sur l'icône du serveur → Copier l'identifiant du serveur** |
| Une **clé API** | Vous l'inventez à l'étape 2 (ou la variable `FIVEM_API_KEY` du bot sur Render) |

---

## Étape 1 — Copier la ressource

1. Ouvrez l'**Explorateur de fichiers** et allez dans `E:\battleroyale\resources`.
2. Créez un dossier nommé exactement **`[rs]`** (avec les crochets). Les dossiers entre crochets servent juste à ranger : FiveM les lit automatiquement.
3. Copiez le dossier **`rs_bridge`** (celui qui contient `fxmanifest.lua`, `config.lua` et le dossier `server`) dans `E:\battleroyale\resources\[rs]\`.

Vous devez obtenir :

```
E:\battleroyale\resources\[rs]\rs_bridge\fxmanifest.lua
E:\battleroyale\resources\[rs]\rs_bridge\config.lua
E:\battleroyale\resources\[rs]\rs_bridge\server\main.lua
E:\battleroyale\resources\[rs]\rs_bridge\server\groups.lua
E:\battleroyale\resources\[rs]\rs_bridge\server\stats.lua
```

> Attention à ne pas créer `rs_bridge\rs_bridge\…` (double dossier) en dézippant.

---

## Étape 2 — Déclarer le serveur sur Discord

Sur votre serveur Discord, tapez **`/config module:fivem`** puis cliquez sur **➕ Ajouter** :

| Champ | Valeur à mettre |
|---|---|
| Clé du serveur | `br` (lettres minuscules, sans espace ; vous la réutiliserez à l'étape 3) |
| Nom | `RS Battle Royale` |
| Framework | `CUSTOM` |
| Hôte | laisser **vide** (le serveur envoie lui-même son statut) |
| Clé API propre | inventez une longue phrase sans espace, par exemple `RS-br-7f3Kq9x2Lm8Pz4` — **notez-la**, elle va dans `server.cfg` |

Le bot affiche ensuite la page du serveur. Réglez-y :

- **Salon du message de statut** (menu « Salon du message de statut ») : le salon où le bot affichera *🟢 En ligne · 12/64*, *🟠 Maintenance* ou *🔴 Hors ligne*, mis à jour tout seul.
- **Options de synchronisation actives** : laissez cochés *Bans jeu → Discord*, *Bans Discord → jeu* et *Pseudos*.
- **🎭 Rôles** : rôle « compte lié » (donné quand le compte Discord est relié) et rôle « en jeu » (donné pendant que le joueur joue).
- **🛡️ Groupes** : voir l'étape 5.

Tout cela se règle aussi sur le **dashboard** du bot (`https://bot-f0v7.onrender.com` → votre serveur → **FiveM** → *RS Battle Royale* → onglets *Réglages* et *Synchronisation*).

---

## Étape 3 — Modifier `server.cfg`

1. Ouvrez `E:\battleroyale\server.cfg` avec le **Bloc-notes** (clic droit → Ouvrir avec → Bloc-notes).
   Avec **txAdmin** : menu **CFG Editor**, c'est le même fichier.
2. Ajoutez ces lignes **avant** la ligne qui démarre votre gamemode Battle Royale (le gamemode utilise `rs_bridge`, il doit démarrer après) :

```cfg
# ───── Pont Discord (rs_bridge) ─────
set rs_bridge_url "https://bot-f0v7.onrender.com"
set rs_bridge_guild "COLLEZ_ICI_L_ID_DU_SERVEUR_DISCORD"
set rs_bridge_server_key "br"
set rs_bridge_api_key "COLLEZ_ICI_LA_CLE_API_DE_L_ETAPE_2"

# Autorise rs_bridge à donner / retirer les groupes en jeu (rôles Discord → admin, mod…)
add_ace resource.rs_bridge command.add_principal allow
add_ace resource.rs_bridge command.remove_principal allow

ensure rs_bridge
```

3. Remplacez les deux textes en MAJUSCULES (gardez les guillemets), enregistrez (**Ctrl + S**).
4. Redémarrez le serveur FiveM.

> Ne partagez jamais votre `server.cfg` : la clé API permet de parler au bot.

---

## Étape 4 — Tester

### 4.1 Dans la console du serveur (fenêtre noire ou console txAdmin)

Au démarrage, vous devez voir en vert :

```
[rs_bridge] Connecté au bot (123456789012345678 / br).
```

Tapez la commande **`rsbridge`** dans la console : elle affiche les réglages lus et termine par **`Liaison OK.`**

| Message | Cause | Solution |
|---|---|---|
| `Clé API refusée (401)` | `rs_bridge_api_key` différente de la clé de l'étape 2 | Recopiez la clé (sans espace avant / après) |
| `Serveur inconnu (404)` | Mauvais ID Discord ou clé du serveur | Vérifiez `rs_bridge_guild` et `rs_bridge_server_key "br"` |
| `Bot injoignable (0)` | Le bot démarre (hébergement gratuit en veille) ou adresse fausse | Attendez 1 minute puis retapez `rsbridge` ; vérifiez `rs_bridge_url` |
| `clé API=MANQUANTE` | La ligne `set rs_bridge_api_key` est absente ou après `ensure rs_bridge` | Placez les `set …` **avant** `ensure rs_bridge` |

### 4.2 Le contrôle de connexion `/check` (depuis Windows, facultatif)

C'est la vérification que le serveur fait à chaque connexion d'un joueur. Ouvrez **PowerShell** (menu Démarrer → tapez *PowerShell*) et collez, en remplaçant les 3 valeurs :

```powershell
$cle = "LA_CLE_API"
$guild = "ID_DU_SERVEUR_DISCORD"
$moi = "VOTRE_ID_DISCORD"   # clic droit sur votre pseudo → Copier l'identifiant de l'utilisateur
Invoke-RestMethod -Method Post -Uri "https://bot-f0v7.onrender.com/api/fivem/servers/$guild/br/check" `
  -Headers @{ "x-api-key" = $cle } -ContentType "application/json" `
  -Body "{`"identifiers`":[`"discord:$moi`",`"license:test`"]}"
```

Réponse attendue : `allowed : True`, `linked : True`, `discordId` = votre ID, et `groups` = vos groupes en jeu (étape 5).
Si vous êtes banni du Discord : `allowed : False` et `reason : banned`.

### 4.3 En jeu

1. Ouvrez **Discord sur votre PC** (l'application, pas le navigateur), puis lancez FiveM et connectez-vous au serveur.
2. Sur Discord, en quelques secondes : vous recevez le rôle « en jeu », votre compte est relié (rôle « compte lié »), et le message de statut affiche un joueur de plus.
3. Quand le gamemode appelle `SetPlayerName` (création du compte, voir la section développeur), votre **surnom Discord** devient votre pseudo en jeu.
4. Tapez **`/stat`** sur Discord : vos statistiques s'affichent dès la première partie envoyée.

> Le bot ne peut pas renommer le **propriétaire** du serveur Discord ni un membre dont le rôle est au-dessus du sien : placez le rôle du bot **tout en haut** de la liste des rôles (Paramètres du serveur → Rôles).

---

## Étape 5 — Rôles Discord → groupes en jeu

`/config module:fivem` → *RS Battle Royale* → **🛡️ Groupes** → **➕ Associer un rôle** :

| Rôle Discord | Groupe en jeu | Priorité |
|---|---|---|
| Staff | `admin` | 1 |
| Modérateur | `mod` | 2 |
| VIP | `vip` | 3 |

- **La priorité compte** : un membre qui a *Staff* et *Modérateur* reçoit le groupe **admin** (le premier de la liste).
- Le changement s'applique **à la connexion** et **environ 10 secondes** après qu'un rôle a été donné ou retiré sur Discord, même si le joueur est en jeu.
- Les droits de chaque groupe se donnent comme d'habitude dans `server.cfg`, par exemple :

```cfg
add_ace group.admin command allow          # toutes les commandes
add_principal group.admin group.mod        # un admin a aussi les droits mod
add_ace group.mod command.kick allow
```

- Ne donnez pas ces mêmes groupes « à la main » à un joueur (`add_principal identifier.… group.admin`) : le bot les retire à ceux qui n'ont pas le rôle.

---

## Étape 6 — Classement en direct et salon `/stat`

`/config module:battleroyale` → **📺 Affichage** :

1. **Salon du classement** : choisissez un salon (ex. `#classement`). Le bot y publie **un seul message** (Top 10 ou 15 en victoires, kills et K/D, saison en cours) et **le modifie tout seul** après les parties (au plus une fois par minute). S'il est supprimé, il revient.
2. **Taille** : Top 10 ou Top 15.
3. **Salon `/stat`** (facultatif) : si vous choisissez un salon (ex. `#stats`), `/stat` ne répond que là ; ailleurs, le membre reçoit un lien vers ce salon.

Même réglage sur le dashboard : **Battle Royale → Affichage**.

`/stat` est ouverte à tout le monde : `/stat` (ses stats) ou `/stat joueur:` (Discord propose les pseudos en jeu ; une mention `@membre` fonctionne aussi).

---

## Étape 7 — Bans

| Où | Comment |
|---|---|
| Discord | `/ban`, `/tempban`, `/unban` ont une option **`en_jeu`** : *True* = aussi banni en jeu, *False* = Discord seulement, vide = réglage *Bans Discord → jeu* du serveur. |
| Dashboard | Fiche d'un membre (Membres → cliquer sur le membre) → carte **Bannir** avec la case **Bannir aussi en jeu (FiveM)**. |
| En jeu | Le menu admin du gamemode appelle `exports.rs_bridge:Ban(...)` (voir ci-dessous) : choix « aussi sur Discord » à chaque ban. txAdmin est relayé automatiquement. |

Un ban n'est jamais renvoyé en boucle (jeu → Discord → jeu).

---

## Pour ton développeur

Toutes les fonctions sont des **exports serveur** de `rs_bridge` (à appeler dans des scripts `server`). `source` = l'ID du joueur sur le serveur.

### Création du compte / choix du pseudo → surnom Discord

À appeler **quand le joueur crée son compte** (premier choix du pseudo), puis à chaque changement de pseudo. Le bot retient ce pseudo : il est réappliqué à chaque connexion, affiché dans le classement et dans `/stat`.

```lua
-- Exemple : événement de votre gamemode quand le compte est créé
RegisterNetEvent('rsbr:createAccount', function(pseudo)
  local src = source
  -- … création du compte dans votre base …
  exports.rs_bridge:SetPlayerName(src, pseudo)   -- true si envoyé
end)

-- Et au chargement d'un compte existant (connexion), pour être sûr que Discord est à jour :
AddEventHandler('rsbr:accountLoaded', function(src, account)
  exports.rs_bridge:SetPlayerName(src, account.pseudo)
end)
```

### Statistiques pendant la partie (kill, mort, dégâts)

Cumulées puis envoyées en un seul envoi toutes les 15 secondes : vous pouvez appeler à chaque kill sans risque.

```lua
AddEventHandler('rsbr:playerKilled', function(victimSrc, killerSrc, damage)
  if killerSrc and killerSrc ~= victimSrc then
    exports.rs_bridge:AddStats(killerSrc, { kills = 1, damage = damage or 0, xp = 25 })
  end
  exports.rs_bridge:AddStats(victimSrc, { deaths = 1 })
end)
```

### Fin de partie

Une ligne par joueur : compte **une partie jouée**. Si vous envoyez déjà kills / morts avec `AddStats`, ne les renvoyez pas ici (sinon ils comptent double).

```lua
AddEventHandler('rsbr:matchEnded', function(results)
  -- results = { { src = 3, place = 1 }, { src = 7, place = 5 }, … }
  for _, r in ipairs(results) do
    exports.rs_bridge:AddMatchStats(r.src, {
      win = (r.place == 1),
      top10 = (r.place <= 10),
      xp = r.place == 1 and 300 or 100,
    })
  end
  exports.rs_bridge:FlushStats()   -- facultatif : envoi immédiat des stats en direct restantes
end)
```

Variante « tout à la fin » (sans `AddStats`) : `AddMatchStats(src, { kills = 7, deaths = 1, damage = 1540, win = true, top10 = true, xp = 350 })`, ou pour tous les joueurs en une requête : `exports.rs_bridge:AddMatchStatsBatch({ { source = 3, kills = 7, win = true }, { source = 7, kills = 1, deaths = 1 } })`.

### Ban depuis le menu admin

```lua
-- Ban 7 jours, aussi banni du Discord
exports.rs_bridge:Ban(targetSrc, 'Cheat', 7 * 86400, true, GetPlayerName(adminSrc))
-- Ban définitif en jeu seulement (pas sur Discord)
exports.rs_bridge:Ban(targetSrc, 'Insultes', 0, false, GetPlayerName(adminSrc))
-- nil = réglage « Bans jeu → Discord » du serveur ; un identifiant marche aussi pour un joueur hors ligne
exports.rs_bridge:Ban('license:0123abcd…', 'Cheat', nil, nil, 'Console')
-- Débannir (aussi sur Discord)
exports.rs_bridge:Unban('license:0123abcd…', 'Erreur', true, GetPlayerName(adminSrc))
```

`KickPlayer(src, raison, staff)` et `WarnPlayer(src, raison, staff)` existent aussi. Les bans venant de Discord sont appliqués par `rs_bridge` (le joueur est expulsé et ne peut plus se connecter) ; pour les copier aussi dans votre propre système : `AddEventHandler('rs_bridge:action', function(action) … end)` (`action.type` = `BAN`, `UNBAN`, `KICK`, `MESSAGE` ou `SET_GROUPS`).

### Groupes (droits staff en jeu)

```lua
-- Quand les rôles Discord d'un joueur changent (connexion ou rôle modifié sur Discord)
AddEventHandler('rs_bridge:groupsChanged', function(src, groups, primary)
  -- groups = { 'admin', 'mod' } (du plus important au moins important), primary = 'admin' ou nil
  TriggerClientEvent('rsbr:setStaff', src, primary == 'admin' or primary == 'mod')
end)

-- À tout moment
local groupe = exports.rs_bridge:GetGroup(src)            -- 'admin' / 'mod' / … ou nil
local estModo = exports.rs_bridge:HasGroup(src, 'mod')     -- true / false
local tous = exports.rs_bridge:GetGroups(src)              -- { 'admin', 'mod' }
-- Les droits ACE marchent aussi directement :
if IsPlayerAceAllowed(src, 'command.kick') then … end
```

Dans `config.lua` : `Config.GroupsMode = 'highest'` (défaut, seul le groupe le plus important est donné) ou `'all'` (tous les groupes du joueur).

### Commandes console utiles

| Commande | Effet |
|---|---|
| `rsbridge` | Affiche les réglages et teste la liaison avec le bot |
| `rsbridge groups 3` | Groupes en jeu du joueur n° 3 |
| `rsbridge unban license:…` | Lève un ban local et le signale au bot |

Référence technique complète (API, sécurité, formats) : [`FIVEM.md`](FIVEM.md).
