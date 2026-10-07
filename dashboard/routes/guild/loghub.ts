import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { LogCategory } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { env } from '../../../src/config/env';
import { prisma } from '../../../src/database/client';
import { loggingService } from '../../../src/services/LoggingService';
import { guildConfigService } from '../../../src/services/GuildConfigService';
import { logHubService, type SourceCandidate } from '../../../src/services/LogHubService';
import { logTemplateService } from '../../../src/services/LogTemplateService';
import { translationService } from '../../../src/services/TranslationService';
import { GLOBAL_SOURCE_KEY, gameSourceKey, isGameRouteKey, isGlobalRouteKey, isSourceRouteKey, parseGameSourceKey } from '../../../src/services/logs/routes';
import { childLogger } from '../../../src/utils/logger';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash, markAudited } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { isGuildAdmin } from '../../lib/access';
import { formAction } from '../../lib/serviceErrors';
import { validate, valid, checkbox, discordIdSchema } from '../../lib/validate';
import { requireBotGuild } from '../../lib/names';

const log = childLogger('DashboardLogHub');
const fr = translationService.bind('fr');

const sourceParams = z.object({ guildId: discordIdSchema, sourceId: discordIdSchema });
const gameParams = z.object({ guildId: discordIdSchema, serverId: z.coerce.number().int().min(1) });
const linkBody = z.object({ sourceGuildId: discordIdSchema });
const keepLocalBody = z.object({ keepLocal: checkbox });
const labelBody = z.object({ label: z.string().trim().min(1, 'nom requis').max(64) });
const gameBody = z.object({ serverId: z.coerce.number().int().min(1), chat: checkbox });
const chatBody = z.object({ chat: checkbox });
const routesBody = z.object({
  routes: z.preprocess(
    (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    z.record(z.string().max(48), z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.record(z.string().max(48), z.string().regex(/^(\d{15,22})?$/, 'salon invalide')))),
  ),
});

export interface HubRouteRow {
  sourceKey: string;
  routeKey: string;
  name: string;
  label: string;
  channelId: string;
  missing: boolean;
}

export interface HubSection {
  key: string;
  title: string;
  kind: 'global' | 'source' | 'game';
  rows: HubRouteRow[];
}

/** Réservé au propriétaire du serveur / Administrateur / propriétaire du bot (comme /template logs). */
function requireAdmin(req: Request, res: Response): void {
  if (!isGuildAdmin(req.session.guilds, res.locals.guild!.id, req.session.user!.id, env().OWNER_IDS)) throw new HttpError(403, 'Réservé au propriétaire du serveur et aux membres « Administrateur ».');
}

/**
 * Page « Hub de logs » (groupe Sécurité) : sources reliées (copie locale, nom, retrait), serveurs de jeu (chat, retrait),
 * salon de chaque route (modifiable), « Réparer » (salons manquants recréés). Sur un serveur source : hub relié + « Délier ».
 * Les liens passent par la vérification de sécurité de LogHubService (administrateur ou propriétaire de la SOURCE).
 */
export function createLogHubRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/log-hub`;

  // Liens et salons : chaque modification écrit son propre log (hub.*) ou est un réglage d'affichage.
  router.use('/log-hub', (_req, res, next) => {
    markAudited(res);
    next();
  });

  router.get(
    '/log-hub',
    wrap(async (req, res) => {
      const guildView = res.locals.guild!;
      const user = req.session.user!;
      const isAdmin = isGuildAdmin(req.session.guilds, guildView.id, user.id, env().OWNER_IDS);
      const hub = await logHubService.getHub(guildView.id);
      const link = await logHubService.getSourceLink(guildView.id);
      const discordGuild = client.isReady() ? (client.guilds.cache.get(guildView.id) ?? null) : null;
      let sections: HubSection[] = [];
      let sources: { guildId: string; name: string; label: string; emoji: string; keepLocal: boolean; iconUrl: string | null; present: boolean }[] = [];
      let games: { id: number; name: string; sourceName: string; chat: boolean }[] = [];
      let candidates: SourceCandidate[] = [];
      let gameCandidates: { id: number; name: string; sourceName: string }[] = [];
      let missing = 0;
      if (hub) {
        const links = await logHubService.listSources(guildView.id);
        const linkedGames = await logHubService.listGames(guildView.id);
        sources = links.map((l) => {
          const g = client.guilds.cache.get(l.sourceGuildId);
          return { guildId: l.sourceGuildId, name: g?.name ?? l.sourceGuildId, label: l.label, emoji: l.emoji, keepLocal: l.keepLocal, iconUrl: g?.iconURL() ?? null, present: !!g };
        });
        games = linkedGames.filter((g) => g.server).map((g) => ({ id: g.fivemServerId, name: g.server!.name, sourceName: client.guilds.cache.get(g.server!.guildId)?.name ?? g.server!.guildId, chat: g.chat }));
        if (discordGuild) {
          const { plan } = await logTemplateService.state(discordGuild);
          const routes = await logHubService.getRoutes(guildView.id);
          missing = plan.toCreate;
          const titleOf = (sourceKey: string): { title: string; kind: HubSection['kind'] } => {
            if (sourceKey === GLOBAL_SOURCE_KEY) return { title: fr('loghub.layout.general'), kind: 'global' };
            const game = parseGameSourceKey(sourceKey);
            if (game !== null) return { title: `🎮 ${games.find((g) => g.id === game)?.name ?? sourceKey}`, kind: 'game' };
            const s = sources.find((x) => x.guildId === sourceKey);
            return { title: s ? `${s.emoji} ${s.label}` : sourceKey, kind: 'source' };
          };
          const bySection = new Map<string, HubSection>();
          for (const item of plan.items) {
            if (item.kind !== 'text') continue;
            if (!bySection.has(item.sourceKey)) bySection.set(item.sourceKey, { key: item.sourceKey, ...titleOf(item.sourceKey), rows: [] });
            bySection.get(item.sourceKey)!.rows.push({ sourceKey: item.sourceKey, routeKey: item.route, name: item.name, label: fr(`loghub.routes.${item.route}`), channelId: routes[item.sourceKey]?.[item.route] ?? '', missing: item.status !== 'reuse' });
          }
          sections = [...bySection.values()];
        }
        if (isAdmin && client.isReady()) {
          candidates = (await logHubService.eligibleSources(client, guildView.id, user.id)).filter((c) => c.permission.allowed && !c.isHub && !c.linkedHubId);
          const linkedIds = new Set(links.map((l) => l.sourceGuildId));
          const servers = linkedIds.size ? ((await prisma.fiveMServer.findMany({ where: { guildId: { in: [...linkedIds] } }, orderBy: { id: 'asc' } })) ?? []) : [];
          gameCandidates = servers.filter((s) => !games.some((g) => g.id === s.id)).map((s) => ({ id: s.id, name: s.name, sourceName: client.guilds.cache.get(s.guildId)?.name ?? s.guildId }));
        }
      }
      render(res, 'loghub', {
        title: 'Hub de logs',
        page: 'logHub',
        isHub: !!hub,
        isAdmin,
        link: link ? { hubName: client.guilds.cache.get(link.hubGuildId)?.name ?? link.hubGuildId, hubId: link.hubGuildId, keepLocal: link.keepLocal, label: `${link.emoji} ${link.label}` } : null,
        sources,
        games,
        sections,
        candidates: candidates.map((c) => ({ guildId: c.guildId, name: c.name })),
        gameCandidates,
        missing,
        running: logTemplateService.isRunning(guildView.id),
      });
    }),
  );

  router.post(
    '/log-hub/sources',
    validate({ body: linkBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const guildView = res.locals.guild!;
        if (!(await logHubService.getHub(guildView.id))) throw new HttpError(400, 'Ce serveur n’est pas encore un hub de logs : lancez /template logs sur Discord.');
        const { body } = valid<z.infer<typeof linkBody>>(req);
        const user = req.session.user!;
        // Vérification de sécurité (administrateur / propriétaire de la source, membre relu via Discord) dans linkSource.
        const row = await logHubService.linkSource(client, guildView.id, body.sourceGuildId, user.id);
        const sourceCfg = await guildConfigService.get(body.sourceGuildId);
        const t = translationService.bind(sourceCfg?.defaultLanguage ?? 'fr', body.sourceGuildId);
        await loggingService.log({ guildId: body.sourceGuildId, category: LogCategory.SYSTEM, action: 'hub.link', title: t('loghub.audit.link_title'), description: t('loghub.audit.link', { hub: guildView.name, hubId: guildView.id, user: `<@${user.id}>` }), actorId: user.id, data: { hubGuildId: guildView.id, source: 'dashboard' } });
        flash(req, 'success', `${row.emoji} ${row.label} est relié. Cliquez sur « Créer les salons manquants » pour créer ses salons.`);
      },
    ),
  );

  router.post(
    '/log-hub/sources/:sourceId/keep-local',
    validate({ params: sourceParams, body: keepLocalBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const { params, body } = valid<z.infer<typeof keepLocalBody>, unknown, z.infer<typeof sourceParams>>(req);
        await logHubService.setKeepLocal(res.locals.guild!.id, params.sourceId, body.keepLocal);
        flash(req, 'success', body.keepLocal ? 'Les logs sont aussi publiés dans les salons du serveur source.' : 'Les logs ne sont plus publiés que dans le hub.');
      },
    ),
  );

  router.post(
    '/log-hub/sources/:sourceId/label',
    validate({ params: sourceParams, body: labelBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const { params, body } = valid<z.infer<typeof labelBody>, unknown, z.infer<typeof sourceParams>>(req);
        await logHubService.setLabel(res.locals.guild!.id, params.sourceId, body.label);
        flash(req, 'success', 'Nom de section enregistré. Les catégories existantes gardent leur nom : renommez-les sur Discord si besoin.');
      },
    ),
  );

  router.post(
    '/log-hub/sources/:sourceId/unlink',
    validate({ params: sourceParams }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const guildView = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof sourceParams>>(req);
        const user = req.session.user!;
        if (!(await logHubService.unlinkSource(guildView.id, params.sourceId))) throw new HttpError(404, 'Source introuvable.');
        await loggingService.log({ guildId: guildView.id, category: LogCategory.SYSTEM, action: 'hub.unlink', title: fr('loghub.audit.unlink_title'), description: fr('loghub.audit.unlink', { server: client.guilds.cache.get(params.sourceId)?.name ?? params.sourceId, user: `<@${user.id}>` }), actorId: user.id, data: { sourceGuildId: params.sourceId, source: 'dashboard' } });
        const discordGuild = client.guilds.cache.get(guildView.id);
        if (discordGuild) await logTemplateService.publishSummary(client, discordGuild).catch(() => null);
        flash(req, 'success', 'Source retirée. Ses salons sont conservés (historique).');
      },
    ),
  );

  router.post(
    '/log-hub/games',
    validate({ body: gameBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const { body } = valid<z.infer<typeof gameBody>>(req);
        await logHubService.linkGame(res.locals.guild!.id, body.serverId, req.session.user!.id, body.chat);
        flash(req, 'success', 'Serveur de jeu relié. Cliquez sur « Créer les salons manquants » pour créer sa catégorie JEU.');
      },
    ),
  );

  router.post(
    '/log-hub/games/:serverId/chat',
    validate({ params: gameParams, body: chatBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const { params, body } = valid<z.infer<typeof chatBody>, unknown, z.infer<typeof gameParams>>(req);
        await logHubService.setGameChat(res.locals.guild!.id, params.serverId, body.chat);
        flash(req, 'success', body.chat ? 'Chat en jeu activé : créez le salon manquant puis réglez Config.Logs.Chat = true dans rs_bridge.' : 'Chat en jeu désactivé.');
      },
    ),
  );

  router.post(
    '/log-hub/games/:serverId/unlink',
    validate({ params: gameParams }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const { params } = valid<unknown, unknown, z.infer<typeof gameParams>>(req);
        if (!(await logHubService.unlinkGame(res.locals.guild!.id, params.serverId))) throw new HttpError(404, 'Serveur de jeu introuvable.');
        flash(req, 'success', 'Serveur de jeu retiré. Ses salons sont conservés.');
      },
    ),
  );

  router.post(
    '/log-hub/routes',
    validate({ body: routesBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const guildView = res.locals.guild!;
        const { body } = valid<z.infer<typeof routesBody>>(req);
        const textChannels = new Set(guildView.textChannels.map((c) => c.id));
        const sources = new Set((await logHubService.listSources(guildView.id)).map((s) => s.sourceGuildId));
        const games = new Set((await logHubService.listGames(guildView.id)).map((g) => gameSourceKey(g.fivemServerId)));
        let changed = 0;
        for (const [sourceKey, routes] of Object.entries(body.routes)) {
          const kind = sourceKey === GLOBAL_SOURCE_KEY ? 'global' : games.has(sourceKey) ? 'game' : sources.has(sourceKey) ? 'source' : null;
          if (!kind) continue;
          for (const [routeKey, channelId] of Object.entries(routes)) {
            const key = kind === 'global' ? (isGlobalRouteKey(routeKey) ? routeKey : null) : kind === 'game' ? (isGameRouteKey(routeKey) ? routeKey : null) : isSourceRouteKey(routeKey) ? routeKey : null;
            if (!key) continue;
            if (channelId && !textChannels.has(channelId)) throw new HttpError(400, 'Salon inconnu : choisissez un salon texte de ce serveur.');
            await logHubService.setRoute(guildView.id, sourceKey, key, channelId || null);
            changed++;
          }
        }
        flash(req, 'success', changed ? 'Salons du hub enregistrés.' : 'Aucun changement.');
      },
    ),
  );

  router.post(
    '/log-hub/repair',
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const guild = requireBotGuild(client, res.locals.guild!.id);
        if (logTemplateService.isRunning(guild.id)) throw new HttpError(409, 'Une création est déjà en cours : patientez puis actualisez la page.');
        const { plan } = await logTemplateService.state(guild);
        if (plan.guildLimitExceeded) throw new HttpError(400, `La structure dépasserait la limite Discord de 500 salons (${plan.channelsAfter}).`);
        const userId = req.session.user!.id;
        // En arrière-plan : la création est cadencée (≈ 0,4 s par salon) ; la page affiche « en cours ».
        void logTemplateService
          .apply(client, guild)
          .then((r) => loggingService.log({ guildId: guild.id, category: LogCategory.SYSTEM, action: 'hub.template', title: fr('loghub.audit.template_title'), description: fr('loghub.audit.template', { created: r.created, reused: r.reused, failed: r.failed.length }), actorId: userId, data: { created: r.created, reused: r.reused, failed: r.failed.length, source: 'dashboard' } }))
          .catch((err) => log.error({ err, guild: guild.id }, 'Réparation du hub en erreur'));
        flash(req, 'success', plan.toCreate ? `Création lancée : ${plan.toCreate} salon(s) à créer. Actualisez la page dans quelques secondes.` : 'Rien à créer : le sommaire est mis à jour.');
      },
    ),
  );

  router.post(
    '/log-hub/unlink-self',
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        requireAdmin(req, res);
        const guildView = res.locals.guild!;
        const link = await logHubService.getSourceLink(guildView.id);
        if (!link) throw new HttpError(404, 'Ce serveur n’est relié à aucun hub de logs.');
        await logHubService.unlinkSource(link.hubGuildId, guildView.id);
        const hubName = client.guilds.cache.get(link.hubGuildId)?.name ?? link.hubGuildId;
        await loggingService.log({ guildId: guildView.id, category: LogCategory.SYSTEM, action: 'hub.unlink', title: fr('loghub.audit.unlink_title'), description: fr('loghub.audit.unlink_source', { hub: hubName, user: `<@${req.session.user!.id}>` }), actorId: req.session.user!.id, data: { hubGuildId: link.hubGuildId, source: 'dashboard' } });
        const hubGuild = client.guilds.cache.get(link.hubGuildId);
        if (hubGuild) await logTemplateService.publishSummary(client, hubGuild).catch(() => null);
        flash(req, 'success', `Ce serveur est délié du hub « ${hubName} ».`);
      },
    ),
  );

  return router;
}
