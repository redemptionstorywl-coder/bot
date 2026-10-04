--[[
  rs_bridge — statistiques Battle Royale (fin de partie → POST /stats)

  À appeler par votre gamemode à la fin de chaque partie, pour chaque joueur :
    exports.rs_bridge:AddMatchStats(source, { kills = 5, deaths = 1, win = true, damage = 1540, top10 = true, xp = 350 })

  Ou en lot (une seule requête) :
    exports.rs_bridge:AddMatchStatsBatch({ { source = 1, kills = 5, win = true }, { source = 2, kills = 0, deaths = 1 } })

  Le temps de jeu n'est PAS envoyé ici : le bot le calcule lui-même à partir des connexions / déconnexions.
  Si le joueur n'a pas de compte Discord lié, le bot répond 202 `unlinked` et le joueur est prévenu en jeu.
]]

local function toInt(v)
  if v == true then return 1 end
  local n = tonumber(v)
  if not n or n < 0 then return 0 end
  return math.floor(n)
end

--- Construit la ligne de stats normalisée d'un joueur (nil si aucune licence).
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

local function notifyUnlinked(rows, data)
  if type(data) ~= 'table' or type(data.unlinkedIdentifiers) ~= 'table' then return end
  local unlinked = {}
  for _, lic in ipairs(data.unlinkedIdentifiers) do unlinked[lic] = true end
  for _, s in ipairs(GetPlayers()) do
    local lic = RSBridge.licenseOf(RSBridge.identifiersOf(s))
    if lic and unlinked[lic] then RSBridge.notify(tonumber(s), RSBridge.msg('stats_unlinked')) end
  end
end

--- Envoie les stats d'un joueur pour une partie terminée. Retourne false si le joueur n'a pas de licence.
local function addMatchStats(src, stats)
  local row = buildRow(src, stats)
  if not row then return false end
  RSBridge.post('/stats', row, function(status, data)
    if status == 202 then notifyUnlinked({ row }, data) end
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
    if status == 202 then notifyUnlinked(rows, data) end
  end)
  return #rows
end
exports('AddMatchStatsBatch', addMatchStatsBatch)
