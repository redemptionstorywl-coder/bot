--[[
  rs_bridge — configuration
  1. Sur Discord : /config module:fivem → ➕ Ajouter (clé = ServerKey, framework CUSTOM / ESX / QBCORE)
  2. server.cfg (recommandé, les convars passent avant les valeurs ci-dessous) :
       set rs_bridge_url "https://bot-f0v7.onrender.com"
       set rs_bridge_guild "ID du serveur Discord"
       set rs_bridge_server_key "br"
       set rs_bridge_api_key "la clé API"
       add_ace resource.rs_bridge command.add_principal allow
       add_ace resource.rs_bridge command.remove_principal allow
       ensure rs_bridge   (après es_extended / qb-core si vous les utilisez)
  Guide pas à pas : docs/INSTALL-BATTLEROYALE.md du bot. Référence : docs/FIVEM.md.
]]

Config = {}

-- URL publique du bot (DASHBOARD_URL), sans slash final. Convar : rs_bridge_url
Config.BotUrl = 'https://bot-f0v7.onrender.com'

-- Clé API : FIVEM_API_KEY du bot, ou la clé propre au serveur (champ « Clé API propre » du panneau /config module:fivem)
-- Conseil : laissez vide ici et définissez `set rs_bridge_api_key "…"` dans server.cfg (non versionné).
Config.ApiKey = ''

-- ID du serveur Discord (clic droit sur le serveur → Copier l'identifiant). Convar : rs_bridge_guild
Config.GuildId = '000000000000000000'

-- Clé du serveur déclarée dans /config module:fivem (ex : 'main', 'br'). Convar : rs_bridge_server_key
Config.ServerKey = 'main'

-- Langue des messages affichés aux joueurs : 'fr' ou 'en'
Config.Locale = 'fr'

-- 'standalone' | 'esx' | 'qbcore' : utilisé pour le pseudo « personnage » et les notifications
Config.Framework = 'standalone'

-- Source du pseudo envoyé au bot (surnom Discord) :
--   'fivem'     = nom du profil FiveM (GetPlayerName)
--   'character' = nom du personnage ESX/QBCore (prénom nom) une fois chargé
--   Dans tous les cas, l'export SetPlayerName(source, name) permet au gamemode d'imposer le pseudo choisi en jeu.
Config.NameSource = 'fivem'

-- Intervalles (secondes)
Config.StatusInterval = 30   -- heartbeat POST /status (liste des joueurs, compteur, rôles « en jeu »)
Config.ActionsInterval = 10  -- GET /actions (bans/unbans/kicks/messages/groupes venant de Discord)
Config.StatsFlushInterval = 15 -- envoi groupé des stats en direct (exports.rs_bridge:AddStats)

-- Rôles Discord → groupes en jeu (ACE `group.<nom>`), réglés sur Discord (/config module:fivem → 🛡️ Groupes) :
--   'highest' = seul le groupe le plus prioritaire détenu est donné (recommandé si vos groupes héritent entre eux)
--   'all'     = tous les groupes détenus sont donnés
-- Nécessite dans server.cfg : add_ace resource.rs_bridge command.add_principal allow (et command.remove_principal)
Config.GroupsMode = 'highest'

-- Délai max d'une requête HTTP (ms). Au-delà, la requête est considérée en échec.
Config.HttpTimeout = 8000

-- Vérification à la connexion (POST /check) : ban Discord, Discord requis, rôle requis, whitelist
Config.CheckOnConnect = true

-- Bot injoignable pendant la connexion : true = laisser entrer (les bans locaux restent appliqués), false = refuser
Config.FailOpen = true

-- Utiliser le message de refus renvoyé par le bot (localisé selon la langue du serveur Discord)
Config.UseBotMessages = true

-- Rappeler en jeu aux joueurs non liés de lancer FiveM avec Discord ouvert
Config.NotifyUnlinked = true

-- Relayer automatiquement les sanctions txAdmin (ban / warn / kick / révocation de ban) vers le bot
Config.TxAdminHooks = true

-- Convar signalant la maintenance dans le statut (set rs_maintenance true). Non définie = ignorée (le bouton Maintenance de /config module:fivem fait foi).
Config.MaintenanceConvar = 'rs_maintenance'

-- Logs détaillés dans la console serveur
Config.Debug = false

Config.Messages = {
  fr = {
    checking = 'Vérification de votre compte Discord…',
    banned = 'Vous êtes banni de ce serveur. Raison : %s',
    banned_until = 'Vous êtes banni de ce serveur jusqu\'au %s (UTC). Raison : %s',
    kicked = 'Vous avez été expulsé : %s',
    warned = 'Avertissement : %s',
    bot_unreachable = 'Le serveur Discord est momentanément injoignable, réessayez dans une minute.',
    discord_required = 'Ouvrez Discord sur votre PC avant de lancer FiveM pour lier votre compte, puis réessayez.',
    not_member = 'Rejoignez d\'abord notre serveur Discord.',
    missing_role = 'Un rôle Discord est requis pour rejoindre ce serveur.',
    not_whitelisted = 'Vous n\'êtes pas whitelisté. Faites une demande sur notre Discord.',
    unlinked = 'Votre compte n\'est pas lié à Discord : lancez FiveM avec Discord ouvert pour synchroniser vos stats, votre pseudo et vos rôles.',
    stats_unlinked = 'Stats non enregistrées : compte non lié à Discord. Lancez FiveM avec Discord ouvert ou utilisez /br-link sur Discord.',
    no_reason = 'aucune raison',
  },
  en = {
    checking = 'Checking your Discord account…',
    banned = 'You are banned from this server. Reason: %s',
    banned_until = 'You are banned from this server until %s (UTC). Reason: %s',
    kicked = 'You have been kicked: %s',
    warned = 'Warning: %s',
    bot_unreachable = 'The Discord server is temporarily unreachable, try again in a minute.',
    discord_required = 'Open Discord on your PC before launching FiveM to link your account, then try again.',
    not_member = 'Join our Discord server first.',
    missing_role = 'A Discord role is required to join this server.',
    not_whitelisted = 'You are not whitelisted. Apply on our Discord.',
    unlinked = 'Your account is not linked to Discord: launch FiveM with Discord open to sync your stats, name and roles.',
    stats_unlinked = 'Stats not saved: account not linked to Discord. Launch FiveM with Discord open or use /br-link on Discord.',
    no_reason = 'no reason',
  },
}
