# Dashboard web — Redemption Story Studio

Express 4 + EJS + Socket.IO, authentification Discord OAuth2 (sans passport), sessions Prisma, CSRF, Zod.
Point d'entrée : `startDashboard(client)` dans `server.ts` (appelé par `src/index.ts`).

## Arborescence

```
dashboard/
  server.ts            startDashboard(client) → http.Server + Socket.IO, DashboardHandle.close()
  app.ts               createApp(client, { env, sessionMiddleware }) : middlewares + montage des routes
  sockets.ts           createSockets(), broadcastToGuild(), RELAYED_BUS_EVENTS
  auth/
    oauth.ts           buildAuthorizeUrl / exchangeCode / fetchUser / fetchGuilds / buildBotInviteUrl
    routes.ts          GET /auth/login, GET /auth/callback, POST /auth/logout
    session.ts         createSessionMiddleware(env) (cookie rss.sid, httpOnly, sameSite lax, secure en prod)
    PrismaSessionStore.ts  session.Store → table DashboardSession
  middleware/
    security.ts        en-têtes (CSP stricte self-only, X-Frame-Options DENY…)
    csrf.ts            csrfToken() + csrfProtection() (champ `_csrf` ou en-tête `x-csrf-token`)
    auth.ts            requireAuth, requireOwner, requireGuildAccess(client), refreshGuildsIfStale
    locals.ts          viewLocals(client) : variables communes à toutes les vues
    errors.ts          notFoundHandler, errorHandler (jamais de stack trace)
  lib/
    render.ts          render(res, 'page', data) → page dans le layout ; renderError()
    validate.ts        validate({ body, query, params }), valid(req), parseOrThrow(), schémas réutilisables
    access.ts          hasGuildAccess(), parsePermissions(), canManageGuild() (fonctions pures)
    guildData.ts       describeGuild(guild) → GuildView (salons/rôles triés pour les selects)
    navigation.ts      NAVIGATION (menu latéral), IMPLEMENTED_MODULE_PAGES / PENDING_MODULE_PAGES (vide : tout est implémenté), navHref()
    stats.ts           buildOverview(client, guild, config) (page dashboard + /api/…/overview)
    rateLimit.ts       createRateLimiter() (fenêtre glissante mémoire), wantsJson(req)
    flash.ts           flash(req, type, message) / takeFlash(req)
    format.ts          fmt.* (dates, nombres, durées, JSON), avatarUrl(), guildIconUrl()
    dates.ts           parseLocalDateTime(value, tz) / toLocalInputValue(date, tz) (champs datetime-local ↔ Date dans le fuseau du serveur)
    names.ts           resolveUserNames(client, guildId, ids) → { id: nom }, resolveUserProfiles() → { id: { name, avatarUrl } },
                       requireBotGuild(client, guildId) (503 lisible si bot absent)
    embedForm.ts       embedFormSchema / toEmbedSpec / buttonsJsonSchema / jsonArray / embedJsonSchema (formulaire d'embed → EmbedSpec)
    serviceErrors.ts   describeError(err) (TicketError, AnnouncementError, EmbedTemplateError, ModerationError, WhitelistError, SchoolError,
                       ShopError, FiveMError, BattleRoyaleError (codes → locales/fr/<module>.json errors.*), Zod, Discord → message FR),
                       formAction(back, fn) : handler de formulaire qui convertit toute erreur en flash + redirection
    async.ts           wrap(handler) pour les handlers async
    errors.ts          HttpError(status, message, details?)
    types.ts           augmentation SessionData / Express.Locals, SessionRequest
  routes/
    index.ts           mountRoutes(client) — ordre de montage des routeurs
    home.ts            GET /
    guilds.ts          GET /guilds
    admin.ts           GET /admin (+ POST reload-locales, invalidate-configs) — OWNER_IDS
    api.ts             /api/me, /api/guilds/:guildId/{overview,channels,roles,config,modules/:key}
    guild/
      dashboard.ts     GET /guilds/:guildId
      settings.ts      GET/POST /settings, POST /modules/:key, POST /commands
      logs.ts          GET /logs, POST /logs/channels
      members.ts       GET /members, GET /members/:userId
      tickets.ts       /tickets (liste, fiche, close/claim/delete, transcript protégé), /tickets/types (CRUD), /tickets/panels
      embeds.ts        /embeds (templates, éditeur, import/export JSON, envoi dans un salon)
      announcements.ts /announcements (colonnes par statut, éditeur, publish/schedule/duplicate/archive/delete, preview)
      welcome.ts       /welcome (bienvenue, départ, test)
      roles.ts         /roles (auto-roles, role menus + publication, notifications)
      reactionroles.ts /reaction-roles (liste, ajout avec réaction du bot, suppression)
      moderation.ts    /moderation (config warns, anti-raid, lockdown, sanctions, warnings, stats 30 j)
      giveaways.ts     /giveaways (liste, fiche, création, end/reroll/cancel)
      events.ts        /events (événements : CRUD, cancel, remind ; sondages : création, fin, résultats)
      fivem.ts         /fivem (serveurs FiveM : statut 🟢/🔴/🟠, joueurs, ajout/édition (clé API masquée), maintenance, test de connexion, encart API)
      whitelist.ts     /whitelist (dossiers par statut, recherche, fiche + accepter/refuser, identifiant FiveM ; configuration : questions, salon, rôles)
      battleroyale.ts  /battle-royale (classements wins/kills/level/kd par saison, profils + actions admin, saisons & Battle Pass avec paliers)
      school.ts        /school (config, élèves & profils paginés, classes, maisons + points, clubs + membres, candidatures)
      shop.ts          /shop (produits + aperçu, catégories, commandes paginées + transitions, historique client, stats 30 j, webhook Tebex)
      modules.ts       toggleModuleHandler(client) (partagé page + API)
      coming.ts        pages génériques « en cours d'intégration » (aucune entrée aujourd'hui : PENDING_MODULE_PAGES est vide, conservé pour un futur module)
  views/
    layouts/main.ejs   layout : <head>, sidebar, topbar, flash, <%- body %>, footer, toasts, modale
    partials/          sidebar, header, footer, flash, modal, pagination, channel-options, role-options, logo,
                       embed-preview (rendu façon Discord), embed-editor (formulaire complet + aperçu live), repeater / repeater-row (listes dynamiques)
    pages/             landing, guilds, dashboard, settings, logs, members, member, admin, coming, error, config-missing,
                       tickets, ticket, ticket-type, embeds, embed-form, announcements, announcement-form, announcement-preview, welcome,
                       roles, role-menu, reactionroles, moderation, giveaways, giveaway, events, event-form, poll,
                       fivem, whitelist, battleroyale, school, shop
  public/
    css/app.css        design system maison (variables CSS, sidebar 260 px, cartes, tableaux, formulaires, aperçu Discord, repeater…)
    js/app.js          api(), toast(), toggles de modules, modale de confirmation, filtres, onglets (imbriqués), toggles (check/radio),
                       pré-remplissage de formulaire, formulaire création/édition partagé (data-id-action), Socket.IO (toasts + actualisation des pages de modules)
    js/repeater.js     listes dynamiques [data-repeater] → JSON dans un champ caché (champs d'embed, boutons, questions, seuils, options)
    js/embed-editor.js aperçu live de l'éditeur d'embed, import/export JSON côté client, renderEmbedPreview()
    img/favicon.svg
```

Les vues et fichiers statiques sont copiés dans `dist/dashboard/` au build (`scripts/copy-assets.js`) ;
`lib/paths.ts` résout `views/` et `public/` relativement à `__dirname` (fonctionne en `tsx` comme en `dist`).

## Ajouter une page de module (ex. « Tickets »)

1. **Route** — créer `dashboard/routes/guild/tickets.ts` :
   ```ts
   import { Router } from 'express';
   import { z } from 'zod';
   import type { RedemptionClient } from '../../../src/core/Client';
   import { render } from '../../lib/render';
   import { wrap } from '../../lib/async';
   import { flash } from '../../lib/flash';
   import { validate, valid, discordIdSchema, stringArray, checkbox } from '../../lib/validate';
   import { broadcastToGuild } from '../../sockets';

   const createBody = z.object({ name: z.string().trim().min(1).max(50), channelId: discordIdSchema, staffRoleIds: stringArray });

   export function createTicketsRouter(client: RedemptionClient): Router {
     const router = Router({ mergeParams: true });           // ← obligatoire (guildId vient du parent)
     router.get('/tickets', wrap(async (req, res) => {
       const guild = res.locals.guild!;                      // GuildView (salons/rôles triés)
       const config = res.locals.config!;                    // ResolvedGuildConfig
       render(res, 'tickets', { title: 'Tickets', page: 'tickets', /* …données… */ });
     }));
     router.post('/tickets/types', validate({ body: createBody }), wrap(async (req, res) => {
       const { body } = valid<z.infer<typeof createBody>>(req);
       // … ticketService.createType(res.locals.guild!.id, body) …
       broadcastToGuild(res.locals.guild!.id, 'ticket:update', { guildId: res.locals.guild!.id });
       flash(req, 'success', 'Type de ticket créé.');
       res.redirect(`/guilds/${res.locals.guild!.id}/tickets`);
     }));
     return router;
   }
   ```
   `requireAuth` + `requireGuildAccess` sont déjà appliqués par le parent `/guilds/:guildId` : inutile de les répéter.
   Le CSRF est vérifié globalement : chaque `<form method="post">` contient `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`,
   et `api()` (JS) envoie l'en-tête automatiquement.

2. **Montage** — dans `dashboard/routes/index.ts`, ajouter `createTicketsRouter` dans `guildRouters` **avant** `createComingRouter`
   (le routeur « coming » sert la page générique pour toute entrée encore listée dans `PENDING_MODULE_PAGES`).
   Puis retirer la clé `tickets` de `PENDING_MODULE_PAGES` (ou laisser : la première route qui répond gagne).

3. **Vue** — créer `dashboard/views/pages/tickets.ejs`. La page est injectée dans le layout ; elle a accès à :
   `guild`, `config`, `user`, `isOwner`, `csrfToken`, `fmt`, `constants` (LANGUAGES, MODULE_LABELS, GUILD_KIND_LABELS, LOG_CATEGORY_LABELS),
   `avatarUrl`, `guildIconUrl`, `switcherGuilds`, `botReady` + les données passées à `render()`.
   Selects de salons/rôles : `<%- include('../partials/channel-options', { channels: guild.textChannels, selected, allowEmpty: true }) %>`
   et `<%- include('../partials/role-options', { roles: guild.roles, selected: [...] }) %>`.

4. **Menu** — l'entrée existe déjà dans `lib/navigation.ts` (`key: 'tickets'`). Passer `page: 'tickets'` à `render()` pour l'état actif.
   Pour une nouvelle entrée : ajouter `{ key, label, icon, path, module?, group }` dans `NAVIGATION`.

5. **Droits** — par défaut : accès serveur (owner / Administrator / ManageGuild + bot présent).
   Page globale : monter sous `/admin` ou utiliser `requireOwner`. Vérification plus fine (ex. staff) : lire `res.locals.config.staffRoleIds`.
   Pour l'API JSON : ajouter des routes dans `routes/api.ts` sous le routeur `guild` (déjà protégé).

6. **Temps réel** — émettre `client.bus.emit('ticket:open', { guildId, … })` depuis le service : l'événement est relayé
   dans la room `guild:<id>` (liste `RELAYED_BUS_EVENTS` dans `sockets.ts`, à compléter si besoin) ; ou appeler
   `broadcastToGuild(guildId, event, payload)` directement depuis une route. Côté client : `socket.on('ticket:open', …)` dans `app.js`
   (table `MODULE_EVENTS` : `fivem:status`, `shop:order`, `whitelist:update`, `school:update`, `br:update`… → toast + actualisation de la page du module).

## Formulaires de modules : helpers

- **`formAction(back, fn)`** (`lib/serviceErrors.ts`) : enveloppe un POST de formulaire. `fn` retourne éventuellement l'URL de redirection ;
  toute erreur (HttpError, ZodError, TicketError, AnnouncementError, EmbedTemplateError, ModerationError, DiscordAPIError, Error « métier ») est
  convertie en message flash lisible puis redirigée vers `back(req, res)` (ou en JSON si la requête le demande).
- **Éditeur d'embed** : `<%- include('../partials/embed-editor', { prefix: 'embed', spec, id: 'xxx', buttons, buttonsName: 'buttonsJson', contentSource: '#textarea' }) %>`
  côté vue ; côté route `embed: embedFormSchema` + `buttonsJson: buttonsJsonSchema` dans le schéma Zod puis `toEmbedSpec(body.embed)`.
  `buttons: null` masque la section boutons ; `withPreview` / `withJson` / `compact` sont optionnels.
- **Aperçu Discord** : `<%- include('../partials/embed-preview', { embed, buttons, content, compact }) %>` (même balisage que `renderEmbedPreview()` en JS).
- **Listes dynamiques** : `<%- include('../partials/repeater', { kind, rows, name: 'xxxJson', id: 'xxx-json', max, addLabel, roles? }) %>` ;
  kinds disponibles dans `partials/repeater-row.ejs` (`field`, `button`, `question`, `threshold`, `option`, `polloption`, `tier`). Côté route : `jsonArray(schema, max)`.
- **Formulaire création / édition partagé** : `<form data-id-action="/guilds/:id/school/classes">` + `<input type="hidden" name="id">` + boutons `data-fill-form` avec `data-set-id` :
  à l'envoi, l'action devient `/base/<id>` si un id est pré-rempli (route POST `/base/:id`), sinon `/base` (création) ; `type="reset"` revient en mode création.
- **Dates** : `<input type="datetime-local">` → `parseLocalDateTime(value, config.timezone)` ; pré-remplissage avec `toLocalInputValue(date, config.timezone)`.
- **Actions Discord** : `requireBotGuild(client, guildId)` lève un 503 lisible si le bot n'est pas prêt ; les vues désactivent les boutons quand `!botReady`.
- **Attributs JS supplémentaires** : `data-check-toggle="#cible"` / `data-check-hide="#cible"` (case à cocher), `data-radio-toggle="#cible"` (radio),
  `data-fill-form="#form"` + `data-set-<champ>="valeur"` (pré-remplissage), `data-tab-param="lang"` (onglets imbriqués avec leur propre paramètre d'URL).
- **Méthodes de service manquantes** : quand un service n'expose pas l'opération (ex. édition d'une classe / maison / club / catégorie, suppression d'un profil School,
  déliaison d'un identifiant BR, édition des paliers d'un Battle Pass, liste paginée des commandes / profils), la route écrit via `prisma` directement
  (commentaire `// Pas de méthode …` dans la route) — ces services n'ont pas de cache sur ces entités, donc aucune invalidation nécessaire.

## Conventions

- Handlers async : toujours `wrap(async (req, res) => …)`.
- Entrées : toujours `validate({ body, query, params })` + `valid(req)` (ou `parseOrThrow(schema, data)`). Erreur → 400 lisible (page ou JSON).
- Erreurs métier : `throw new HttpError(404, 'Ticket introuvable.')`.
- Après un POST de formulaire : `flash(req, 'success' | 'error', msg)` puis `res.redirect(...)`.
- Réponses JSON (fetch) : `res.json({ ok: true, ... })` ; les erreurs passent par `errorHandler` (`{ error, details? }`).
- Actions destructives : bouton `.btn-danger` + attribut `data-confirm="Texte…"` (modale gérée par `app.js`).
- Textes UI en français, pas de CDN externe, pas de style inline (CSP) : utiliser des classes ou des `data-*` lus par `app.js`.

## Classes CSS principales

`.card`, `.card-head`, `.card-title`, `.page-header`, `.page-title`, `.page-actions`, `.grid-2`, `.stat-grid` / `.stat-card`,
`.table-wrap` / `.table` / `.table-compact`, `.badge` (`-primary`, `-muted`, `-danger`), `.btn` (`-primary`, `-ghost`, `-danger`, `-sm`, `-lg`, `-block`),
`.field` / `.input` / `.select` / `.textarea` / `.check` / `.switch`, `.kv-grid` / `.kv-row`, `.filter-bar`, `.form-actions`,
`.alert-{success|error|warning|info}`, `.tabs` (`data-tabs`, `data-tab`, `data-tab-panel`), `.bars` / `.bar-fill[data-pct]`, `.pagination` (partial).

Attributs JS : `data-filter="#table"` + `data-filter-item`, `data-confirm`, `data-module-toggle`, `data-color-input` / `data-color-text`,
`data-toggle-target` / `data-toggle-value`, `data-submit-on-change`, `data-stat="…"` (rafraîchi via `/api/guilds/:id/overview`).

## Sécurité

- CSP : `default-src 'self'`, images depuis le CDN Discord uniquement, `frame-ancestors 'none'`.
- CSRF sur toutes les mutations sauf `/api/fivem` et `/api/shop` (auth par clé dans leur routeur, montés avant la session).
- Rate limit (avant la session, donc par IP) : `/auth` 30 req / 5 min, `/api` 120 req / min (hors `/api/fivem` et `/api/shop` qui ont le leur).
- Sessions : store Prisma (`DashboardSession`), 7 jours glissants, purgées par la tâche `core:prune-sessions`.
- OAuth2 : scopes `identify guilds`, `state` aléatoire en session, `accessToken` jamais exposé au navigateur, liste des serveurs rafraîchie après 10 min.
