--[[
  rs_bridge — logs en jeu (→ POST /logs) pour le serveur de logs Discord (/template logs)

  File d'attente en mémoire, envoyée par lots (Config.Logs.BatchSize entrées, toutes les Config.Logs.FlushInterval secondes,
  ou dès qu'un lot est plein). Bot injoignable / surchargé (0, 429, 5xx) : le lot est remis en tête de file et renvoyé plus
  tard (attente croissante, 60 s max). File pleine (Config.Logs.MaxQueue) : les entrées les plus anciennes sont abandonnées.

  Export pour le gamemode :
    exports.rs_bridge:Log(type, data)   → true si mis en file
      type : connect, disconnect, account, kill, death, match_start, match_end, ban, kick, warn, unban, admin, chat,
             anticheat, server, custom (data.channel = connections | accounts | kills | matches | sanctions | admin | chat
             | anticheat | server)
      Les champs joueur (player, killer, victim, target, staff, winner, admin) acceptent un ID serveur : il est remplacé par
      { id, name, identifiers } (sans IP). Le bot n'affiche que la licence (raccourcie) et le compte Discord lié.

  Hooks automatiques (chacun désactivable dans config.lua → Config.Logs) :
    playerJoining / playerDropped (raison, durée de session) · connexions refusées (main.lua) · groupes en jeu
    (rs_bridge:groupsChanged) · chat (Config.Logs.Chat) · baseevents:onPlayerKilled / onPlayerDied (si baseevents tourne)
    · txAdmin (annonces, redémarrage programmé, arrêt, heal ; bans / kicks / warns / révocations si Config.TxAdminHooks = false,
    sinon ils passent par POST /sanctions et le bot écrit lui-même le log) · démarrage / arrêt des ressources.
]]

local L = Config.Logs or {}
local enabled = L.Enabled ~= false and GetConvar('rs_bridge_logs', '') ~= 'false'
local resourceName = GetCurrentResourceName()

local TYPES = {
  connect = true, disconnect = true, account = true, kill = true, death = true, match_start = true, match_end = true,
  ban = true, kick = true, warn = true, unban = true, admin = true, chat = true, anticheat = true, server = true, custom = true,
}
local PLAYER_FIELDS = { player = true, killer = true, victim = true, target = true, staff = true, winner = true, admin = true }

local BATCH = math.max(1, math.min(50, math.floor(tonumber(L.BatchSize) or 25)))
local MAX_QUEUE = math.max(BATCH, math.floor(tonumber(L.MaxQueue) or 500))
local INTERVAL = math.max(1, tonumber(L.FlushInterval) or 5)

local queue = {}
local inflight = nil
local failures = 0
local retryAt = 0
local dropped = 0
local startedAt = os.time()
local joinedAt = {}
local lastGroups = {}

local function typeEnabled(kind)
  if not enabled or not TYPES[kind] then return false end
  return type(L.Types) ~= 'table' or L.Types[kind] ~= false
end

--- Joueur connecté → { id, name, identifiers } (identifiants sans IP), nil s'il n'existe pas.
local function playerInfo(src)
  src = tonumber(src)
  if not src or src <= 0 then return nil end
  local name = GetPlayerName(src)
  if not name then return { id = src } end
  return { id = src, name = name, identifiers = RSBridge.identifiersOf(src) }
end
RSBridge.playerInfo = playerInfo

--- Copie bornée pour le JSON : 4 niveaux, 40 clés, chaînes de 1000 caractères, ni fonction ni userdata.
local function sanitize(value, depth)
  local kind = type(value)
  if kind == 'string' then return value:sub(1, 1000) end
  if kind == 'number' then
    if value ~= value or value == math.huge or value == -math.huge then return nil end
    return value
  end
  if kind == 'boolean' then return value end
  if kind == 'vector3' or kind == 'vector4' or kind == 'vector2' then return { x = value.x, y = value.y, z = value.z } end
  if kind ~= 'table' or depth >= 4 then return nil end
  local out, count = {}, 0
  for k, v in pairs(value) do
    if count >= 40 then break end
    local key = type(k) == 'number' and k or (type(k) == 'string' and k:sub(1, 64)) or nil
    if key ~= nil then
      local clean = sanitize(v, depth + 1)
      if clean ~= nil then
        out[key] = clean
        count = count + 1
      end
    end
  end
  return out
end

--- Champs joueur donnés par ID serveur → { id, name, identifiers } ; `top = { { source = 3, kills = 5 } }` → nom.
local function expandPlayers(data)
  for field in pairs(PLAYER_FIELDS) do
    if type(data[field]) == 'number' then data[field] = playerInfo(data[field]) end
  end
  if type(data.top) == 'table' then
    for _, row in ipairs(data.top) do
      if type(row) == 'table' and tonumber(row.source) then
        row.name = row.name or GetPlayerName(tonumber(row.source))
        row.source = nil
      end
    end
  end
  return data
end

--- Entrée envoyée au bot.
local function entryRow(e)
  return { type = e.type, ts = e.ts, data = e.data }
end

--- Envoie un lot (un seul envoi à la fois).
local function flush()
  if inflight or #queue == 0 or GetGameTimer() < retryAt then return end
  inflight = {}
  for _ = 1, math.min(BATCH, #queue) do inflight[#inflight + 1] = table.remove(queue, 1) end
  local batch = {}
  for _, e in ipairs(inflight) do batch[#batch + 1] = entryRow(e) end
  RSBridge.post('/logs', batch, function(status)
    local sent = inflight or {}
    inflight = nil
    if status >= 200 and status < 300 then
      failures = 0
      if dropped > 0 then
        RSBridge.warn('Logs en jeu : %d entrée(s) abandonnée(s) pendant que le bot était injoignable (file pleine).', dropped)
        dropped = 0
      end
    elseif status == 0 or status == 429 or status >= 500 then
      -- Bot injoignable ou surchargé : le lot repasse en tête de file
      for i = #sent, 1, -1 do table.insert(queue, 1, sent[i]) end
      while #queue > MAX_QUEUE do
        table.remove(queue, 1)
        dropped = dropped + 1
      end
      failures = failures + 1
      retryAt = GetGameTimer() + math.min(60000, 2000 * 2 ^ math.min(failures, 5))
    else
      -- Lot refusé (400 : données invalides, 401 / 404 : réglages) : abandonné pour ne pas bloquer la file
      RSBridge.warn('Logs en jeu refusés par le bot (HTTP %d) : %d entrée(s) abandonnée(s).', status, #sent)
    end
  end)
end
RSBridge.flushLogs = flush

--- Met une entrée en file. Retourne true si acceptée.
local function push(kind, data)
  if not typeEnabled(kind) then return false end
  local clean = sanitize(expandPlayers(type(data) == 'table' and data or {}), 0) or {}
  if #queue >= MAX_QUEUE then
    table.remove(queue, 1)
    dropped = dropped + 1
  end
  queue[#queue + 1] = { type = kind, ts = os.time(), data = clean }
  if #queue >= BATCH then flush() end
  return true
end
RSBridge.log = push

--- exports.rs_bridge:Log('kill', { killer = killerSrc, victim = victimSrc, weapon = 'WEAPON_PISTOL', distance = 23.4 })
exports('Log', function(kind, data)
  if type(kind) ~= 'string' or not TYPES[kind] then
    RSBridge.warn('exports.rs_bridge:Log : type inconnu « %s »', tostring(kind))
    return false
  end
  return push(kind, data)
end)

CreateThread(function()
  while true do
    Wait(INTERVAL * 1000)
    flush()
  end
end)

if not enabled then return end

-- ───────────── Connexions ─────────────

AddEventHandler('playerJoining', function()
  local src = tonumber(source)
  joinedAt[src] = os.time()
  push('connect', playerInfo(src))
end)

AddEventHandler('playerDropped', function(reason)
  local src = tonumber(source)
  local info = playerInfo(src) or { id = src }
  info.reason = tostring(reason or ''):sub(1, 250)
  if joinedAt[src] then info.duration = os.time() - joinedAt[src] end
  joinedAt[src] = nil
  lastGroups[src] = nil
  push('disconnect', info)
end)

-- ───────────── Groupes en jeu (rôles Discord) ─────────────

AddEventHandler('rs_bridge:groupsChanged', function(src, groups, primary)
  src = tonumber(src)
  if not src then return end
  local list = type(groups) == 'table' and groups or {}
  local had = lastGroups[src]
  lastGroups[src] = #list
  -- Joueur sans groupe qui n'en avait pas : rien à signaler
  if #list == 0 and (not had or had == 0) then return end
  push('admin', { action = 'groups', target = src, groups = list, details = primary and ('principal : ' .. tostring(primary)) or nil, origin = 'discord' })
end)

-- ───────────── Chat (désactivé par défaut) ─────────────

if L.Chat then
  AddEventHandler('chatMessage', function(src, author, message)
    local info = playerInfo(src) or { id = tonumber(src), name = author }
    info.message = tostring(message or ''):sub(1, 500)
    push('chat', info)
  end)
end

-- ───────────── Kills / morts (ressource baseevents) ─────────────

if L.BaseEvents ~= false then
  RegisterNetEvent('baseevents:onPlayerKilled', function(killerId, data)
    local victim = tonumber(source)
    if GetResourceState('baseevents') ~= 'started' then return end
    data = type(data) == 'table' and data or {}
    local entry = { killer = playerInfo(killerId), victim = playerInfo(victim), weapon = data.weaponhash }
    local kp = data.killerpos
    if type(kp) == 'table' and tonumber(kp[1]) then
      local ok, dist = pcall(function()
        local v = GetEntityCoords(GetPlayerPed(victim))
        return #(vector3(kp[1], kp[2], kp[3]) - v)
      end)
      if ok and dist then entry.distance = math.floor(dist * 10 + 0.5) / 10 end
    end
    push('kill', entry)
  end)

  RegisterNetEvent('baseevents:onPlayerDied', function(killerType)
    if GetResourceState('baseevents') ~= 'started' then return end
    push('death', { victim = playerInfo(source), cause = tostring(killerType or '') })
  end)
end

-- ───────────── txAdmin ─────────────

local function txTarget(d)
  if tonumber(d.targetNetId) and GetPlayerName(tonumber(d.targetNetId)) then return playerInfo(d.targetNetId) end
  local ids = {}
  for _, id in ipairs(d.targetIds or d.playerIds or {}) do
    if type(id) == 'string' and id:sub(1, 3) ~= 'ip:' then ids[#ids + 1] = id end
  end
  return { name = d.targetName or d.playerName, identifiers = ids }
end

if L.TxAdmin ~= false then
  -- Avec Config.TxAdminHooks, main.lua relaie déjà bans / avertissements / kicks / révocations de ban (POST /sanctions)
  if not Config.TxAdminHooks then
    AddEventHandler('txAdmin:events:playerBanned', function(d)
      d = d or {}
      local duration = (type(d.expiration) == 'number' and d.expiration > os.time()) and (d.expiration - os.time()) or nil
      push('ban', { target = txTarget(d), staff = d.author, reason = d.reason, duration = duration, origin = 'txAdmin' })
    end)
    AddEventHandler('txAdmin:events:playerWarned', function(d)
      d = d or {}
      push('warn', { target = txTarget(d), staff = d.author, reason = d.reason, origin = 'txAdmin' })
    end)
    AddEventHandler('txAdmin:events:playerKicked', function(d)
      d = d or {}
      push('kick', { target = playerInfo(d.target), staff = d.author, reason = d.reason, origin = 'txAdmin' })
    end)
  end

  AddEventHandler('txAdmin:events:actionRevoked', function(d)
    d = d or {}
    if d.actionType == 'ban' and Config.TxAdminHooks then return end
    if d.actionType == 'ban' then
      push('unban', { target = txTarget(d), staff = d.revokedBy, reason = d.actionReason, origin = 'txAdmin' })
    else
      push('admin', { action = 'revoke ' .. tostring(d.actionType or ''), staff = d.revokedBy, target = txTarget(d), details = d.actionReason, origin = 'txAdmin' })
    end
  end)

  AddEventHandler('txAdmin:events:playerHealed', function(d)
    d = d or {}
    local everyone = tonumber(d.target) == -1
    push('admin', { action = 'heal', staff = d.author, target = not everyone and playerInfo(d.target) or nil, details = everyone and 'tous les joueurs' or nil, origin = 'txAdmin' })
  end)

  AddEventHandler('txAdmin:events:announcement', function(d)
    d = d or {}
    push('server', { event = 'announcement', author = d.author, message = d.message })
  end)

  AddEventHandler('txAdmin:events:scheduledRestart', function(d)
    d = d or {}
    push('server', { event = 'restart_scheduled', secondsRemaining = d.secondsRemaining, message = d.translatedMessage })
  end)

  AddEventHandler('txAdmin:events:serverShuttingDown', function(d)
    d = d or {}
    push('server', { event = 'shutdown', author = d.author, message = d.message, seconds = tonumber(d.delay) and math.floor(d.delay / 1000) or nil })
    flush()
  end)
end

-- ───────────── Ressources ─────────────

AddEventHandler('onResourceStart', function(name)
  if name == resourceName then
    push('server', { event = 'start' })
  elseif L.Resources ~= false and os.time() - startedAt > 30 then
    -- Démarrage du serveur : les dizaines de ressources lancées au boot ne sont pas journalisées une par une
    push('server', { event = 'resource_start', resource = name })
  end
end)

AddEventHandler('onResourceStop', function(name)
  if name == resourceName then
    push('server', { event = 'stop' })
    flush()
  elseif L.Resources ~= false then
    push('server', { event = 'resource_stop', resource = name })
  end
end)
