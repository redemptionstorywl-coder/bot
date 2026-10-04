--[[
  rs_bridge — configuration
  1. Sur Discord : /fivem add key:<ServerKey> name:"…" framework:CUSTOM   (ESX / QBCORE acceptés aussi)
  2. Copier l'URL du bot, l'ID du serveur Discord et la clé API ci-dessous.
  3. server.cfg : ensure rs_bridge   (après es_extended / qb-core si vous les utilisez)
  Documentation complète : docs/FIVEM.md du bot.
]]

Config = {}

-- URL publique du bot (DASHBOARD_URL), sans slash final. Ex : 'https://bot.mondomaine.fr'
Config.BotUrl = 'https://bot.example.com'

-- Clé API : FIVEM_API_KEY du bot, ou la clé propre au serveur (/fivem add … api_key:)
-- Conseil : laissez vide ici et définissez `set rs_bridge_api_key "…"` dans server.cfg (non versionné).
Config.ApiKey = ''

-- ID du serveur Discord (clic droit sur le serveur → Copier l'identifiant)
Config.GuildId = '000000000000000000'

-- Clé du serveur déclarée avec /fivem add (ex : 'main', 'br-1')
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
Config.ActionsInterval = 10  -- GET /actions (bans/unbans/kicks/messages venant de Discord)

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

-- Convar signalant la maintenance dans le statut (set rs_maintenance true). Non définie = ignorée (/fivem maintenance fait foi).
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
