# Dashboard web — Redemption Story Studio

Express 4 + EJS + Socket.IO, authentification Discord OAuth2 (sans passport), sessions Prisma, CSRF, Zod.
Point d'entrée : `startDashboard(client)` dans `server.ts` (appelé par `src/index.ts`).
Toute la logique métier reste dans les services de `src/` : le dashboard ne fait que valider, appeler les services et afficher.

## Arborescence

```
dashboard/
  server.ts / app.ts / sockets.ts   serveur HTTP + Socket.IO, middlewares, broadcastToGuild()
  auth/                oauth.ts, routes.ts (/auth/login|callback|logout), session.ts, PrismaSessionStore.ts
  middleware/
    security.ts        en-têtes (CSP stricte self-only, X-Frame-Options DENY…)
    csrf.ts            champ `_csrf` ou en-tête `x-csrf-token` sur toute mutation
    auth.ts            requireAuth, requireOwner, requireGuildAccess(client)
    locals.ts          variables communes aux vues (voir « Variables de vue »)
    errors.ts          404 / erreurs (jamais de stack trace)
  lib/
    render.ts          render(res, 'page', data) → page dans layouts/main.ejs
    validate.ts        validate({ body, query, params }) + valid(req), schémas réutilisables
    navigation.ts      NAVIGATION (menu groupé), buildSidebar(), buildBreadcrumbs(), navHref()
    modules.ts         MODULE_INFO (libellé, icône, description, groupe, page), groupedModules(), GUILD_KIND_INFO
    icons.ts           jeu d'icônes SVG inline (trait 1.75) : icon(name, { size, cls, label })
    discordPreview.ts  moteur d'aperçu Discord côté serveur (même fichier que le navigateur : public/js/discord-preview.js)
    servicePreview.ts  EmbedBuilder / ActionRowBuilder des services → message d'aperçu ; renderPreviewHtml(res, message, users)
    logs.ts            métadonnées des catégories de logs, logTitle() / logIcon()
    stats.ts           buildOverview() (vue d'ensemble + /api/…/overview), onlineCount()
    ticketStats.ts     statistiques tickets en lecture seule (1re réponse, activité 14 j, top staff)
    fivemPlayers.ts    liste paginée des joueurs FiveM connus (lecture seule)
    embedForm.ts       formulaire d'embed → EmbedSpec (embedFormSchema, toEmbedSpec, buttonsJsonSchema, jsonArray)
    serviceErrors.ts   formAction(back, fn) : erreurs métier → flash lisible + redirection
    names.ts           resolveUserNames(), resolveUserProfiles(), requireBotGuild()
    dates.ts, format.ts, flash.ts, async.ts, errors.ts, access.ts, guildData.ts, rateLimit.ts, types.ts
  routes/              index.ts (montage), home, guilds, admin, api, guild/<module>.ts
  views/
    layouts/main.ejs   shell : sidebar groupée + topbar (fil d'Ariane, indicateur live) ou en-tête public
    partials/          composants (voir plus bas)
    pages/             une vue par page
  public/
    css/app.css        design system complet (un seul fichier, sections numérotées)
    js/                app.js (cœur), pickers.js, repeater.js, embed-editor.js, discord-preview.js, live-preview.js,
                       modal-preview.js + scripts de page (tickets, welcome, roles, announcements, settings, fivem)
```

## Design system (`public/css/app.css`)

**Tokens** (`:root`) — fond `--bg #0a0a0c`, surfaces `--surface #121216` / `--surface-2 #18181d` / `--surface-3`, bordures `--border #26262c`,
texte `--text #f4f4f5` / `--text-2 #a1a1aa` / `--text-3 #71717a`, accent `--accent #7c3aed` (`--accent-hover #8b5cf6`, `--accent-subtle`),
`--success #22c55e`, `--danger #ef4444`, `--warning #f59e0b` (+ `-subtle`, `-border`, `-text`). Espacements `--space-1…7` (4/8/12/16/24/32/48),
rayons `--radius-sm|--radius|--radius-lg` (8/12/16), transitions `--dur` 120–180 ms, police système. Alias historiques : `--primary`, `--muted`.

**Composants** (classes) :

| Famille | Classes |
| --- | --- |
| Mise en page | `.page-header` `.page-heading` `.page-icon` `.page-title` `.page-subtitle` `.page-actions` `.back-link` · `.grid-2/3/4` `.grid-aside-right` (contenu + 340 px) `.grid-aside-wide` (liste + fiche) `.grid-2-aside` · `.split` + `.split-preview` (formulaire + aperçu collant) · `.stack` `.stack-1…5` `.row` `.row-wrap` `.toolbar` |
| Boutons | `.btn` + `-primary` `-secondary` `-ghost` `-outline` `-danger` `-success` `-sm` `-lg` `-block` `-icon` `.is-loading` · `.icon-btn` (`.is-danger`) · `.btn-danger-text` |
| Formulaires | `.field` `.field-row` `.field-required` `.field-optional` `.hint` · `.input` `.select` `.textarea` `.search` · `.toggle` · `.toggle-list` > `.toggle-row` (titre + aide + interrupteur) · `.check` · `.segmented` (`-block`, liens ou radios, `.seg-count`) · `.chip-group` > `.chip-toggle` · `.color-field` · `.form-actions` `.sticky-actions` `.btn-row` |
| Onglets | `.tabs-nav` (partial `tabs`), `.tab-count` |
| Cartes | `.card` (`-flush`, `-compact`, `-muted`, `-accent`, `-danger`, `-collapsible` sur `<details>`) `.card-head` `.card-title` `.card-desc` · `.subcard` · `.sheet` (fiche collante) · `.panel-list` > `.panel-card` · `.stat-grid` > `.stat` |
| Données | `.table` (`-responsive` → cartes < 640 px avec `data-label`, `-clickable` + `tr[data-href]`, `-compact`) `.cell-primary` `.cell-stack` · `.list` `.list-item*` `.list-compact` · `.dl` (`-compact`) · `.bars` `.bar-row` `.bar-fill[data-pct]` · `.meter` · `.histo` (`-dense`) + `.histo-bar[data-h]` · `.steps` (étapes numérotées) · `.snippet` (code + copier) |
| Statuts | `.badge` (`-success` `-warning` `-danger` `-accent` `-info` `-muted`, `.badge-status-<STATUT>`) · `.dot` (`-success` …) · `.role-pill` `.role-dot` · `.channel-tag` · `.chip` · `.avatar` (`-xs` … `-xl`, `-fallback`) |
| Retours | `.alert-{info,success,warning,danger}` · `.callout` · `.empty` (partial `empty`) · `.skeleton` · toasts · modale de confirmation · `[data-tooltip]` · `.dropdown` |
| Aperçus Discord | `.preview-panel` (`-head`, `-body`, `-note`) · `.dpreview` `.dmsg` `.dembed*` `.dbtn-*` `.dselect` `.dmodal` `.dmember` `.dchannel-row` |

Couleurs dynamiques sans style inline (CSP) : `data-embed-color`, `data-role-color`, `data-color` + `data-color-bg`, `data-pct`, `data-h` (appliqués par `UI.paint`).

## Partials (`views/partials/`)

- `icon` · `tabs` ({ tabs: [{ key, label, href, icon, count }], active }) · `empty` ({ glyph, title, text, actionHref, actionLabel, actionIcon, compact }) · `pagination`
- `role-select` ({ name, id, selected, multiple = true, emptyLabel, placeholder, includeManaged, required }) · `channel-select` ({ name, id, selected, kind: text|voice|category|all, emptyLabel, required }) · `color-field`
- `embed-editor` ({ prefix, spec, id, buttons, buttonsName, withPreview, previewTarget, contentSource, withJson, compact, withFields }) · `embed-preview` ({ embed, buttons, content, components, compact, ephemeral })
- `repeater` / `repeater-row` (kinds `field`, `button`, `option`, `polloption`, `threshold`, `tier`) · `question-row` (question de modale, `withMaxLength`, `defaultStyle`)
- En-têtes de section : `tickets-header`, `roles-header`, `events-header` · shell : `sidebar`, `topbar`, `site-header`, `user-menu`, `footer`, `toasts`, `modal`, `dirty-bar`

## JavaScript (`public/js/`)

`window.UI` = `{ $, $$, api(method, url, data), toast(msg, type), paint(root), enhance(root), onEnhance(fn), guildData(), previewContext(), sortable(), confirm(), markClean(form), icon() }`.
`api()` envoie le jeton CSRF ; les données du serveur courant (rôles, salons, bot) sont dans `<script id="guild-data" type="application/json">`.

Attributs déclaratifs (app.js) : `data-dirty-form` (barre « modifications non enregistrées », `.dirty-hide`), `data-confirm` (+ `-title`, `-label`, `-variant`),
`data-dropdown`, `data-filter` + `data-filter-item`, `tr[data-href]`, `data-copy`, `data-color-picker`, `data-toggle-target`, `data-check-toggle` / `data-check-hide`,
`data-radio-toggle`, `data-fill-form` + `data-set-<champ>`, `form[data-id-action]` (création / édition partagée), `data-submit-on-change`, `data-module-toggle`,
`data-toggle-url` (bascule JSON instantanée), `data-sortable` + `data-sortable-url`, `data-insert-target` + `data-insert` (variables), `data-stat`, `data-live-reload`,
`<details id>` ouvert par l'ancre de l'URL.

Autres modules : `pickers.js` (sélecteurs rôles / salons / multi améliorés, le `<select>` natif reste la source du POST) · `repeater.js` (listes → JSON caché,
glisser-déposer, `repeater:change`) · `embed-editor.js` (aperçu live, import/export JSON, `embed:change`) · `discord-preview.js` (rendu Discord partagé
serveur/navigateur : markdown, mentions, embeds, boutons, menus, modales) · `live-preview.js` (`form[data-live-preview="url"][data-live-preview-target]` :
aperçu calculé par le serveur) · `modal-preview.js` (`[data-modal-live="#repeater"]`).

## Aperçus Discord

1. **Client** : `DiscordPreview.render(message, UI.previewContext())` (embed-editor, bienvenue, menus de rôles, annonces, tickets).
2. **Serveur, mêmes constructeurs que le bot** : pour les messages construits par un service (`eventService.buildEmbed`, `pollService.buildEmbed`,
   `giveawayService.buildEmbed`, `buildProductAnnouncement`, `buildOrderSummary`, `whitelistService.buildReviewEmbed`…) :
   `renderPreviewHtml(res, serviceMessagePreview({ embeds, components }))`. Les brouillons passent par une route `POST …/preview` (JSON + CSRF,
   entité fictive, rien n'est enregistré) appelée par `live-preview.js` : `/events/preview`, `/events/polls/preview`, `/giveaways/preview`, `/shop/products/preview`.
3. Images : seules celles du CDN Discord et `data:image` s'affichent (CSP) ; les autres affichent un emplacement avec le domaine.
   `POST /welcome/image` renvoie l'image de bienvenue (WelcomeImageService) en data URL.

## Ajouter une page

1. **Route** `routes/guild/<module>.ts` : `Router({ mergeParams: true })` ; handlers `wrap(...)` ; entrées `validate({ body, query, params })` + `valid(req)` ;
   mutations de formulaire via `formAction(back, fn)` (erreur → flash + redirection) puis `broadcastToGuild(guildId, event, payload)`.
   `requireAuth` + `requireGuildAccess` sont appliqués par le parent `/guilds/:guildId`. Ajouter le routeur dans `routes/index.ts` (`guildRouters`).
2. **render** : `render(res, 'page', { title, page: '<clé nav>', crumbs: [{ label, href? }], layout: 'wide'?, scripts: ['nom-js']?, ...données })`.
   Onglets côté serveur : `?tab=` validé par Zod + partial `tabs` (pas d'onglets JS).
3. **Vue** `views/pages/<page>.ejs` : `<header class="page-header">` avec `.page-icon`, puis contenu. Chaque `<form method="post">` contient
   `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`. Sélecteurs : partials `role-select` / `channel-select`. État vide : partial `empty`.
4. **Menu** : entrée dans `lib/navigation.ts` (`{ key, label, icon, path, module?, group }`) ; les modules de jeu désactivés passent sous « Autres modules ».
5. **Script de page** éventuel : `public/js/<nom>.js` (IIFE, aucun inline), déclaré via `scripts: ['<nom>']`.

**Variables de vue** : `guild` (GuildView : rôles, salons triés, catégories), `config`, `user`, `isOwner`, `csrfToken`, `botReady`, `botUser`, `fmt`, `icon()`,
`discordPreview`, `previewContext()`, `jsonScript(value)`, `brand`, `constants` (LANGUAGES, MODULE_LABELS, MODULE_INFO, TEMPLATE_VARIABLES, EMBED_COLOR_PALETTE…), `page`, `crumbs`, `scripts`.

## Pages et routes notables

- **Tickets** (`/tickets`) : Raisons (liste triable, `POST /tickets/reasons/order`, `/:typeId/toggle`, `/defaults`), éditeur de raison (`/tickets/reasons/new`,
  `/tickets/reasons/:typeId` : général, ouverture, accès, formulaire avec aperçu de la modale, message d'accueil), Panneaux (`/tickets/panels`,
  `/:panelId/republish`, `/:panelId/delete`), Relances (`/tickets/reminders`, `/tickets/:id/permanent`), Tickets (`/tickets/list`, fiche `/tickets/:id` +
  close / claim / delete, transcript en iframe `sandbox` `/tickets/:id/transcript/:format`), Statistiques (`/tickets/stats`).
- **Événements** : `/events`, `/events?tab=polls`, `/giveaways` (en-tête commun) ; création `/events/new`, `/events/polls/new`, `/giveaways/new` avec aperçu serveur.
- **FiveM** : `/fivem` (Serveurs · Joueurs · Installation rs_bridge), fiche `?server=<clé>&stab=overview|settings|sync`,
  `POST /fivem/servers/:key/sync` (→ `fivemSyncService.updateSyncSettings`), `POST /fivem/players/link` (→ `linkManually`), `/fivem/new`.
- **Modération** : onglets sanctions, avertissements, escalade, protections (anti-raid / anti-nuke), salon piège (`/moderation/honeypot/{setup,toggle,remove}`), lockdown, stats.
- **Whitelist / School / Shop / Battle Royale** : onglets serveur, fiches maître/détail (`?id=`, `?user=`, `?app=`, `?order=`), formulaires latéraux.

Accès direct à Prisma (lecture seule sauf mention) quand un service n'expose pas l'opération : `lib/ticketStats.ts`, `lib/fivemPlayers.ts`,
listes paginées School / Shop, et écritures commentées `// Pas de méthode …` dans school.ts, shop.ts, battleroyale.ts.

## Conventions

- Textes en français ; textes envoyés sur Discord via `translationService` (langue du serveur).
- Pas de CDN, pas de script ni de style inline : classes + `data-*` lus par `app.js`.
- Actions destructives : `data-confirm`. Boutons nécessitant le bot : désactivés si `!botReady`.
- Réponses JSON : `{ ok: true, ... }` ; erreurs `{ error, details? }`.

## Sécurité

- CSP : `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:` + CDN Discord, `frame-ancestors 'none'`
  (le transcript HTML servi en iframe ajoute `frame-ancestors 'self'` et `X-Frame-Options: SAMEORIGIN` sur sa seule réponse).
- CSRF sur toutes les mutations (formulaires et `fetch`), sauf `/api/fivem` et `/api/shop` (clé dans leur routeur).
- Rate limit : `/auth` 30 req / 5 min, `/api` 120 req / min.
- Sessions Prisma (7 jours glissants) ; OAuth2 `identify guilds`, `state` aléatoire, jeton jamais exposé au navigateur.
- Clés API FiveM masquées (`••••1234`), secrets Tebex jamais affichés.

## Tests et vérifications

`npx tsc -p tsconfig.json --noEmit` · `npx vitest run` (tests du dashboard dans `tests/dashboard/`) · `node --check dashboard/public/js/*.js`.
