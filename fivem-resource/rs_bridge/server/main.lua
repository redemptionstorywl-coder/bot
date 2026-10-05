--[[
  rs_bridge — pont FiveM ⇄ bot Discord (côté serveur)

  Flux :
    playerConnecting  → POST /check        (ban Discord, Discord requis, rôle requis, whitelist, groupes ACE) + bans locaux (KVP)
    playerJoining     → POST /players/join (liaison auto du compte, rôles, surnom Discord, groupes ACE)
    playerDropped     → POST /players/leave (temps de jeu, retrait du rôle « en jeu »)
    boucle statut     → POST /status       (compteur, liste des joueurs, message de statut Discord)
    boucle actions    → GET  /actions      (ban / unban / kick / message / groupes venant de Discord)
    exports           → POST /sanctions    (Ban, Unban, BanPlayer, UnbanPlayer, KickPlayer, WarnPlayer)
                      → POST /players/name (SetPlayerName : pseudo du compte en jeu → surnom Discord)
    txAdmin (option)  → POST /sanctions    (relai automatique des sanctions txAdmin)

  Réglages de connexion : convars server.cfg (prioritaires) ou config.lua
    set rs_bridge_url "https://…"   set rs_bridge_guild "ID Discord"   set rs_bridge_server_key "br"   set rs_bridge_api_key "…"
]]

RSBridge = {}

local resourceName = GetCurrentResourceName()

--- Convar non vide, sinon valeur de config.lua.
local function setting(convar, fallback)
  local v = GetConvar(convar, '')
  if v ~= '' then return v end
  return fallback or ''
end

local botUrl = setting('rs_bridge_url', Config.BotUrl):gsub('/+$', '')
local guildId = setting('rs_bridge_guild', Config.GuildId)
local serverKey = setting('rs_bridge_server_key', Config.ServerKey)
local apiKey = setting('rs_bridge_api_key', Config.ApiKey)
RSBridge.settings = { botUrl = botUrl, guildId = guildId, serverKey = serverKey }

local baseUrl = ('%s/api/fivem/servers/%s/%s'):format(botUrl, guildId, serverKey)
local headers = {
  ['Content-Type'] = 'application/json',
  ['Accept'] = 'application/json',
  ['x-api-key'] = apiKey,
  ['x-server-key'] = serverKey,
}

-- Pseudos imposés par le gamemode / le framework (source → nom)
local customNames = {}

-- ───────────────────────── Utilitaires ─────────────────────────

--- Chaîne non vide ou nil (les `null` JSON peuvent être décodés en valeur sentinelle).
local function str(v)
  if type(v) == 'string' and v ~= '' then return v end
  return nil
end
RSBridge.str = str

local function debug(fmt, ...)
  if Config.Debug then print(('^5[%s]^7 ' .. fmt):format(resourceName, ...)) end
end
RSBridge.debug = debug

local function warn(fmt, ...)
  print(('^3[%s]^7 ' .. fmt):format(resourceName, ...))
end
RSBridge.warn = warn

--- Message localisé (Config.Messages[Config.Locale][key]) formaté avec string.format.
local function msg(key, ...)
  local lang = Config.Messages[Config.Locale] or Config.Messages.fr
  local text = lang[key] or Config.Messages.fr[key] or key
  if select('#', ...) > 0 then
    local ok, out = pcall(string.format, text, ...)
    if ok then return out end
  end
  return text
end
RSBridge.msg = msg

--- Requête HTTP JSON vers l'API du bot, avec délai maximal. cb(status, data|nil)
--- status = 0 si timeout / réseau.
local function request(method, path, body, cb)
  local done = false
  local function finish(status, data)
    if done then return end
    done = true
    if cb then
      local ok, err = pcall(cb, status, data)
      if not ok then warn('callback %s %s : %s', method, path, err) end
    end
  end

  local payload = ''
  if body ~= nil then
    local ok, encoded = pcall(json.encode, body)
    if not ok then
      warn('JSON invalide pour %s : %s', path, encoded)
      return finish(0, nil)
    end
    payload = encoded
  end

  PerformHttpRequest(baseUrl .. path, function(status, text)
    local data = nil
    if text and text ~= '' then
      local ok, decoded = pcall(json.decode, text)
      if ok then data = decoded end
    end
    status = tonumber(status) or 0
    if status == 0 then
      debug('%s %s → injoignable', method, path)
    elseif status >= 400 then
      warn('%s %s → HTTP %d %s', method, path, status, data and data.message or '')
    else
      debug('%s %s → %d', method, path, status)
    end
    finish(status, data)
  end, method, payload, headers)

  SetTimeout(Config.HttpTimeout or 8000, function()
    if not done then debug('%s %s → timeout', method, path) end
    finish(0, nil)
  end)
end

function RSBridge.post(path, body, cb) request('POST', path, body, cb) end
function RSBridge.get(path, cb) request('GET', path, nil, cb) end

--- Identifiants d'un joueur, sans l'IP (jamais envoyée au bot).
local function identifiersOf(src)
  local out = {}
  for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
    if id:sub(1, 3) ~= 'ip:' then out[#out + 1] = id end
  end
  return out
end
RSBridge.identifiersOf = identifiersOf

local function findIdentifier(ids, prefix)
  for _, id in ipairs(ids) do
    if id:sub(1, #prefix + 1) == prefix .. ':' then return id end
  end
  return nil
end

local function licenseOf(ids)
  return findIdentifier(ids, 'license') or findIdentifier(ids, 'license2')
end
RSBridge.licenseOf = licenseOf

local function discordOf(ids)
  local d = findIdentifier(ids, 'discord')
  return d and d:sub(9) or nil
end
RSBridge.discordOf = discordOf

local function playerName(src)
  return customNames[tonumber(src)] or GetPlayerName(src) or ('#' .. tostring(src))
end

local function notify(src, text)
  if Config.Framework == 'esx' then
    TriggerClientEvent('esx:showNotification', src, text)
  elseif Config.Framework == 'qbcore' then
    TriggerClientEvent('QBCore:Notify', src, text, 'primary', 8000)
  end
  TriggerClientEvent('chat:addMessage', src, { color = { 124, 58, 237 }, args = { 'Redemption', text } })
end
RSBridge.notify = notify

--- Date ISO 8601 UTC ('2026-01-01T12:00:00.000Z') → timestamp Unix.
local function isoToEpoch(iso)
  if type(iso) ~= 'string' then return nil end
  local y, mo, d, h, mi, s = iso:match('^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)')
  if not y then return nil end
  local asLocal = os.time({ year = tonumber(y), month = tonumber(mo), day = tonumber(d), hour = tonumber(h), min = tonumber(mi), sec = tonumber(s), isdst = false })
  local now = os.time()
  local offset = os.difftime(now, os.time(os.date('!*t', now)))
  return math.floor(asLocal + offset)
end

-- ───────────────────────── Bans locaux (KVP, secours si le bot est injoignable) ─────────────────────────

local LocalBans = {}

local function banKey(identifier) return 'rsban:' .. identifier end

--- Enregistre un ban local sur chaque identifiant. expires = timestamp Unix ou nil (permanent).
--- La liste complète des identifiants est conservée dans le ban : une levée par un seul identifiant
--- (unban Discord : discord + licence, UnbanPlayer('license:…')) lève aussi steam:, license2:, xbl:…
function LocalBans.add(ids, reason, expires, staff)
  local list = {}
  for _, id in ipairs(ids) do
    if type(id) == 'string' and id ~= '' then list[#list + 1] = id end
  end
  local value = json.encode({ reason = reason or '', expires = expires, staff = staff or '', at = os.time(), ids = list })
  for _, id in ipairs(list) do SetResourceKvp(banKey(id), value) end
end

--- Lève les bans de ces identifiants et de tous les identifiants enregistrés avec eux.
function LocalBans.remove(ids)
  local all = {}
  for _, id in ipairs(ids) do
    if type(id) == 'string' and id ~= '' then
      all[id] = true
      local raw = GetResourceKvpString(banKey(id))
      if raw then
        local ok, ban = pcall(json.decode, raw)
        if ok and type(ban) == 'table' and type(ban.ids) == 'table' then
          for _, other in ipairs(ban.ids) do
            if type(other) == 'string' and other ~= '' then all[other] = true end
          end
        end
      end
    end
  end
  for id in pairs(all) do DeleteResourceKvp(banKey(id)) end
end

--- Premier ban local actif parmi les identifiants (les bans expirés sont purgés).
function LocalBans.find(ids)
  for _, id in ipairs(ids) do
    local raw = GetResourceKvpString(banKey(id))
    if raw then
      local ok, ban = pcall(json.decode, raw)
      if ok and type(ban) == 'table' then
        if ban.expires and ban.expires <= os.time() then
          DeleteResourceKvp(banKey(id))
        else
          return ban
        end
      end
    end
  end
  return nil
end
RSBridge.LocalBans = LocalBans

local function banMessage(reason, expires)
  reason = str(reason) or msg('no_reason')
  if expires then return msg('banned_until', os.date('!%d/%m/%Y %H:%M', expires), reason) end
  return msg('banned', reason)
end

-- ───────────────────────── Connexion (deferrals) ─────────────────────────

AddEventHandler('playerConnecting', function(name, _setKickReason, deferrals)
  local src = source
  local ids = identifiersOf(src)
  deferrals.defer()
  Wait(0)
  deferrals.update(msg('checking'))

  local localBan = LocalBans.find(ids)
  if localBan then
    deferrals.done(banMessage(localBan.reason, localBan.expires))
    return
  end

  if not Config.CheckOnConnect then
    deferrals.done()
    return
  end

  RSBridge.post('/check', { identifiers = ids, name = name }, function(status, data)
    if status == 200 and type(data) == 'table' then
      if data.allowed then
        -- Groupes ACE posés dès la connexion (par identifiant) : disponibles avant même le spawn.
        RSBridge.applyGroups({ ids = ids, discordId = str(data.discordId) }, data.groups, data.group, data.managedGroups)
        deferrals.done()
      elseif Config.UseBotMessages and str(data.message) then
        deferrals.done(data.message)
      elseif data.reason == 'banned' then
        deferrals.done(banMessage(data.banReason, isoToEpoch(data.banExpiresAt)))
      else
        deferrals.done(msg(str(data.reason) or 'bot_unreachable'))
      end
    elseif Config.FailOpen then
      debug('Bot injoignable (%d) : connexion autorisée (FailOpen)', status)
      deferrals.done()
    else
      deferrals.done(msg('bot_unreachable'))
    end
  end)
end)

-- ───────────────────────── Arrivée / départ ─────────────────────────

local function sendJoin(src)
  local ids = identifiersOf(src)
  RSBridge.post('/players/join', { id = tonumber(src), name = playerName(src), identifiers = ids, ping = GetPlayerPing(src) }, function(status, data)
    if status ~= 200 or type(data) ~= 'table' then return end
    -- Groupes ACE + événement rs_bridge:groupsChanged pour le gamemode
    RSBridge.applyGroups({ src = tonumber(src), ids = ids, discordId = str(data.discordId) }, data.groups, data.group, data.managedGroups)
    if not data.linked and Config.NotifyUnlinked then
      SetTimeout(15000, function()
        if GetPlayerName(src) then notify(src, msg('unlinked')) end
      end)
    end
  end)
end

AddEventHandler('playerJoining', function()
  sendJoin(source)
end)

AddEventHandler('playerDropped', function(reason)
  local src = source
  local ids = identifiersOf(src)
  RSBridge.post('/players/leave', { id = tonumber(src), name = playerName(src), identifiers = ids, reason = tostring(reason or ''):sub(1, 250) })
  customNames[tonumber(src)] = nil
  RSBridge.clearGroups(tonumber(src))
end)

--- Pseudo du compte en jeu → surnom Discord. À appeler par le gamemode à la CRÉATION du compte (premier choix du pseudo)
--- puis à chaque changement de pseudo. Le bot le retient : il est réappliqué à chaque connexion, à la place du nom FiveM.
--- exports.rs_bridge:SetPlayerName(source, 'MonPseudo')  → true si envoyé
local function setPlayerName(src, name)
  src = tonumber(src)
  if not src or type(name) ~= 'string' or name == '' or not GetPlayerName(src) then return false end
  customNames[src] = name:sub(1, 128)
  RSBridge.post('/players/name', { id = src, name = customNames[src], identifiers = identifiersOf(src) }, function(status, data)
    if status == 200 and type(data) == 'table' then
      debug('Pseudo %s → surnom Discord : %s', customNames[src] or name, str(data.nickname) or 'inchangé (compte non lié, option désactivée ou hiérarchie)')
    end
  end)
  return true
end
exports('SetPlayerName', setPlayerName)

-- Pseudo du personnage ESX / QBCore (Config.NameSource = 'character')
if Config.NameSource == 'character' then
  AddEventHandler('esx:playerLoaded', function(playerId, xPlayer)
    if xPlayer and xPlayer.getName then setPlayerName(playerId, xPlayer.getName()) end
  end)
  AddEventHandler('QBCore:Server:PlayerLoaded', function(Player)
    local data = Player and Player.PlayerData
    local info = data and data.charinfo
    if info and data.source then setPlayerName(data.source, ('%s %s'):format(info.firstname or '', info.lastname or '')) end
  end)
end

-- ───────────────────────── Statut (heartbeat) ─────────────────────────

local function buildStatus()
  local list = {}
  for _, s in ipairs(GetPlayers()) do
    local src = tonumber(s)
    list[#list + 1] = { id = src, name = playerName(src), identifiers = identifiersOf(src), ping = GetPlayerPing(src) }
  end
  local status = {
    online = true,
    players = #list,
    maxPlayers = GetConvarInt('sv_maxclients', 32),
    version = GetConvar('version', ''),
  }
  -- Maintenance envoyée seulement si la convar est définie (sinon le bouton Maintenance de /config module:fivem fait foi).
  local maintenance = GetConvar(Config.MaintenanceConvar, '')
  if maintenance ~= '' then status.maintenance = (maintenance == 'true') end
  -- Tableau vide omis : le bot applique sa valeur par défaut (évite l'ambiguïté {} / [] en JSON).
  if #list > 0 then status.playerList = list end
  return status
end

CreateThread(function()
  Wait(2000)
  if apiKey == '' then warn('Aucune clé API : définissez Config.ApiKey ou `set rs_bridge_api_key "…"` dans server.cfg.') end
  RSBridge.post('/status', buildStatus(), function(status)
    if status == 200 then
      print(('^2[%s]^7 Connecté au bot (%s / %s).'):format(resourceName, guildId, serverKey))
    elseif status == 401 then
      warn('Clé API refusée (401) : vérifiez rs_bridge_api_key (server.cfg) / Config.ApiKey.')
    elseif status == 404 then
      warn('Serveur inconnu (404) : vérifiez rs_bridge_guild et rs_bridge_server_key (/config module:fivem sur Discord).')
    else
      warn('Bot injoignable (%d) : vérifiez rs_bridge_url (%s).', status, botUrl)
    end
  end)
  -- Joueurs déjà présents (restart de la ressource)
  for _, s in ipairs(GetPlayers()) do sendJoin(tonumber(s)) end
  while true do
    Wait((Config.StatusInterval or 30) * 1000)
    RSBridge.post('/status', buildStatus())
  end
end)

-- ───────────────────────── Actions venant de Discord ─────────────────────────

--- Joueurs connectés correspondant à une action (discordId, licence ou identifiants).
local function matchPlayers(action)
  local wanted = {}
  if str(action.discordId) then wanted['discord:' .. action.discordId] = true end
  if str(action.license) then wanted[action.license] = true end
  for _, id in ipairs(type(action.identifiers) == 'table' and action.identifiers or {}) do
    if str(id) then wanted[id] = true end
  end
  local out = {}
  for _, s in ipairs(GetPlayers()) do
    for _, id in ipairs(GetPlayerIdentifiers(s) or {}) do
      if wanted[id] then
        out[#out + 1] = tonumber(s)
        break
      end
    end
  end
  return out
end

local function actionIdentifiers(action)
  local ids = {}
  if str(action.discordId) then ids[#ids + 1] = 'discord:' .. action.discordId end
  if str(action.license) then ids[#ids + 1] = action.license end
  for _, id in ipairs(type(action.identifiers) == 'table' and action.identifiers or {}) do
    if str(id) then ids[#ids + 1] = id end
  end
  return ids
end

local handlers = {}

function handlers.BAN(action)
  local expires = isoToEpoch(action.expiresAt)
  LocalBans.add(actionIdentifiers(action), str(action.reason), expires, str(action.staff))
  for _, src in ipairs(matchPlayers(action)) do
    DropPlayer(tostring(src), banMessage(action.reason, expires))
  end
end

function handlers.UNBAN(action)
  LocalBans.remove(actionIdentifiers(action))
end

function handlers.KICK(action)
  for _, src in ipairs(matchPlayers(action)) do
    DropPlayer(tostring(src), msg('kicked', str(action.reason) or msg('no_reason')))
  end
end

--- Rôles Discord → groupes en jeu : principals ACE (discord: + licences) et, si le joueur est connecté, événement + exports.
function handlers.SET_GROUPS(action)
  local ids = actionIdentifiers(action)
  RSBridge.applyGroups({ ids = ids, discordId = str(action.discordId) }, action.groups, action.group, action.managedGroups)
  for _, src in ipairs(matchPlayers(action)) do
    RSBridge.applyGroups({ src = src, ids = identifiersOf(src), discordId = str(action.discordId) }, action.groups, action.group, action.managedGroups)
  end
end

function handlers.MESSAGE(action)
  local text = str(action.message) or str(action.reason)
  if not text then return end
  local targets = (str(action.discordId) or str(action.license)) and matchPlayers(action) or nil
  if targets then
    for _, src in ipairs(targets) do notify(src, text) end
  else
    TriggerClientEvent('chat:addMessage', -1, { color = { 124, 58, 237 }, args = { 'Discord', text } })
  end
end

local function applyAction(action)
  local handler = handlers[action.type]
  if not handler then return end
  local ok, err = pcall(handler, action)
  if not ok then warn('Action %s en erreur : %s', tostring(action.type), err) end
  -- Pour brancher votre propre système (ban framework, logs…) : AddEventHandler('rs_bridge:action', function(action) … end)
  TriggerEvent('rs_bridge:action', action)
  debug('Action %s appliquée (%s)', action.type, str(action.discordId) or str(action.license) or '?')
end

CreateThread(function()
  Wait(5000)
  while true do
    RSBridge.get('/actions', function(status, data)
      if status == 200 and type(data) == 'table' and type(data.actions) == 'table' then
        for _, action in ipairs(data.actions) do applyAction(action) end
      end
    end)
    Wait((Config.ActionsInterval or 10) * 1000)
  end
end)

-- ───────────────────────── Exports de sanction (à appeler depuis votre menu admin) ─────────────────────────

--- syncDiscord : true / false = appliquer (ou non) aussi sur Discord ; nil = réglage « Ban en jeu → Discord » du serveur.
local function sendSanction(kind, ids, reason, duration, staff, discordId, syncDiscord)
  local body = {
    type = kind,
    reason = (reason and reason ~= '') and tostring(reason):sub(1, 1000) or msg('no_reason'),
    staff = (staff and staff ~= '') and tostring(staff):sub(1, 128) or 'Console',
    identifiers = ids,
    identifier = licenseOf(ids) or ids[1],
  }
  if discordId then body.discordId = discordId end
  if duration and tonumber(duration) and tonumber(duration) > 0 then body.duration = math.floor(tonumber(duration)) end
  if syncDiscord ~= nil then body.syncDiscord = (syncDiscord == true) end
  RSBridge.post('/sanctions', body)
end

--- Bannit un joueur connecté : ban local immédiat + relai au bot (ban Discord si syncBansToDiscord).
--- exports.rs_bridge:BanPlayer(source, 'Cheat', 86400, 'Admin Bob')   -- durationSeconds nil/0 = permanent
local function banPlayer(src, reason, durationSeconds, staffName)
  local ids = identifiersOf(src)
  if #ids == 0 then return false end
  local expires = (tonumber(durationSeconds) or 0) > 0 and (os.time() + math.floor(tonumber(durationSeconds))) or nil
  LocalBans.add(ids, reason, expires, staffName)
  sendSanction('BAN', ids, reason, durationSeconds, staffName, discordOf(ids))
  DropPlayer(tostring(src), banMessage(reason, expires))
  return true
end
exports('BanPlayer', banPlayer)

--- Bannit un identifiant hors ligne (license:…, discord:…, steam:…).
local function banIdentifier(identifier, reason, durationSeconds, staffName)
  if type(identifier) ~= 'string' or not identifier:find(':') then return false end
  local ids = { identifier }
  local expires = (tonumber(durationSeconds) or 0) > 0 and (os.time() + math.floor(tonumber(durationSeconds))) or nil
  LocalBans.add(ids, reason, expires, staffName)
  sendSanction('BAN', ids, reason, durationSeconds, staffName, discordOf(ids))
  return true
end
exports('BanIdentifier', banIdentifier)

--- Lève un ban (local + Discord si syncBansToDiscord). identifier = license:… / discord:… / steam:…
local function unbanPlayer(identifier, staffName, reason)
  if type(identifier) ~= 'string' or not identifier:find(':') then return false end
  local ids = { identifier }
  LocalBans.remove(ids)
  sendSanction('UNBAN', ids, reason or 'Unban', nil, staffName, discordOf(ids))
  return true
end
exports('UnbanPlayer', unbanPlayer)

--- Ban avec choix Discord explicite (menu admin du gamemode) :
--- exports.rs_bridge:Ban(source, 'Cheat', 86400, true, 'Admin Bob')
---   durationSec nil / 0 = permanent ; alsoDiscord true = bannir aussi du Discord, false = jeu seulement,
---   nil = réglage « Ban en jeu → Discord » du serveur (/config module:fivem). `source` peut aussi être un identifiant
---   (license:…, discord:…) pour un joueur hors ligne.
local function ban(target, reason, durationSec, alsoDiscord, staffName)
  local ids
  if type(target) == 'string' and target:find(':') then
    ids = { target }
  else
    ids = identifiersOf(target)
  end
  if #ids == 0 then return false end
  local expires = (tonumber(durationSec) or 0) > 0 and (os.time() + math.floor(tonumber(durationSec))) or nil
  LocalBans.add(ids, reason, expires, staffName)
  sendSanction('BAN', ids, reason, durationSec, staffName, discordOf(ids), alsoDiscord)
  if type(target) ~= 'string' and GetPlayerName(target) then DropPlayer(tostring(target), banMessage(reason, expires)) end
  return true
end
exports('Ban', ban)

--- Débannissement avec choix Discord explicite : exports.rs_bridge:Unban('license:…', 'Erreur', true, 'Admin Bob')
local function unban(identifier, reason, alsoDiscord, staffName)
  if type(identifier) ~= 'string' or not identifier:find(':') then return false end
  local ids = { identifier }
  LocalBans.remove(ids)
  sendSanction('UNBAN', ids, reason or 'Unban', nil, staffName, discordOf(ids), alsoDiscord)
  return true
end
exports('Unban', unban)

--- Expulse un joueur (kick Discord seulement si syncKicks est activé côté bot).
local function kickPlayer(src, reason, staffName)
  local ids = identifiersOf(src)
  if #ids == 0 then return false end
  sendSanction('KICK', ids, reason, nil, staffName, discordOf(ids))
  DropPlayer(tostring(src), msg('kicked', reason or msg('no_reason')))
  return true
end
exports('KickPlayer', kickPlayer)

--- Avertit un joueur (avertissement Discord si le membre est sur le serveur Discord).
local function warnPlayer(src, reason, staffName)
  local ids = identifiersOf(src)
  if #ids == 0 then return false end
  sendSanction('WARN', ids, reason, nil, staffName, discordOf(ids))
  notify(src, msg('warned', reason or msg('no_reason')))
  return true
end
exports('WarnPlayer', warnPlayer)

-- ───────────────────────── Relai txAdmin (optionnel) ─────────────────────────
-- txAdmin applique déjà la sanction en jeu : on la relaie seulement au bot (pas de DropPlayer ici).

local function txIds(data)
  local ids = {}
  for _, id in ipairs(data.targetIds or data.playerIds or {}) do
    if type(id) == 'string' and id:sub(1, 3) ~= 'ip:' then ids[#ids + 1] = id end
  end
  if #ids == 0 and data.targetNetId then ids = identifiersOf(data.targetNetId) end
  return ids
end

if Config.TxAdminHooks then
  AddEventHandler('txAdmin:events:playerBanned', function(data)
    local ids = txIds(data or {})
    if #ids == 0 then return end
    local duration = nil
    if type(data.expiration) == 'number' and data.expiration > os.time() then duration = data.expiration - os.time() end
    LocalBans.add(ids, data.reason, duration and (os.time() + duration) or nil, data.author)
    sendSanction('BAN', ids, data.reason, duration, data.author, discordOf(ids))
  end)

  AddEventHandler('txAdmin:events:playerWarned', function(data)
    local ids = txIds(data or {})
    if #ids > 0 then sendSanction('WARN', ids, data.reason, nil, data.author, discordOf(ids)) end
  end)

  AddEventHandler('txAdmin:events:playerKicked', function(data)
    if not data or not data.target then return end
    local ids = identifiersOf(data.target)
    if #ids > 0 then sendSanction('KICK', ids, data.reason, nil, data.author, discordOf(ids)) end
  end)

  AddEventHandler('txAdmin:events:actionRevoked', function(data)
    if not data or data.actionType ~= 'ban' then return end
    local ids = txIds(data)
    if #ids == 0 then return end
    LocalBans.remove(ids)
    sendSanction('UNBAN', ids, 'txAdmin: ' .. tostring(data.actionId or ''), nil, data.revokedBy, discordOf(ids))
  end)
end

-- ───────────────────────── Console ─────────────────────────

RegisterCommand('rsbridge', function(src, args)
  if src ~= 0 then return end
  local sub = args[1]
  if sub == 'unban' and args[2] then
    unbanPlayer(args[2], 'Console')
    print(('[%s] Unban envoyé pour %s'):format(resourceName, args[2]))
  elseif sub == 'groups' and args[2] then
    local target = tonumber(args[2])
    local list = target and RSBridge.getGroups(target) or {}
    print(('[%s] Groupes de %s : %s'):format(resourceName, args[2], #list > 0 and table.concat(list, ', ') or 'aucun'))
  else
    print(('[%s] URL=%s  serveur Discord=%s  clé du serveur=%s  clé API=%s'):format(resourceName, botUrl, guildId, serverKey, apiKey ~= '' and 'définie' or 'MANQUANTE'))
    RSBridge.get('/status', function(status, data)
      print(('[%s] %s → HTTP %d'):format(resourceName, baseUrl, status))
      if data and data.status then print(('  en ligne=%s joueurs=%s/%s'):format(tostring(data.status.online), tostring(data.status.players), tostring(data.status.maxPlayers))) end
      if status == 200 then print(('^2[%s]^7 Liaison OK.'):format(resourceName))
      elseif status == 401 then warn('Clé API refusée (401).')
      elseif status == 404 then warn('Serveur inconnu (404) : rs_bridge_guild / rs_bridge_server_key.')
      else warn('Bot injoignable (%d).', status) end
    end)
  end
end, true)
