fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'rs_bridge'
author 'Redemption Story'
description 'Pont FiveM ⇄ bot Discord Redemption Story : bans, pseudos, rôles → groupes, statut, stats Battle Royale, logs en jeu'
version '1.2.0'

-- Aucune dépendance obligatoire (ESX / QBCore / txAdmin détectés si présents).
server_scripts {
  'config.lua',
  'server/main.lua',
  'server/groups.lua',
  'server/stats.lua',
  'server/logs.lua',
}
