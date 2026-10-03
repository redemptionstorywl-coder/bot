import { Router } from 'express';
import { z } from 'zod';
import { FiveMFramework, type FiveMServer } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { fivemService, resolveStatus, onlineSince } from '../../../src/services/FiveMService';
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
const pageQuerySchema = z.object({ server: z.preprocess((v) => (v === '' ? undefined : v), keySchema.optional()) });

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

function toView(server: FiveMServer): ServerView {
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
      const selected = query.server ? servers.find((s) => s.key === query.server) ?? null : null;
      if (query.server && !selected) throw new HttpError(404, 'Serveur FiveM introuvable.');
      const players = selected ? await fivemService.getPlayers(selected) : [];
      const apiBase = `${env().DASHBOARD_URL.replace(/\/+$/, '')}/api/fivem`;
      const exampleKey = selected?.key ?? servers[0]?.key ?? 'main';
      render(res, 'fivem', {
        title: 'FiveM',
        page: 'fivem',
        servers: servers.map(toView),
        selected: selected ? toView(selected) : null,
        players,
        frameworks: Object.values(FiveMFramework).map((f) => ({ value: f, label: FRAMEWORK_LABELS[f] })),
        integration: {
          base: apiBase,
          serverBase: `${apiBase}/servers/${guild.id}/${exampleKey}`,
          exampleKey,
          socketUrl: `${env().DASHBOARD_URL.replace(/\/+$/, '')}/fivem`,
          globalKeyConfigured: env().FIVEM_API_KEY !== 'change-me-fivem-api-key',
        },
        moduleEnabled: config.modules.fivem,
      });
    }),
  );

  router.post(
    '/fivem/servers',
    validate({ body: serverBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
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
      (req, res) => `${base(res.locals.guild!.id)}?server=${encodeURIComponent(String(req.params.key))}`,
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
