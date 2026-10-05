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
    navigation.ts      NAVIGATION (menu par intention), buildSidebar() (pertinence par type de serveur), buildBreadcrumbs(),
                       navGroupLabel() (sur-titres), paletteEntries() (palette Ctrl+K)
    modules.ts         MODULE_INFO (libellé, icône, description, groupe, page), groupedModules(), GUILD_KIND_INFO
    icons.ts           jeu d'icônes SVG inline (trait 1.75) : icon(name, { size, cls, label })
    charts.ts          modèles de graphiques (dayAxis, bucketByDay, niceScale, mirrorChart, lineChart, hbarsChart)
    overview.ts        vue d'ensemble : buildSetupSteps() (liste de mise en route), buildOverviewCharts() (30 jours)
    discordPreview.ts  moteur d'aperçu Discord côté serveur (même fichier que le navigateur : public/js/discord-preview.js)
    servicePreview.ts  EmbedBuilder / ActionRowBuilder des services → message d'aperçu ; renderPreviewHtml(res, message, users)
    logs.ts            métadonnées des catégories de logs, logTitle() / logIcon()
    stats.ts           buildOverview() (chiffres clés + /api/…/overview), onlineCount()
    access.ts          hasGuildAccess(), manageableGuilds(), isGuildAdmin() (actions sensibles : propriétaire / Administrator)
    ticketStats.ts, fivemPlayers.ts, embedForm.ts, serviceErrors.ts (formAction), names.ts, dates.ts, format.ts, flash.ts…
  routes/              index.ts (montage), home, guilds, admin, api, guild/<module>.ts (dont permissions.ts)
  views/
    layouts/main.ejs   shell : rail latéral + barre supérieure, ou en-tête public ; palette de commandes
    partials/          composants (voir plus bas)
    pages/             une vue par page
  public/
    css/app.css        design system complet (un seul fichier, plan + tokens en tête, sections numérotées)
    fonts/             polices auto-hébergées (woff2 latin + latin-ext) + licences OFL
    js/                theme.js (synchrone, <head>), app.js (cœur), palette.js, charts.js, pickers.js, repeater.js,
                       embed-editor.js, discord-preview.js, live-preview.js, modal-preview.js + scripts de page
                       (tickets, welcome, roles, announcements, settings, fivem, moderation)
```

## Design system (`public/css/app.css`)

**Concept** : « régie de studio ». Rail sombre à gauche, plateau de contenu découpé en **sections séparées par des filets**
(pas de carte sur chaque bloc), panneaux détachés uniquement pour ce qui flotte ou se manipule (tableaux de données, aperçus,
fiches, tuiles). Violet = action principale, sélection, état actif. **Rouge = alertes et actions destructrices uniquement.**

**Polices** (auto-hébergées, CSP `font-src 'self'`, `font-display: swap`, piles de repli système) :
- **Archivo** (variable, étirée à 118 %) : affichage, avec retenue — titres de page, marque, code d'erreur.
- **IBM Plex Sans** 400/500/600 : texte de l'interface.
- **IBM Plex Mono** 400/500 : données (IDs, clés, valeurs, actions de log) et sur-titres en capitales.
Échelle : 11 · 12 · 13 · 14 · 16 · 18 · 22 · 28 · 44 (`--fs-micro` … `--fs-3xl`). Titres en `text-wrap: balance` ;
chiffres tabulaires dans les colonnes (`.table td`, `.tabular`, axes), chiffres proportionnels pour les grands nombres.

**Thèmes** : sombre par défaut ; clair via `prefers-color-scheme: light` quand rien n'est choisi, ou choix explicite
(menu du compte : Sombre / Clair / Auto) → `data-theme` sur `<html>`, mémorisé en `localStorage` (`rs-theme`, try/catch),
appliqué avant le premier rendu par `public/js/theme.js`. Les définitions complètes sont sur `:root` (sombre), redéfinies sous
`@media (prefers-color-scheme: light) :root:not([data-theme="dark"])` et `:root[data-theme="light"]`.
Les aperçus Discord restent dans les couleurs du client Discord (sombre) dans les deux thèmes.

**Tokens** (`:root`) :

| Rôle | Tokens |
| --- | --- |
| Plans | `--bg` (plateau) · `--bg-rail` (rail) · `--surface` (panneaux) · `--surface-2` · `--surface-3` (survol) · `--field` (champs) · `--overlay` · `--scrim` |
| Filets | `--line` · `--line-soft` · `--line-strong` |
| Encre | `--text` · `--text-2` · `--text-3` · `--on-accent` |
| Identité | `--accent` (#7c3aed sombre / #6d28d9 clair) · `--accent-hover` · `--accent-press` · `--accent-text` · `--accent-soft` · `--accent-softer` · `--accent-line` |
| Sémantique | `--ok*` · `--warn*` · `--danger*` (variantes `-text`, `-soft`, `-line`) — distinctes de l'accent |
| Graphiques | `--series-1/2/3` (palette catégorielle validée avec `validate_palette.js`, sombre `#8f75f0,#2aa889,#d26a3a` sur `#131017`, clair `#6a4bd6,#16896d,#c8661f` sur `#fff`) · `--chart-grid` · `--chart-axis` |
| Typo | `--font-display` · `--font-text` · `--font-mono` · `--display-stretch` · `--fs-*` |
| Espace / forme | `--s-1…8` (4 → 64) · `--gutter` (40 → 24 → 16 px) · `--r-xs` 4 · `--r-sm` 6 · `--r-md` 10 · `--r-full` |
| Ombres | `--shadow-pop`, `--shadow-float` (éléments flottants seulement) · `--focus` (anneau clavier) |
| Mouvement | `--ease`, `--dur-fast/--dur/--dur-slow` (désactivés par `prefers-reduced-motion`) |

**Composants** (classes) :

| Famille | Classes |
| --- | --- |
| Mise en page | `.page-header` `.page-heading` `.eyebrow` (partial `eyebrow`) `.page-title` `.page-subtitle` `.page-actions` `.back-link` · `.with-toc` + `.toc[data-toc]` + `.toc-section` (sommaire collant, onglets horizontaux sur mobile) · `.split` + `.split-preview` · `.grid-2/3/4` `.grid-aside-right` `.grid-aside-wide` · `.stack*` `.row*` `.toolbar` `.section-head` |
| Sections / panneaux | `.card` = **section à filet** (pas de boîte) · `.card-flush` (panneau de données) · `.card-muted` `.card-danger` `.card-collapsible` · `aside.card`, `.sheet`, `.subcard`, `.panel` = panneaux · `.card-head` `.card-title` `.card-desc` `.card-foot` |
| Chiffres clés | `.stat-grid` > `.stat` : **un seul bandeau** divisé par des filets ; `.stat-label` (mono) `.stat-value` `.stat-sub` ; `.is-warn` / `.is-alert` (liseré de sévérité) |
| Boutons | `.btn` + `-primary` (violet) `-secondary` `-ghost` `-outline` `-danger` `-success` `-discord` `-sm` `-lg` `-block` `-icon` `.is-loading` · `.icon-btn` |
| Formulaires | `.field` `.hint` `.input` `.select` `.textarea` `.search` · `.toggle` · `.segmented` (sélection en violet) · `.choice` · `.check` · `.color-field` · `.form-actions` `.form-footer` |
| Statuts | `.badge` (`-success` `-warning` `-danger` = pastille pleine ; `badge-status-<STATUT>` : pleine = en cours, anneau = terminé, losange = échec) · `.dot` · `.role-pill` · `.level-pill` · `.chip` · `.channel-tag` · `.avatar*` |
| Données | `.table` (`-responsive` → cartes < 640 px, `-clickable`, `-compact`) · `.list` · `.timeline` · `.dl` · `.bars` · `.meter` · `.steps` · `.snippet` |
| Graphiques | partials `chart-mirror`, `chart-line`, `chart-hbars` (`.chart` `.chart-head` `.chart-figures` `.chart-frame` `.chart-plot` `.chart-tip` `.chart-table`) |
| Vue d'ensemble | `.setup-list` > `.setup-item.is-done` (mise en route) · `.status-list` · `.overview-grid` |
| Permissions | `.perm-explain` `.perm-cat` `.perm-list` > `.perm-item` (`<details>` = édition en ligne) `.perm-bulk` |
| Zone sensible | `.danger-zone` > `.danger-row` (+ `.unban-progress`) |
| Retours | `.alert-{info,success,warning,danger}` · `.callout` · `.empty` (partial `empty`) · toasts · modale de confirmation (`data-confirm-type` = mot à taper) · `[data-tooltip]` · `.dropdown` · palette `.palette` |
| Aperçus Discord | `.preview-panel` (`-head`, `-body`, `-note`) · `.dpreview` `.dmsg` `.dembed*` `.dbtn-*` `.dselect` `.dmodal` `.dmember` `.dchannel` |

Couleurs et positions dynamiques sans style inline (CSP) : `data-embed-color`, `data-role-color`, `data-color` + `data-color-bg`,
`data-pct`, `data-h`, `data-left` / `data-top` (étiquettes de graphiques) — appliqués par `UI.paint`.

## Graphiques

Rendu serveur : `lib/charts.ts` calcule le modèle (une seule échelle « ronde », graduations entières, colonnes centrées sur les jours),
le partial dessine un SVG `preserveAspectRatio="none"` (traits `vector-effect="non-scaling-stroke"`, barres ≤ 24 px à extrémité
arrondie de 4 px ancrée à la ligne de base, lignes 2 px, points de fin 8 px avec anneau) et des étiquettes HTML (axes, valeurs).
`public/js/charts.js` ajoute l'infobulle (réticule sur les courbes, mise en avant de la colonne survolée, flèches ← → au clavier).
Légende dès 2 séries, étiquettes directes sélectives (omises si elles se chevauchent), tableau « Voir les données » sur chaque graphique.
Couleurs : `--series-1/2/3` uniquement (texte toujours en tokens d'encre). Toute nouvelle couleur de série doit passer
`node …/dataviz/scripts/validate_palette.js "<hex,…>" --mode dark --surface "#131017"` puis `--mode light --surface "#ffffff"`.

## Partials (`views/partials/`)

- Shell : `sidebar`, `topbar`, `site-header`, `user-menu` (thème), `footer`, `toasts`, `modal`, `dirty-bar`, `palette`, `eyebrow` ({ eyebrowText? })
- `icon` · `tabs` ({ tabs: [{ key, label, href, icon, count }], active }) · `empty` ({ glyph, title, text, actionHref, actionLabel, actionIcon, compact }) · `pagination`
- `role-select` · `channel-select` · `color-field` · `embed-editor` · `embed-preview` · `repeater` / `repeater-row` · `question-row`
- Graphiques : `chart-mirror` ({ chart, title, sub, emptyText }) · `chart-line` ({ chart, title, sub, emptyText, extraFigure? }) · `chart-hbars` ({ chart, title, sub, emptyText, unit })
- En-têtes de section : `tickets-header`, `roles-header`, `events-header`

## JavaScript (`public/js/`)

`window.UI` = `{ $, $$, api(method, url, data), toast(msg, type), paint(root), enhance(root), onEnhance(fn), guildData(), previewContext(), sortable(), confirm(), markClean(form), icon(), setTheme(t) }`.
`api()` envoie le jeton CSRF ; les données du serveur courant (rôles, salons, bot) sont dans `<script id="guild-data" type="application/json">`.

Attributs déclaratifs (app.js) : `data-dirty-form` (barre « modifications non enregistrées », `.dirty-hide`), `data-confirm` (+ `-title`, `-label`,
`-variant`, `-type` : mot à taper, recopié dans le champ `[data-confirm-target]` du formulaire), `data-dropdown`, `data-filter` + `data-filter-item`,
`tr[data-href]`, `data-copy`, `data-color-picker`, `data-toggle-target`, `data-check-toggle` / `data-check-hide`, `data-radio-toggle`,
`data-fill-form` + `data-set-<champ>`, `form[data-id-action]`, `data-submit-on-change`, `data-module-toggle`, `data-toggle-url`,
`data-sortable` + `data-sortable-url`, `data-insert-target` + `data-insert`, `data-stat`, `data-live-reload`, `data-theme-set`,
`[data-toc]` (section active au défilement), `data-scroll-to="<id>"` (section ciblée à l'arrivée), `<details id>` ouvert par l'ancre.

Palette de commandes (`palette.js`) : Ctrl+K / ⌘K ou `[data-palette-open]` ; pages, réglages profonds (`lib/navigation.ts` → `PALETTE_SHORTCUTS`),
autres serveurs, thème, déconnexion. Rendu en `textContent`, recherche sans accents.

## Navigation

Groupes par intention : Vue d'ensemble · **Communauté** (Bienvenue et départs, Rôles, Annonces, Embeds, Événements, Salons vocaux) · **Support** (Tickets) ·
**Sécurité** (Modération, Logs) · **Jeu** (Serveurs FiveM, Battle Royale, Whitelist, School RP, Boutique) · **Serveur** (Membres, Permissions, Paramètres).
Un module de jeu n'apparaît dans « Jeu » que s'il est recommandé pour le type de serveur (`DEFAULT_MODULES_BY_KIND`) ou déjà activé ; sinon il est
rangé sous « Autres modules ». Un module coupé reste visible avec l'étiquette « off ».

## Créer une page

1. **Route** `routes/guild/<module>.ts` : `Router({ mergeParams: true })` ; handlers `wrap(...)` ; entrées `validate({ body, query, params })` + `valid(req)` ;
   mutations de formulaire via `formAction(back, fn)` (erreur → flash + redirection) puis `broadcastToGuild(guildId, event, payload)`.
   `requireAuth` + `requireGuildAccess` sont appliqués par le parent `/guilds/:guildId`. Ajouter le routeur dans `routes/index.ts` (`guildRouters`).
2. **render** : `render(res, 'page', { title, page: '<clé nav>', crumbs: [{ label, href? }], layout: 'wide'?, scripts: ['nom-js']?, ...données })`.
   Onglets côté serveur (`?tab=` validé par Zod + partial `tabs`) seulement pour des listes d'objets distinctes ; pour des réglages,
   **une seule page** à sections empilées avec sommaire collant (`.with-toc`, `nav.toc[data-toc]`, sections `.card.toc-section` avec `id`).
3. **Vue** `views/pages/<page>.ejs` : `<header class="page-header"><div class="page-heading"><div><%- include('../partials/eyebrow') %><h1 class="page-title">…`.
   Chaque `<form method="post">` contient `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`. Une aide d'une ligne (`.hint`) sous chaque réglage.
   Sélecteurs : partials `role-select` / `channel-select`. État vide : partial `empty`. Message configuré → aperçu Discord en direct (`.split-preview`).
4. **Menu** : entrée dans `lib/navigation.ts` (`{ key, label, icon, path, module?, group, keywords? }`) ; raccourcis profonds dans `PALETTE_SHORTCUTS`.
5. **Script de page** éventuel : `public/js/<nom>.js` (IIFE, aucun inline), déclaré via `scripts: ['<nom>']`.
6. Rédaction : français simple, noms que l'utilisateur connaît, boutons qui disent ce qu'ils font, toasts qui confirment (« Enregistré »),
   erreurs qui disent quoi faire.

**Variables de vue** : `guild` (GuildView : rôles, salons triés, catégories), `config`, `user`, `isOwner`, `csrfToken`, `botReady`, `botUser`, `fmt`, `icon()`,
`kindLabel()`, `navGroupLabel()`, `paletteEntries()`, `discordPreview`, `previewContext()`, `jsonScript(value)`, `brand`, `constants`, `page`, `crumbs`, `scripts`.

## Pages et routes notables

- **Vue d'ensemble** (`/guilds/:id`) : état (bot, lockdown, serveurs FiveM), **mise en route** cochée d'après la configuration réelle
  (salons de logs, rôles staff, bienvenue, tickets, protections, + FiveM / whitelist / boutique selon les modules), chiffres clés,
  graphiques 30 jours (arrivées et départs depuis la table Log, tickets ouverts / fermés, sanctions par type), activité récente.
- **Permissions** (`/permissions`) : `commandPermissionService` (`catalog`, `rules`, `set`, `reset`, `LOCKED_COMMANDS`) puis `invalidateCommandPermissions(guildId)`.
  `POST /permissions/command/:command` (rôles + activation), `/command/:command/reset`, `/category/:category` (`mode` replace | add),
  `/category/:category/reset`, `/permissions/reset`. `/settings?tab=commands` redirige ici.
- **Salons vocaux** (`/vocal`) : `tempVoiceService` (`getConfig`, `updateConfig`, `listActive`) ; `POST /vocal/config` (lobbies, catégorie, limite,
  règles de langue `rulesJson` via `partials/voice-rule-row` + repeater, règle de repli, droits du créateur) ; aperçu live des noms (`public/js/vocal.js`,
  mêmes règles que `buildChannelName`) ; tableau des salons temporaires actifs.
- **Paramètres** (`/settings`) : page unique (type, langue, apparence, équipe, modules) ; `?tab=modules` défile jusqu'aux modules.
- **Modération** : Sanctions (+ graphique 30 j, `?tab=stats`) · Avertissements · Protection (sommaire : lockdown, anti-nuke, filtres, exemptions,
  escalade, salon piège, actions sensibles ; `?tab=config|antiraid|honeypot|lockdown` ouvrent la section correspondante).
  **Débannir tout le monde** (`massUnbanService`) : `GET /moderation/unban-all/status` (nombre de bannis mis en cache 60 s, progression),
  `POST /moderation/unban-all` (confirmation `UNBAN ALL` tapée, raison, « aussi débannir en jeu » ; réservé au propriétaire / Administrator),
  `POST /moderation/unban-all/cancel` ; progression sondée par `public/js/moderation.js`.
- **Tickets** (`/tickets`) : Raisons, éditeur de raison, Panneaux, Relances, Tickets, Statistiques.
- **Événements** : `/events`, `/events?tab=polls`, `/giveaways` ; création avec aperçu serveur (`POST …/preview`).
- **FiveM** : `/fivem` (Serveurs · Joueurs · Installation rs_bridge), fiche `?server=<clé>&stab=overview|settings|sync`.
- **Whitelist / School / Boutique / Battle Royale** : onglets d'objets, fiches maître/détail (`?id=`, `?user=`, `?app=`, `?order=`).

## Conventions

- Textes en français ; textes envoyés sur Discord via `translationService` (langue du serveur).
- Pas de CDN, pas de script ni de style inline : classes + `data-*` lus par `app.js`.
- Actions destructives : `data-confirm` (et `data-confirm-type` pour les actions de masse). Boutons nécessitant le bot : désactivés si `!botReady`.
- Réponses JSON : `{ ok: true, ... }` ; erreurs `{ error, details? }`.

## Sécurité

- CSP : `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `font-src 'self'`, `img-src 'self' data:` + CDN Discord, `frame-ancestors 'none'`
  (le transcript HTML servi en iframe ajoute `frame-ancestors 'self'` et `X-Frame-Options: SAMEORIGIN` sur sa seule réponse).
- CSRF sur toutes les mutations (formulaires et `fetch`), sauf `/api/fivem` et `/api/shop` (clé dans leur routeur).
- Rate limit : `/auth` 30 req / 5 min, `/api` 120 req / min.
- Sessions Prisma (7 jours glissants) ; OAuth2 `identify guilds`, `state` aléatoire, jeton jamais exposé au navigateur.
- Clés API FiveM masquées (`••••1234`), secrets Tebex jamais affichés.

## Tests et vérifications

`npx tsc -p tsconfig.json --noEmit` · `npx vitest run` (tests du dashboard dans `tests/dashboard/`, dont `redesign.test.ts` : graphiques,
navigation, mise en route, débannissement de masse ; `app.test.ts` : page Permissions) · `node --check dashboard/public/js/*.js` · `npm run check`.
