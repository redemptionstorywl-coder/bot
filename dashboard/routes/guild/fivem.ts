import { Router } from 'express';
import { z } from 'zod';
import { FiveMFramework, type FiveMServer } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { fivemService, resolveStatus, onlineSince } from '../../../src/services/FiveMService';
import { fivemSyncService } from '../../../src/services/FiveMSyncService';
import { translationService } from '../../../src/services/TranslationService';
import { listFiveMPlayers } from '../../lib/fivemPlayers';
import { resolveUserProfiles, resolveUserNames } from '../../lib/names';
import { env } from '../../../src/config/env';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, optionalDiscordId, optionalText, checkbox } from '../../lib/validate';
import { formAction } from '../../lib/serviceErrors';
import { requireBotGuild } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

export const FRAMEWORK_LABELS: Record<FiveMFramework, string> = { ESX: 'ESX', QBCORE: 'QBCore', CUSTOM: 'Custom' };

const keySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{2,64}$/, 'clé : 2 à 64 caractères, lettres minuscules, chiffres, - ou _');
const keyParams = z.object({ key: keySchema });
const TABS = ['servers', 'players', 'integration'] as const;
const SERVER_TABS = ['overview', 'settings', 'sync'] as const;
const pick = <T extends readonly string[]>(list: T, fallback: T[number]) => z.preprocess((v) => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v : fallback), z.enum(list as unknown as [T[number], ...T[number][]]));
const pageQuerySchema = z.object({
  server: z.preprocess((v) => (v === '' ? undefined : v), keySchema.optional()),
  tab: pick(TABS, 'servers'),
  stab: pick(SERVER_TABS, 'overview'),
  filter: pick(['all', 'linked', 'unlinked', 'online'] as const, 'all'),
  q: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 100) : ''), z.string()),
  page: z.preprocess((v) => (v === '' || v === undefined ? 1 : v), z.coerce.number().int().min(1).max(10_000).catch(1)),
});

/** Formulaire « Synchronisation » → patch strict de syncSettingsSchema (toutes les clés, cases décochées = false). */
const syncBody = z.object({
  syncBansToDiscord: checkbox,
  syncBansToGame: checkbox,
  syncKicks: checkbox,
  syncNicknames: checkbox,
  nicknameFormat: z.string().trim().min(1, 'format requis').max(64),
  linkedRoleId: optionalDiscordId,
  onlineRoleId: optionalDiscordId,
  playerCountChannelId: optionalDiscordId,
  requireDiscord: checkbox,
  requireRoleId: optionalDiscordId,
  requireWhitelist: checkbox,
});
const linkBody = z.object({ userId: z.string().trim().regex(/^\d{15,22}$/, 'ID Discord invalide'), license: z.string().trim().min(8, 'licence requise').max(128) });

const hostSchema = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : typeof v === 'string' ? v.trim().replace(/\/+$/, '') : v),
  z.string().url('hôte : URL attendue (ex. http://1.2.3.4:30120)').max(200).nullable(),
);

const serverBody = z.object({
  key: keySchema,
  name: z.string().trim().min(1, 'nom requis').max(100),
  framework: z.nativeEnum(FiveMFramework).default('CUSTOM'),
  host: hostSchema,
  apiKey: optionalText(200),
  clearApiKey: checkbox,
  statusChannelId: optionalDiscordId,
  enabled: checkbox,
});
const editBody = serverBody.omit({ key: true });
const maintenanceBody = z.object({ enabled: checkbox });

/** Clé API masquée : jamais la valeur complète (4 derniers caractères au plus). */
export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return key.length > 8 ? `••••••••${key.slice(-4)}` : '••••••••';
}

export interface ServerView {
  key: string;
  name: string;
  framework: FiveMFramework;
  frameworkLabel: string;
  host: string | null;
  apiKeyMasked: string | null;
  statusChannelId: string | null;
  statusMessageId: string | null;
  enabled: boolean;
  maintenance: boolean;
  state: 'online' | 'offline' | 'maintenance';
  icon: string;
  stateLabel: string;
  players: number;
  maxPlayers: number;
  version: string | null;
  lastSeenAt: Date | null;
  onlineSince: Date | null;
  connectedSockets: number;
  updatedAt: Date;
}

export function toServerView(server: FiveMServer): ServerView {
  const status = resolveStatus(server);
  const state = status.maintenance ? 'maintenance' : status.online ? 'online' : 'offline';
  const since = onlineSince(server);
  return {
    key: server.key,
    name: server.name,
    framework: server.framework,
    frameworkLabel: FRAMEWORK_LABELS[server.framework],
    host: server.host,
    apiKeyMasked: maskApiKey(server.apiKey),
    statusChannelId: server.statusChannelId,
    statusMessageId: server.statusMessageId,
    enabled: server.enabled,
    maintenance: server.maintenance,
    state,
    icon: state === 'online' ? '🟢' : state === 'maintenance' ? '🟠' : '🔴',
    stateLabel: state === 'online' ? 'En ligne' : state === 'maintenance' ? 'Maintenance' : 'Hors ligne',
    players: status.online ? status.players : 0,
    maxPlayers: status.maxPlayers,
    version: status.version ?? null,
    lastSeenAt: status.lastSeenAt,
    onlineSince: status.online && since ? new Date(since) : null,
    connectedSockets: fivemService.connectedCount(server.id),
    updatedAt: server.updatedAt,
  };
}

/** Pages FiveM : serveurs (statut, joueurs), ajout / édition, maintenance, test de connexion, encart d'intégration API. */
export function createFiveMRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/fivem`;

  router.get(
    '/fivem',
    validate({ query: pageQuerySchema }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof pageQuerySchema>>(req);
      const servers = await fivemService.listServers(guild.id);
      const apiBase = `${env().DASHBOARD_URL.replace(/\/+$/, '')}/api/fivem`;
      const selected = query.server ? servers.find((s) => s.key === query.server) ?? null : null;
      if (query.server && !selected) throw new HttpError(404, 'Serveur FiveM introuvable.');
      const exampleKey = selected?.key ?? servers[0]?.key ?? 'main';
      const integration = {
        base: apiBase,
        botUrl: env().DASHBOARD_URL.replace(/\/+$/, ''),
        serverBase: `${apiBase}/servers/${guild.id}/${exampleKey}`,
        exampleKey,
        socketUrl: `${env().DASHBOARD_URL.replace(/\/+$/, '')}/fivem`,
        globalKeyConfigured: env().FIVEM_API_KEY !== 'change-me-fivem-api-key',
      };
      const common = { page: 'fivem', frameworks: Object.values(FiveMFramework).map((f) => ({ value: f, label: FRAMEWORK_LABELS[f] })), integration, moduleEnabled: config.modules.fivem };

      if (selected) {
        const view = toServerView(selected);
        const players = query.stab === 'overview' ? await fivemService.getPlayers(selected) : [];
        const links = players.length ? await fivemSyncService.discordIdsFor(guild.id, players) : new Map<number, string | null>();
        const profiles = await resolveUserProfiles(client, guild.id, [...links.values()].filter((v): v is string => Boolean(v)));
        const t = translationService.bind(config.defaultLanguage, guild.id);
        render(res, 'fivem-server', {
          ...common,
          title: `FiveM · ${selected.name}`,
          crumbs: [{ label: selected.name }],
          stab: query.stab,
          server: view,
          sync: {
            syncBansToDiscord: selected.syncBansToDiscord,
            syncBansToGame: selected.syncBansToGame,
            syncKicks: selected.syncKicks,
            syncNicknames: selected.syncNicknames,
            nicknameFormat: selected.nicknameFormat,
            linkedRoleId: selected.linkedRoleId,
            onlineRoleId: selected.onlineRoleId,
            playerCountChannelId: selected.playerCountChannelId,
            requireDiscord: selected.requireDiscord,
            requireRoleId: selected.requireRoleId,
            requireWhitelist: selected.requireWhitelist,
          },
          counterTexts: { online: t('fivem.counter.online'), offline: t('fivem.counter.offline'), maintenance: t('fivem.counter.maintenance') },
          players: players.map((p) => ({ ...p, discordId: links.get(p.id) ?? null })),
          profiles,
          scripts: query.stab === 'sync' ? ['fivem'] : [],
        });
        return;
      }

      const playerList = query.tab === 'players' ? await listFiveMPlayers(guild.id, { q: query.q, filter: query.filter, page: query.page }) : null;
      const profiles = playerList ? await resolveUserProfiles(client, guild.id, playerList.items.map((p) => p.discordId).filter((v): v is string => Boolean(v))) : {};
      const baseQuery = new URLSearchParams({ tab: 'players', ...(query.filter !== 'all' ? { filter: query.filter } : {}), ...(query.q ? { q: query.q } : {}) }).toString();
      render(res, 'fivem', {
        ...common,
        title: 'FiveM',
        crumbs: query.tab === 'players' ? [{ label: 'Joueurs' }] : query.tab === 'integration' ? [{ label: 'Intégration' }] : [],
        tab: query.tab,
        servers: servers.map(toServerView),
        playerList,
        profiles,
        filters: { q: query.q, filter: query.filter },
        baseQuery,
        pagination: playerList ? { page: playerList.page, pages: playerList.pages, total: playerList.total, pageSize: 25 } : null,
        serverNames: Object.fromEntries(servers.map((s) => [s.key, s.name])),
      });
    }),
  );

  router.get(
    '/fivem/new',
    wrap(async (_req, res) => {
      const config = res.locals.config!;
      render(res, 'fivem-new', {
        title: 'Ajouter un serveur FiveM',
        page: 'fivem',
        crumbs: [{ label: 'Ajouter un serveur' }],
        frameworks: Object.values(FiveMFramework).map((f) => ({ value: f, label: FRAMEWORK_LABELS[f] })),
        moduleEnabled: config.modules.fivem,
      });
    }),
  );

  router.post(
    '/fivem/servers/:key/sync',
    validate({ body: syncBody, params: keyParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?server=${encodeURIComponent(String(req.params.key))}&stab=sync`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body, params } = valid<z.infer<typeof syncBody>, unknown, z.infer<typeof keyParams>>(req);
        for (const id of [body.linkedRoleId, body.onlineRoleId, body.requireRoleId]) if (id && !guild.roles.some((r) => r.id === id)) throw new HttpError(400, 'Rôle inconnu.');
        if (body.playerCountChannelId && !guild.channels.some((c) => c.id === body.playerCountChannelId)) throw new HttpError(400, 'Salon compteur inconnu.');
        if (!/\{name\}|\{id\}|\{level\}/.test(body.nicknameFormat)) throw new HttpError(400, 'Le format de pseudo doit contenir {name}, {id} ou {level}.');
        const server = await fivemSyncService.updateSyncSettings(guild.id, params.key, body);
        broadcastToGuild(guild.id, 'fivem:status', { guildId: guild.id, serverKey: server.key, action: 'sync' });
        flash(req, 'success', `Synchronisation de « ${server.name} » enregistrée.`);
      },
    ),
  );

  router.post(
    '/fivem/players/link',
    validate({ body: linkBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=players`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof linkBody>>(req);
        const player = await fivemSyncService.linkManually(guild.id, body.userId, body.license, req.session.user!.id);
        broadcastToGuild(guild.id, 'fivem:status', { guildId: guild.id, action: 'link', userId: body.userId });
        const names = await resolveUserNames(client, guild.id, [body.userId]);
        flash(req, 'success', `Compte lié : ${names[body.userId] ?? body.userId} ⇄ ${player.license ?? body.license}.`);
      },
    ),
  );

  router.post(
    '/fivem/servers',
    validate({ body: serverBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/new`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof serverBody>>(req);
        if (body.statusChannelId && !guild.textChannels.some((c) => c.id === body.statusChannelId)) throw new HttpError(400, 'Salon de statut inconnu.');
        let server = await fivemService.addServer({ guildId: guild.id, key: body.key, name: body.name, framework: body.framework, host: body.host, apiKey: body.apiKey ?? null });
        if (!body.enabled) server = await fivemService.updateServer(guild.id, server.key, { enabled: false });
        if (body.statusChannelId) {
          requireBotGuild(client, guild.id);
          server = await fivemService.setStatusChannel(guild.id, server.key, body.statusChannelId);
        }
        broadcastToGuild(guild.id, 'fivem:status', { guildId: guild.id, serverKey: server.key, action: 'create' });
        flash(req, 'success', `Serveur « ${server.name} » (${server.key}) ajouté.`);
        return `${base(guild.id)}?server=${server.key}`;
      },
    ),
  );

  router.post(
    '/fivem/servers/:key',
    validate({ body: editBody, params: keyParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?server=${encodeURIComponent(String(req.params.key))}&stab=settings`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body, params } = valid<z.infer<typeof editBody>, unknown, z.infer<typeof keyParams>>(req);
        const existing = await fivemService.requireServer(guild.id, params.key);
        if (body.statusChannelId && !guild.textChannels.some((c) => c.id === body.statusChannelId)) throw new HttpError(400, 'Salon de statut inconnu.');
        const data: Parameters<typeof fivemService.updateServer>[2] = { name: body.name, framework: body.framework, host: body.host, enabled: body.enabled };
        if (body.clearApiKey) data.apiKey = null;
        else if (body.apiKey) data.apiKey = body.apiKey;
        let server = await fivemService.updateServer(guild.id, params.key, data);
        if ((body.statusChannelId ?? null) !== (existing.statusChannelId ?? null)) {
          if (body.statusChannelId) requireBotGuild(client, guild.id);
          server = await fivemService.setStatusChannel(guild.id, params.key, body.statusChannelId);
        }
        broadcastToGuild(guild.id, 'fivem:status', { guildId: guild.id, serverKey: server.key, action: 'update' });
        flash(req, 'success', `Serveur « ${server.name} » mis à jour.`);
      },
    ),
  );

  router.post(
    '/fivem/servers/:key/maintenance',
    validate({ body: maintenanceBody, params: keyParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?server=${encodeURIComponent(String(req.params.key))}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body, params } = valid<z.infer<typeof maintenanceBody>, unknown, z.infer<typeof keyParams>>(req);
        const server = await fivemService.setMaintenance(guild.id, params.key, body.enabled, req.session.user!.id);
        broadcastToGuild(guild.id, 'fivem:status', { guildId: guild.id, serverKey: server.key, action: 'maintenance', maintenance: server.maintenance });
        flash(req, 'success', `Maintenance ${server.maintenance ? 'activée' : 'désactivée'} sur « ${server.name} ».`);
      },
    ),
  );

  router.post(
    '/fivem/servers/:key/test',
    validate({ params: keyParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?server=${encodeURIComponent(String(req.params.key))}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof keyParams>>(req);
        const server = await fivemService.requireServer(guild.id, params.key);
        const status = await fivemService.testConnection(server);
        await fivemService.applyStatus(server, status, 'poll');
        broadcastToGuild(guild.id, 'fivem:status', { guildId: guild.id, serverKey: server.key, action: 'test', online: status.online });
        flash(req, 'success', `Connexion réussie : ${status.online ? 'en ligne' : 'hors ligne'}, ${status.players}/${status.maxPlayers || '—'} joueur(s)${status.version ? `, version ${status.version}` : ''}.`);
      },
    ),
  );

  router.post(
    '/fivem/servers/:key/delete',
    validate({ params: keyParams }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof keyParams>>(req);
        const server = await fivemService.removeServer(guild.id, params.key);
        broadcastToGuild(guild.id, 'fivem:status', { guildId: guild.id, serverKey: server.key, action: 'delete' });
        flash(req, 'success', `Serveur « ${server.name} » supprimé.`);
      },
    ),
  );

  return router;
}
