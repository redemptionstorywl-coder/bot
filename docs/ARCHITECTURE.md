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
- `ctx.config` = `ResolvedGuildConfig` (kind, modules, defaultLanguage, staffRoleIds, adminRoleIds, brandColor, logChannels).
- Réponses de confirmation/erreur : `MessageFlags.Ephemeral`. Embeds : `embedService.brand/success/error/warning/info`. Couleur par défaut `config.brandColor`.
- Permissions internes : `'everyone' | 'staff' | 'admin' | 'owner'` (staff = rôles staff configurés ou ModerateMembers/ManageGuild ; admin = rôles admin ou Administrator).

### Composants (boutons, menus, modals)
- customId = `namespace:arg1:arg2` construit avec `buildCustomId('ticket', 'close', ticketId)` (`src/utils/customId.ts`). Max 100 caractères.
- Handler : `export default defineButton({ id: 'ticket', module: 'tickets', async execute(interaction, args, ctx) { const [action, id] = args; } })`.
- Un namespace par module (`ticket`, `rolemenu`, `giveaway`, `poll`, `event`, `announce`, `embed`, `welcome`, `notif`, `whitelist`, `shop`, `school`, `br`…). **Ne réutilisez pas le namespace d'un autre module.**
- Les namespaces `noop` et `pg` sont réservés.

### Services
- Logique métier dans `src/services/XService.ts`, pas dans les commandes. Les commandes/boutons ne font que parser + appeler le service + répondre.
- Accès DB : `import { prisma } from '../database/client'`. Jamais de SQL brut interpolé (Prisma uniquement, `$queryRaw` tagué si indispensable).
- Pas de requête SQL à chaque message : utiliser `TTLCache` (`src/utils/cache.ts`) ou un buffer en mémoire flushé périodiquement.
- Tâches périodiques : `scheduler.register({ name: 'giveaways:end', intervalMs: 15_000, run })` (`src/services/SchedulerService.ts`). **Jamais de `setInterval` ad hoc** dans les services.
- Logs Discord + base : `loggingService.log({ guildId, category: 'TICKET', action: 'ticket.open', title, description, fields, actorId, targetId })`.
- Embeds dynamiques configurables : `EmbedSpec` (Zod, `src/services/EmbedService.ts`) stocké en JSON, rendu via `embedService.build(spec, { member, guild, language, extra })` avec les variables `{user}`, `{server}`, `{memberCount}`… (`src/utils/variables.ts`).
- Durées : `parseDuration('1h30m')` / `formatDuration(sec, lang)` / `discordTimestamp(date, 'R')` (`src/utils/time.ts`).

### Base de données
- Le schéma `prisma/schema.prisma` est complet. **Ne modifiez pas les modèles existants.** Si un champ manque vraiment, ajoutez un **nouveau modèle à la fin du fichier** puis `npx prisma generate`.
- Champs Json : castez via des types TS locaux + validation Zod à la lecture quand ils viennent du dashboard.

### Qualité
- `npx tsc -p tsconfig.json --noEmit` doit passer sans erreur.
- `npm run check` (scripts/checks/) doit être vert : customIds ⇄ handlers, clés fr/en, références mortes, Lua ⇄ API FiveM, migrations ⇄ schéma. Toute modification du schéma passe par une **nouvelle** migration.
- Tests Vitest dans `tests/<module>/*.test.ts`, en mockant Prisma : `vi.mock('../../src/database/client', () => ({ prisma: mockPrisma }))` (voir `tests/helpers/prisma.ts`).
- Aucune fonctionnalité simulée : pas de `TODO`, pas de bouton qui ne fait rien. Si une intégration externe est requise (Tebex, FiveM), implémenter l'architecture + documenter précisément ce qu'il faut brancher.

### Design
Sobre, premium, sombre. Violet `BRAND.colors.primary` (0x7C3AED) pour l'identité, rouge uniquement pour alertes/sanctions. Pas d'embeds surchargés.

### Panneaux /config
- Toute la configuration passe par `/config module:<clé>` (src/commands/admin/config.ts). Un panneau = un fichier `src/panels/<clé>.ts` exportant `defineConfigPanel({ key, label, emoji, order, module?, open })` (src/structures/configPanel.ts), découvert automatiquement (max 25).
- `open(interaction, ctx)` répond en éphémère avec un embed d'état + composants. Les composants utilisent le namespace propre du panneau (`cfg-<clé>` recommandé, ou un namespace existant comme `welcome:cfg`/`tcfg`) avec `permissions: { internal: 'admin' }`.
- Chaque action re-rend le panneau (`interaction.update`) avec une notice ✅/❌ ; modals : `isFromMessage() ? update : reply ephemeral`.
- Pas de commande de configuration séparée : les commandes slash restantes sont des ACTIONS (modération, tickets, annonces, profils…).
