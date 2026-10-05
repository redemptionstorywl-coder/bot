--[[
  rs_bridge — rôles Discord → groupes en jeu

  Le bot associe des rôles Discord à des groupes (/config module:fivem → 🛡️ Groupes, ou le dashboard), par ordre de
  priorité : le premier groupe détenu est le groupe PRINCIPAL. rs_bridge reçoit les groupes du joueur :
    - à la connexion (réponses de POST /check et POST /players/join) ;
    - quand un rôle change sur Discord (action SET_GROUPS, relevée toutes les Config.ActionsInterval secondes).

  Application :
    1. ACE : `add_principal identifier.discord:<id> group.<nom>` (+ identifier.license:<…>), et `remove_principal` des
       groupes gérés par le bot que le joueur n'a plus. Config.GroupsMode = 'highest' (défaut) : seul le groupe principal
       est donné ; 'all' : tous les groupes détenus.
    2. Gamemode : événement serveur `rs_bridge:groupsChanged` (source, groupes, principal) et exports :
         exports.rs_bridge:GetGroups(source)        → { 'admin', 'mod' } (du plus prioritaire au moins prioritaire)
         exports.rs_bridge:GetGroup(source)         → 'admin' ou nil
         exports.rs_bridge:HasGroup(source, 'mod')  → true / false

  Exemple (server.cfg) : `add_ace group.admin command allow` puis, dans le gamemode :
    AddEventHandler('rs_bridge:groupsChanged', function(src, groups, primary) print(src, primary) end)
  Ne donnez pas à la main (server.cfg) un groupe géré par le bot : il serait retiré au joueur qui n'a pas le rôle.
]]

--- source → { list = { … }, primary = '…' }
local playerGroups = {}

--- Tous les groupes gérés par le bot vus depuis le démarrage : un groupe retiré de la liste sur Discord est quand même
--- retiré aux joueurs (les principals ACE vivent jusqu'au redémarrage du serveur).
local seenGroups = {}

local function validGroup(g)
  return type(g) == 'string' and #g >= 1 and #g <= 32 and g:match('^[a-z0-9_%.%-]+$') ~= nil
end

local function validPrincipal(p)
  return type(p) == 'string' and #p <= 160 and p:match('^identifier%.%w+:[%w_%.%-]+$') ~= nil
end

local function cleanList(groups)
  local out, seen = {}, {}
  if type(groups) ~= 'table' then return out end
  for _, g in ipairs(groups) do
    if validGroup(g) and not seen[g] then
      seen[g] = true
      out[#out + 1] = g
    end
  end
  return out
end

local function copy(list)
  local out = {}
  for i, v in ipairs(list) do out[i] = v end
  return out
end

local function sameList(a, b)
  if #a ~= #b then return false end
  for i = 1, #a do
    if a[i] ~= b[i] then return false end
  end
  return true
end

--- Principals ACE d'un joueur : discord:<id> (si connu) + licences / identifiant FiveM (liaison manuelle sans discord:).
local function principalsOf(ids, discordId)
  local out, seen = {}, {}
  local function add(identifier)
    if type(identifier) ~= 'string' or identifier == '' then return end
    local principal = 'identifier.' .. identifier
    if validPrincipal(principal) and not seen[principal] then
      seen[principal] = true
      out[#out + 1] = principal
    end
  end
  if type(discordId) == 'string' and discordId:match('^%d+$') then add('discord:' .. discordId) end
  for _, id in ipairs(type(ids) == 'table' and ids or {}) do
    local prefix = type(id) == 'string' and id:match('^(%w+):') or nil
    if prefix == 'discord' or prefix == 'license' or prefix == 'license2' or prefix == 'fivem' then add(id) end
  end
  return out
end

--- Groupes à donner selon Config.GroupsMode ('highest' = le principal seulement, 'all' = tous).
local function wanted(list, primary)
  local want = {}
  if Config.GroupsMode == 'all' then
    for _, g in ipairs(list) do want[g] = true end
  elseif primary then
    want[primary] = true
  end
  return want
end

local function applyPrincipals(principals, list, primary, managed)
  local want = wanted(list, primary)
  for _, principal in ipairs(principals) do
    for _, g in ipairs(managed) do
      if not want[g] then ExecuteCommand(('remove_principal %s group.%s'):format(principal, g)) end
    end
    for g in pairs(want) do
      ExecuteCommand(('add_principal %s group.%s'):format(principal, g))
    end
  end
end

--- Applique les groupes reçus du bot.
--- target = { src = source connecté ou nil, ids = identifiants, discordId = ID Discord ou nil }
--- groups = groupes détenus (ordre de priorité), primary = groupe principal, managed = tous les groupes gérés par le bot.
function RSBridge.applyGroups(target, groups, primary, managed)
  if type(target) ~= 'table' then return end
  local list = cleanList(groups)
  local main = validGroup(primary) and primary or list[1]
  for _, g in ipairs(cleanList(managed)) do seenGroups[g] = true end
  for _, g in ipairs(list) do seenGroups[g] = true end
  local managedList = {}
  for g in pairs(seenGroups) do managedList[#managedList + 1] = g end
  table.sort(managedList)
  if #managedList > 0 then applyPrincipals(principalsOf(target.ids, target.discordId), list, main, managedList) end

  local src = tonumber(target.src)
  if not src then return end
  local before = playerGroups[src]
  playerGroups[src] = { list = list, primary = main }
  if not before or not sameList(before.list, list) or before.primary ~= main then
    RSBridge.debug('Groupes de %d : %s', src, #list > 0 and table.concat(list, ', ') or 'aucun')
    TriggerEvent('rs_bridge:groupsChanged', src, copy(list), main)
  end
end

function RSBridge.clearGroups(src)
  src = tonumber(src)
  if src then playerGroups[src] = nil end
end

function RSBridge.getGroups(src)
  local entry = playerGroups[tonumber(src) or -1]
  return entry and copy(entry.list) or {}
end

exports('GetGroups', function(src)
  return RSBridge.getGroups(src)
end)

exports('GetGroup', function(src)
  local entry = playerGroups[tonumber(src) or -1]
  return entry and entry.primary or nil
end)

exports('HasGroup', function(src, name)
  local entry = playerGroups[tonumber(src) or -1]
  if not entry or type(name) ~= 'string' then return false end
  for _, g in ipairs(entry.list) do
    if g == name then return true end
  end
  return false
end)
