# Architecture — Redemption Story Bot

Ce document est le **contrat** à respecter par chaque module. Lisez-le avant d'ajouter du code.

## Stack
Node 22 · TypeScript (CommonJS, `strict`) · discord.js v14 · Prisma 6 (MySQL) · Express 4 + EJS · Socket.IO · Zod · Pino · Vitest.

## Dossiers
```
src/
  index.ts                 bootstrap (env → DB → client → loaders → login → dashboard)
  config/env.ts            variables d'env validées par Zod (env())
  config/constants.ts      BRAND, MODULE_KEYS, LANGUAGES (fr, en), LOG_CATEGORY_LABELS, TEMPLATE_VARIABLES
  core/Client.ts           RedemptionClient (collections commands/buttons/selectMenus/modals/modules, cooldowns, bus)
  core/loaders.ts          chargement récursif de commands/, buttons/, selectMenus/, modals/, events/, modules/
  core/context.ts          resolveContext(client, interaction) → { client, config, lang, t } (lang = langue du serveur)
  core/deploy.ts           déploiement des slash commands
  core/tasks.ts            tâches planifiées génériques
  structures/              types + helpers defineCommand/defineButton/defineSelectMenu/defineModal/defineEvent/defineModule
  services/                un service = une classe + export d'une instance singleton (ex: `export const ticketService = new TicketService()`)
  commands/<categorie>/    un fichier = une commande slash (export default defineCommand({...}))
  buttons/ selectMenus/ modals/   un fichier = un handler (export default defineButton({ id: 'namespace', ... }))
  events/                  un fichier = un événement Discord (export default defineEvent({ name: Events.X, ... }))
  modules/<nom>/index.ts   export default defineModule({ key, name, description, onReady, onShutdown })
  locales/<lang>/<ns>.json fichiers de traduction, un par module (clé finale = `<ns>.<chemin>`)
  utils/                   helpers partagés (customId, time, variables, cooldown, cache, permissions, pagination)
dashboard/                 Express + EJS + Socket.IO (auth Discord OAuth2)
prisma/schema.prisma       schéma complet
tests/                     Vitest (tests/**/*.test.ts)
```

## Conventions obligatoires

### Commandes
```ts
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { defineCommand } from '../../structures';

export default defineCommand({
  data: new SlashCommandBuilder().setName('x').setDescription('…'),
  module: 'tickets',                       // clé de MODULE_KEYS → refusée si module désactivé
  permissions: { internal: 'staff', discord: [PermissionFlagsBits.ManageMessages] },
  cooldown: 3,
  async execute(interaction, ctx) { const { t, lang, config, client } = ctx; /* … */ },
});
```
- `ctx.t(key, vars)` traduit dans la langue du serveur (`GuildSettings.defaultLanguage`, `fr` ou `en`). **Aucun texte utilisateur en dur** : tout passe par `t()` avec les fichiers `locales/fr/<ns>.json` **et** `locales/en/<ns>.json` (seules langues, parité des clés testée).
- `ctx.config` = `ResolvedGuildConfig` (kind, modules, defaultLanguage, staffRoleIds, adminRoleIds, brandColor — bleu #2F8BFF par défaut —, logChannels).
- Réponses de confirmation/erreur : `MessageFlags.Ephemeral`. Embeds : `embedService.brand/success/error/warning/info`. Couleur par défaut `config.brandColor`.
- Permissions internes : `'everyone' | 'staff' | 'admin' | 'owner'` (staff = rôles staff configurés ou ModerateMembers/ManageGuild ; admin = rôles admin ou Administrator).
- Permissions par rôle configurables par serveur (`/config module:permissions`, dashboard) : `commandPermissionService` (src/services/CommandPermissionService.ts) + `decideCommandAccess`, appliqués par `src/events/interactionCreate.ts` AVANT le niveau interne et les permissions Discord : `allow` (rôle autorisé, administrateur Discord, propriétaire) saute niveau + permissions Discord de l'utilisateur (celles du bot restent vérifiées), `deny_disabled` / `deny_role` refusent, `default` = comportement ci-dessus. `config` et `help` sont verrouillées. Les vérifications faites DANS une commande (ex. `/clear salon` réservé aux admins) restent en place.

### Composants (boutons, menus, modals)
- customId = `namespace:arg1:arg2` construit avec `buildCustomId('ticket', 'close', ticketId)` (`src/utils/customId.ts`). Max 100 caractères.
- Handler : `export default defineButton({ id: 'ticket', module: 'tickets', async execute(interaction, args, ctx) { const [action, id] = args; } })`.
- Permissions par rôle et composants : `command: 'unban-all'` dans un handler le rattache à cette commande (sa règle s'applique : rôle autorisé → accès, désactivée / rôle absent → refus). Sans `command`, un composant posé sur la réponse d'une commande slash (`message.interaction.commandName`) profite seulement de l'autorisation par rôle ; un refus retombe sur ses vérifications par défaut (boutons publics : vote, inscription…).
- Un namespace par module (`ticket`, `rolemenu`, `giveaway`, `poll`, `event`, `announce`, `embed`, `welcome`, `notif`, `whitelist`, `shop`, `school`, `br`…). **Ne réutilisez pas le namespace d'un autre module.**
- Les namespaces `noop` et `pg` sont réservés.

### Services
- Logique métier dans `src/services/XService.ts`, pas dans les commandes. Les commandes/boutons ne font que parser + appeler le service + répondre.
- Accès DB : `import { prisma } from '../database/client'`. Jamais de SQL brut interpolé (Prisma uniquement, `$queryRaw` tagué si indispensable).
- Pas de requête SQL à chaque message : utiliser `TTLCache` (`src/utils/cache.ts`) ou un buffer en mémoire flushé périodiquement.
- Tâches périodiques : `scheduler.register({ name: 'giveaways:end', intervalMs: 15_000, run })` (`src/services/SchedulerService.ts`). **Jamais de `setInterval` ad hoc** dans les services.
- Logs Discord + base : `loggingService.log({ guildId, category: 'TICKET', action: 'ticket.open', title, description, fields, actorId, targetId })`. Toute nouvelle `action` doit avoir sa route dans `ACTION_ROUTES` (`src/services/logs/routes.ts`, vérifié par `npm run check` → log-routes) ; une action calculée doit être typée par une union de littéraux. Log lié à un serveur de jeu : `game: { serverId, serverName }`. Les embeds partent par la file groupée `logDispatchService` (jamais de `channel.send` direct pour un log).
- Embeds dynamiques configurables : `EmbedSpec` (Zod, `src/services/EmbedService.ts`) stocké en JSON, rendu via `embedService.build(spec, { member, guild, language, extra })` avec les variables `{user}`, `{server}`, `{memberCount}`… (`src/utils/variables.ts`).
- Traduction automatique FR → EN des messages publiés : `autoTranslateService.localizeMessage(guildId, { content, embeds }, { scope, targetId })` (src/services/AutoTranslateService.ts) sur le **modèle non rendu** (avant `renderTemplate`) ; réglage serveur dans `config.autoTranslate`, choix par message via `setChoice(guildId, scope, targetId, bool)` (scopes `announcement`, `welcome`, `ticket_panel`). Fonctions pures : `src/services/autotranslate/` (`text.ts` protection/restauration, `bilingual.ts` composition + limites Discord, `providers.ts` DeepL / Google / MyMemory). Ne lance jamais : échec → message français seul.
- Durées : `parseDuration('1h30m')` / `formatDuration(sec, lang)` / `discordTimestamp(date, 'R')` (`src/utils/time.ts`).

### Base de données
- Le schéma `prisma/schema.prisma` est complet. **Ne modifiez pas les modèles existants.** Si un champ manque vraiment, ajoutez un **nouveau modèle à la fin du fichier** puis `npx prisma generate`.
- Champs Json : castez via des types TS locaux + validation Zod à la lecture quand ils viennent du dashboard.

### Qualité
- `npx tsc -p tsconfig.json --noEmit` doit passer sans erreur.
- `npm run check` (scripts/checks/) doit être vert : customIds ⇄ handlers (actions supprimées interdites : `REMOVED_ACTIONS`), clés fr/en, références mortes, Lua ⇄ API FiveM, migrations ⇄ schéma. Toute modification du schéma passe par une **nouvelle** migration (les `UPDATE` de données y sont acceptés).
- Tests Vitest dans `tests/<module>/*.test.ts`, en mockant Prisma : `vi.mock('../../src/database/client', () => ({ prisma: mockPrisma }))` (voir `tests/helpers/prisma.ts`).
- Aucune fonctionnalité simulée : pas de `TODO`, pas de bouton qui ne fait rien. Si une intégration externe est requise (Tebex, FiveM), implémenter l'architecture + documenter précisément ce qu'il faut brancher.

### Design
Sobre, premium, sombre. Embeds Discord en **bleu** `BRAND.colors.primary` (0x2F8BFF, couleur par défaut `GuildSettings.brandColor` = `DEFAULT_BRAND_HEX`, accent des cartes de bienvenue), rouge uniquement pour alertes/sanctions. Pas d'embeds surchargés. Le violet reste l'identité de l'interface du dashboard (`dashboard/public/css`), pas des embeds.

### Panneaux /config
- Toute la configuration passe par `/config module:<clé>` (src/commands/admin/config.ts). Un panneau = un fichier `src/panels/<clé>.ts` exportant `defineConfigPanel({ key, label, emoji, order, module?, open })` (src/structures/configPanel.ts), découvert automatiquement (max 25).
- `open(interaction, ctx)` répond en éphémère avec un embed d'état + composants. Les composants utilisent le namespace propre du panneau (`cfg-<clé>` recommandé, ou un namespace existant comme `welcome:cfg`/`tcfg`) avec `permissions: { internal: 'admin' }`.
- Chaque action re-rend le panneau (`interaction.update`) avec une notice ✅/❌ ; modals : `isFromMessage() ? update : reply ephemeral`.
- Pas de commande de configuration séparée : les commandes slash restantes sont des ACTIONS (modération, tickets, annonces, profils…).
- Ordre actuel : general (1), permissions (2), logs (3), bienvenue (4), tickets (5), moderation (6), roles (7), fivem (8), battleroyale (9), whitelist (10), school (11), shop (12), vocal (13).
- Respecter les limites Discord : 5 rangées, un menu seul sur sa rangée, 25 options (paginer au-delà, cf. `src/panels/_permissions.ts`), customIds < 100, embed ≤ 6000 caractères ; pré-remplir les menus de rôles / salons uniquement avec des IDs encore présents (`src/utils/liveIds.ts`).

### Tickets : ouverture, fermeture, transcript (module `tickets`)
- Fonctions pures : `src/services/tickets/title.ts` (`slugifyTicketTitle`, `uniqueChannelName`, `planOpenModal` : titre + 4 questions max + message facultatif) et `src/services/tickets/closeFlow.ts` (`resolveClosedCategory` : archive de la raison → `TicketSettings.closedCategoryId` → `DEFAULT_CLOSED_CATEGORY_ID` → sur place, limite de 50 salons ; `resolveReopenCategory` ; `planMemberAccess` : créateur + membres ajoutés, jamais le staff).
- `ticketService.closeTicket` conserve le salon (statut CLOSED, `openCategoryId` mémorisé, accès retiré, message de contrôle `closeMessageId` avec `ticket:transcript|reopen|delete:<id>`) ; **aucun transcript automatique** (ni à la fermeture, ni à la suppression, ni quand un salon est supprimé à la main). `sendClosedTranscript` (bouton 📄, staff, une fois par fermeture : `transcriptSentAt`) génère, enregistre et envoie en DM ; `reopenTicket` rétablit accès, catégorie et relances.
- Le claim n'existe plus (statut `CLAIMED` et colonne `claimedById` supprimés par la migration `20261012000000_ticket_close_flow`) ; `npm run check` refuse toute action `ticket:claim` (`REMOVED_ACTIONS`) et la sous-commande « ticket claim » (`REMOVED_SUBCOMMANDS`).

### Salons vocaux temporaires (module `vocal`)
- `src/services/TempVoiceService.ts` : fonctions pures (`resolveRule`, `buildChannelName`, `sanitizeMemberName`, `decideLobbyJoin`, `decideLeave`, `planStartupCleanup`, `buildOverwrites`) + service `tempVoiceService` (config `TempVoiceConfig`, salons actifs `TempVoiceChannel`, état en mémoire, suppression après `DELETE_GRACE_MS`, tâche `vocal:sweep`).
- Événements : `voiceStateUpdate.vocal.ts`, `channelDelete.vocal.ts`, `ready.vocal.ts` (reprise : salons vides supprimés, disparus oubliés). Panneau `src/panels/vocal.ts` (namespace `cfg-vocal`), page dashboard `routes/guild/vocal.ts`.

### Serveur de logs central (`/template logs`)
- Modèles `LogHub` (hub), `LogHubSource` (serveur Discord relié, `keepLocal`, nom / emoji de section), `LogHubGame` (serveur FiveM relié, `chat`), `LogRoute` (`sourceKey` = ID de la source | `game:<FiveMServer.id>` | `global`, `routeKey` = route fine ou `category.*`, `channelId`). Catégorie de logs `GAME` (logs en jeu).
- `src/services/logs/` (pur, testé) : `routes.ts` (clés de routes, table action → route, replis par catégorie, copies générales), `delivery.ts` (`planDelivery` : local / section source / section jeu / section générale, replis, `keepLocal`), `sendQueue.ts` (`LogSendQueue` : 10 embeds / 6000 caractères par message, 429 → `retry_after`, backoff, abandon des plus anciens au-delà de 500), `template.ts` (`planTemplate` idempotent, modules non pertinents omis, limites 50 / 500, sommaire), `embeds.ts`.
- Services : `logHubService` (liens + **vérification de sécurité** `checkLinkPermission` : propriétaire du bot, propriétaire ou Administrateur de la SOURCE relu via l'API ; une source = un hub ; événements « bot » `system()`), `logTemplateService` (création cadencée, routes, sommaire épinglé), `logDispatchService` (tâche `logs:dispatch` toutes les 2 s ; le scheduler accélère sa boucle pour les tâches < 5 s), `gameLogService` (`POST /logs`, quota 600 entrées / min / serveur, rendu `src/services/fivem/gameLogs.ts`), `configAudit` (notices ✅ des panneaux `/config` → log `config.change`, sans toucher aux handlers).
- Interface : `/template logs` (`src/commands/admin/template.ts` + `_templateLogs.ts`, namespace `tpl`), bouton « Délier » du panneau `/config module:logs`, page dashboard `routes/guild/loghub.ts` (Sécurité → Hub de logs). Les changements du dashboard qui affichent un flash de succès sont journalisés (`dashboard.change`) sauf si la route a déjà écrit son log (`markAudited(res)`).
