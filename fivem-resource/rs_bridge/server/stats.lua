--[[
  rs_bridge — statistiques Battle Royale (→ POST /stats)

  Deux façons d'envoyer les stats (choisissez-en UNE par statistique, sinon elle est comptée deux fois) :

  1. En direct, pendant la partie (cumulé puis envoyé en un lot toutes les Config.StatsFlushInterval secondes) :
       exports.rs_bridge:AddStats(killerSource, { kills = 1, damage = 120 })
       exports.rs_bridge:AddStats(victimSource, { deaths = 1 })
     puis à la fin de la partie, seulement ce qui n'a pas été envoyé en direct :
       exports.rs_bridge:AddMatchStats(source, { win = true, top10 = true, xp = 350 })

  2. En une fois, à la fin de la partie (totaux de la partie) :
       exports.rs_bridge:AddMatchStats(source, { kills = 5, deaths = 1, win = true, damage = 1540, top10 = true, xp = 350 })
     ou pour tous les joueurs en une requête :
       exports.rs_bridge:AddMatchStatsBatch({ { source = 1, kills = 5, win = true }, { source = 2, kills = 0, deaths = 1 } })

  AddMatchStats compte une partie jouée (matches + 1) ; AddStats non (sauf `matches = 1` explicite).
  exports.rs_bridge:FlushStats() envoie immédiatement les stats en direct en attente (ex. juste avant un redémarrage).

  Le temps de jeu n'est PAS envoyé ici : le bot le calcule lui-même à partir des connexions / déconnexions.
  Si le joueur n'a pas de compte Discord lié, le bot répond 202 `unlinked` et le joueur est prévenu en jeu (10 min max).
  Le message de classement Discord (/config module:battleroyale → 📺 Affichage) se met à jour tout seul (≤ 1 fois / min).
]]

local LIVE_FIELDS = { 'wins', 'kills', 'deaths', 'matches', 'damage', 'top10', 'xp' }

local function toInt(v)
  if v == true then return 1 end
  local n = tonumber(v)
  if not n or n < 0 then return 0 end
  return math.floor(n)
end

local lastUnlinkedNotice = {}

local function notifyUnlinked(data)
  if type(data) ~= 'table' or type(data.unlinkedIdentifiers) ~= 'table' then return end
  local unlinked = {}
  for _, lic in ipairs(data.unlinkedIdentifiers) do unlinked[lic] = true end
  local now = os.time()
  for _, s in ipairs(GetPlayers()) do
    local lic = RSBridge.licenseOf(RSBridge.identifiersOf(s))
    if lic and unlinked[lic] and now - (lastUnlinkedNotice[lic] or 0) >= 600 then
      lastUnlinkedNotice[lic] = now
      RSBridge.notify(tonumber(s), RSBridge.msg('stats_unlinked'))
    end
  end
end

-- ───────────── Fin de partie ─────────────

--- Construit la ligne de stats normalisée d'un joueur pour une partie terminée (nil si aucune licence).
local function buildRow(src, stats)
  local ids = RSBridge.identifiersOf(src)
  local license = RSBridge.licenseOf(ids)
  if not license then return nil end
  stats = type(stats) == 'table' and stats or {}
  return {
    identifier = license,
    mode = 'increment',
    matches = 1,
    wins = (stats.win == true or toInt(stats.win) > 0 or toInt(stats.wins) > 0) and 1 or 0,
    kills = toInt(stats.kills),
    deaths = toInt(stats.deaths),
    damage = toInt(stats.damage),
    top10 = (stats.top10 == true or toInt(stats.top10) > 0) and 1 or 0,
    xp = toInt(stats.xp),
    season = tonumber(stats.season) and math.floor(tonumber(stats.season)) or nil,
  }
end

--- Envoie les stats d'un joueur pour une partie terminée. Retourne false si le joueur n'a pas de licence.
local function addMatchStats(src, stats)
  local row = buildRow(src, stats)
  if not row then return false end
  RSBridge.post('/stats', row, function(status, data)
    if status == 202 then notifyUnlinked(data) end
  end)
  return true
end
exports('AddMatchStats', addMatchStats)

--- Envoie les stats de plusieurs joueurs en une requête (max 200). entries = { { source = 1, kills = … }, … }
local function addMatchStatsBatch(entries)
  if type(entries) ~= 'table' then return 0 end
  local rows = {}
  for _, e in ipairs(entries) do
    local row = type(e) == 'table' and buildRow(e.source, e) or nil
    if row then rows[#rows + 1] = row end
    if #rows >= 200 then break end
  end
  if #rows == 0 then return 0 end
  RSBridge.post('/stats', rows, function(status, data)
    if status == 202 then notifyUnlinked(data) end
  end)
  return #rows
end
exports('AddMatchStatsBatch', addMatchStatsBatch)

-- ───────────── En direct (cumul + envoi groupé) ─────────────

--- licence → { kills = …, deaths = …, … } en attente d'envoi
local pending = {}

--- Ajoute des stats en direct à un joueur (kill, mort, dégâts…). Retourne false si le joueur n'a pas de licence.
--- exports.rs_bridge:AddStats(source, { kills = 1 })   ·   { deaths = 1 }   ·   { damage = 250 }   ·   { xp = 50 }
--- `win = true` / `top10 = true` acceptés (comptent 1) ; `matches` seulement si vous ne passez pas par AddMatchStats.
local function addStats(src, stats)
  if type(stats) ~= 'table' then return false end
  local license = RSBridge.licenseOf(RSBridge.identifiersOf(src))
  if not license then return false end
  local acc = pending[license] or {}
  for _, field in ipairs(LIVE_FIELDS) do
    local value = stats[field]
    if field == 'wins' and value == nil then value = stats.win end
    local n = toInt(value)
    if n > 0 then acc[field] = (acc[field] or 0) + n end
  end
  pending[license] = acc
  return true
end
exports('AddStats', addStats)

local function liveRow(license, acc)
  return {
    identifier = license,
    mode = 'increment',
    wins = acc.wins or 0,
    kills = acc.kills or 0,
    deaths = acc.deaths or 0,
    matches = acc.matches or 0,
    damage = acc.damage or 0,
    top10 = acc.top10 or 0,
    xp = acc.xp or 0,
  }
end

--- Remet en attente des lignes non envoyées (bot injoignable / surchargé).
local function requeue(rows)
  for _, row in ipairs(rows) do
    local acc = pending[row.identifier] or {}
    for _, field in ipairs(LIVE_FIELDS) do
      if (row[field] or 0) > 0 then acc[field] = (acc[field] or 0) + row[field] end
    end
    pending[row.identifier] = acc
  end
end

--- Envoie les stats en direct en attente (max 200 joueurs par requête). Retourne le nombre de joueurs envoyés.
local function flushStats()
  local rows = {}
  for license, acc in pairs(pending) do
    local row = liveRow(license, acc)
    rows[#rows + 1] = row
    if #rows >= 200 then break end
  end
  if #rows == 0 then return 0 end
  for _, row in ipairs(rows) do pending[row.identifier] = nil end
  RSBridge.post('/stats', rows, function(status, data)
    if status == 202 then
      notifyUnlinked(data)
    elseif status == 0 or status == 429 or status >= 500 then
      requeue(rows)
    end
  end)
  return #rows
end
exports('FlushStats', flushStats)

CreateThread(function()
  while true do
    Wait(math.max(5, Config.StatsFlushInterval or 15) * 1000)
    flushStats()
  end
end)

AddEventHandler('onResourceStop', function(name)
  if name == GetCurrentResourceName() then flushStats() end
end)
