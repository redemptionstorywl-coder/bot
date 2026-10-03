import { EmbedBuilder, type Client, type ColorResolvable } from 'discord.js';
import { FiveMFramework, LogCategory, Prisma, SanctionType, type FiveMServer } from '@prisma/client';
import type { Socket } from 'socket.io';
import { prisma } from '../database/client';
import { env } from '../config/env';
import { BRAND } from '../config/constants';
import { scheduler } from './SchedulerService';
import { loggingService } from './LoggingService';
import { moderationService } from './ModerationService';
import { guildConfigService } from './GuildConfigService';
import { translationService } from './TranslationService';
import { TTLCache } from '../utils/cache';
import { discordTimestamp, formatDuration } from '../utils/time';
import { childLogger } from '../utils/logger';
import { getAdapter, AdapterError, type FrameworkAdapter } from './fivem/adapters';
import { serverStatusSchema, type NormalizedSanction, type ServerPlayer, type ServerStatus } from './fivem/schemas';

const log = childLogger('FiveMService');

/** Un serveur est considéré hors ligne si aucune nouvelle depuis ce délai. */
export const OFFLINE_AFTER_MS = 3 * 60_000;
export const POLL_INTERVAL_MS = 60_000;

export type StatusSource = 'rest' | 'socket' | 'poll' | 'system';

export interface ResolvedStatus extends ServerStatus {
  /** Statut effectif : hors ligne si lastSeenAt trop ancien */
  online: boolean;
  maintenance: boolean;
  lastSeenAt: Date | null;
  stale: boolean;
}

export interface SocketEvents {
  'whitelist:updated': { discordId: string; identifier: string | null; status: 'PENDING' | 'ACCEPTED' | 'REJECTED' };
  maintenance: { enabled: boolean };
}

export class FiveMError extends Error {
  constructor(readonly code: 'not_found' | 'duplicate' | 'no_host' | 'unreachable' | 'invalid_key' | 'unauthorized' | 'disabled', message?: string) {
    super(message ?? code);
    this.name = 'FiveMError';
  }
}

/** Détermine le statut effectif à partir du dernier statut et de la fraîcheur des données (fonction pure). */
export function resolveStatus(server: Pick<FiveMServer, 'lastStatus' | 'lastSeenAt' | 'maintenance'>, now = Date.now()): ResolvedStatus {
  const parsed = serverStatusSchema.safeParse(server.lastStatus ?? {});
  const base: ServerStatus = parsed.success ? parsed.data : { online: false, players: 0, maxPlayers: 0, playerList: [] };
  const stale = !server.lastSeenAt || now - server.lastSeenAt.getTime() > OFFLINE_AFTER_MS;
  return {
    ...base,
    online: base.online && !stale,
    maintenance: server.maintenance || base.maintenance === true,
    lastSeenAt: server.lastSeenAt ?? null,
    stale,
  };
}

/**
 * Intégration FiveM : serveurs, statut, polling, sockets temps réel, sanctions distantes.
 * L'API REST (src/api/fivem.ts) et le namespace Socket.IO délèguent toute la logique ici.
 */
export class FiveMService {
  private client: Client | null = null;
  private readonly serverCache = new TTLCache<FiveMServer | null>(60_000, 1000);
  /** serverId → sockets connectés */
  private readonly sockets = new Map<number, Set<Socket>>();
  private tasksRegistered = false;

  attach(client: Client): void {
    this.client = client;
  }

  /** Enregistre la tâche de polling / rafraîchissement des messages de statut (idempotent). */
  registerTasks(): void {
    if (this.tasksRegistered || scheduler.registered.includes('fivem:poll')) return;
    this.tasksRegistered = true;
    scheduler.register({
      name: 'fivem:poll',
      intervalMs: POLL_INTERVAL_MS,
      runOnStart: true,
      run: () => this.pollAll(),
    });
  }

  getAdapter(framework: FiveMFramework | string): FrameworkAdapter {
    return getAdapter(framework);
  }

  // ───── Serveurs ─────

  async listServers(guildId: string): Promise<FiveMServer[]> {
    return prisma.fiveMServer.findMany({ where: { guildId }, orderBy: { key: 'asc' } });
  }

  async getServer(guildId: string, key: string): Promise<FiveMServer | null> {
    const cacheKey = `${guildId}:${key}`;
    const cached = this.serverCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const server = await prisma.fiveMServer.findUnique({ where: { guildId_key: { guildId, key } } });
    this.serverCache.set(cacheKey, server);
    return server;
  }

  async requireServer(guildId: string, key: string): Promise<FiveMServer> {
    const server = await this.getServer(guildId, key);
    if (!server) throw new FiveMError('not_found');
    return server;
  }

  private invalidate(server: Pick<FiveMServer, 'guildId' | 'key'>): void {
    this.serverCache.delete(`${server.guildId}:${server.key}`);
  }

  async addServer(input: { guildId: string; key: string; name: string; framework: FiveMFramework; host?: string | null; apiKey?: string | null }): Promise<FiveMServer> {
    const key = input.key.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,64}$/.test(key)) throw new FiveMError('invalid_key');
    const existing = await prisma.fiveMServer.findUnique({ where: { guildId_key: { guildId: input.guildId, key } } });
    if (existing) throw new FiveMError('duplicate');
    const server = await prisma.fiveMServer.create({
      data: { guildId: input.guildId, key, name: input.name.trim().slice(0, 100), framework: input.framework, host: input.host?.trim() || null, apiKey: input.apiKey?.trim() || null },
    });
    this.invalidate(server);
    return server;
  }

  async removeServer(guildId: string, key: string): Promise<FiveMServer> {
    const server = await this.requireServer(guildId, key);
    await prisma.fiveMServer.delete({ where: { id: server.id } });
    this.invalidate(server);
    for (const s of this.sockets.get(server.id) ?? []) s.disconnect(true);
    this.sockets.delete(server.id);
    return server;
  }

  async updateServer(guildId: string, key: string, data: Prisma.FiveMServerUpdateInput): Promise<FiveMServer> {
    const server = await this.requireServer(guildId, key);
    const updated = await prisma.fiveMServer.update({ where: { id: server.id }, data });
    this.invalidate(server);
    return updated;
  }

  // ───── Auth ─────

  /** Vérifie une clé API : clé globale (env) ou clé propre au serveur. */
  isValidApiKey(server: FiveMServer, apiKey: string | undefined | null): boolean {
    if (!apiKey) return false;
    if (server.apiKey && safeEqual(server.apiKey, apiKey)) return true;
    return safeEqual(env().FIVEM_API_KEY, apiKey);
  }

  /** Résout + authentifie un serveur. Lance FiveMError('not_found' | 'unauthorized' | 'disabled'). */
  async authenticate(guildId: string, serverKey: string, apiKey: string | undefined | null): Promise<FiveMServer> {
    const server = await this.getServer(guildId, serverKey);
    if (!server) throw new FiveMError('not_found');
    if (!this.isValidApiKey(server, apiKey)) throw new FiveMError('unauthorized');
    if (!server.enabled) throw new FiveMError('disabled');
    return server;
  }

  // ───── Statut ─────

  getResolvedStatus(server: FiveMServer): ResolvedStatus {
    return resolveStatus(server);
  }

  /** Applique un statut reçu (REST / socket / polling) : DB + message Discord. */
  async applyStatus(server: FiveMServer, status: ServerStatus, source: StatusSource): Promise<FiveMServer> {
    const previous = (server.lastStatus ?? {}) as { online?: boolean; onlineSince?: number };
    const onlineSince = status.online ? (previous.online && previous.onlineSince ? previous.onlineSince : Date.now()) : undefined;
    const data: Prisma.FiveMServerUpdateInput = {
      lastStatus: { ...status, onlineSince } as unknown as Prisma.InputJsonValue,
      lastSeenAt: status.online ? new Date() : server.lastSeenAt,
    };
    if (status.maintenance !== undefined && status.maintenance !== server.maintenance) data.maintenance = status.maintenance;
    const updated = await prisma.fiveMServer.update({ where: { id: server.id }, data });
    this.invalidate(updated);
    log.debug({ server: server.key, guildId: server.guildId, source, players: status.players }, 'Statut appliqué');
    await this.updateStatusMessage(updated).catch((err) => log.warn({ err, server: server.key }, 'Message de statut non mis à jour'));
    return updated;
  }

  /** Marque un serveur hors ligne (plus de nouvelles). */
  async markOffline(server: FiveMServer): Promise<FiveMServer> {
    const current = resolveStatus(server);
    if (!current.online && (server.lastStatus as { online?: boolean } | null)?.online === false) return server;
    const status: ServerStatus = { ...current, online: false, players: 0, playerList: [] };
    return this.applyStatus(server, status, 'system');
  }

  async setMaintenance(guildId: string, key: string, enabled: boolean, actorId?: string): Promise<FiveMServer> {
    const server = await this.updateServer(guildId, key, { maintenance: enabled });
    this.emitToServer(server, 'maintenance', { enabled });
    await this.updateStatusMessage(server).catch(() => null);
    await loggingService.log({
      guildId,
      category: LogCategory.SYSTEM,
      action: enabled ? 'fivem.maintenance.on' : 'fivem.maintenance.off',
      title: `🎮 ${server.name} — maintenance ${enabled ? 'ON' : 'OFF'}`,
      actorId: actorId ?? null,
      data: { serverKey: key, enabled },
    });
    return server;
  }

  /** Joueurs connus : dernier statut frais, sinon lecture directe de `players.json` si un host est configuré. */
  async getPlayers(server: FiveMServer): Promise<ServerPlayer[]> {
    const status = resolveStatus(server);
    if (!status.stale) return status.playerList;
    if (server.host) {
      try {
        return await this.getAdapter(server.framework).fetchPlayers(server);
      } catch (err) {
        log.debug({ err, server: server.key }, 'fetchPlayers échoué');
      }
    }
    return [];
  }

  /** Vérifie si un identifiant est actuellement connecté sur l'un des serveurs du guild. */
  async isIdentifierOnline(guildId: string, identifier: string): Promise<boolean> {
    const servers = await this.listServers(guildId);
    for (const server of servers) {
      const status = resolveStatus(server);
      if (status.playerList.some((p) => p.identifiers.includes(identifier))) return true;
    }
    return false;
  }

  /** Nombre de serveurs configurés pour un guild (utilisé pour savoir si la vérification d'identifiant est possible). */
  async hasServers(guildId: string): Promise<boolean> {
    return (await prisma.fiveMServer.count({ where: { guildId } })) > 0;
  }

  // ───── Polling ─────

  async pollAll(): Promise<void> {
    const servers = await prisma.fiveMServer.findMany({ where: { enabled: true } });
    await Promise.all(servers.map((s) => this.pollOne(s).catch((err) => log.warn({ err, server: s.key }, 'Polling en erreur'))));
  }

  async pollOne(server: FiveMServer): Promise<void> {
    if (server.host) {
      try {
        const status = await this.getAdapter(server.framework).fetchStatus(server);
        await this.applyStatus(server, status, 'poll');
        return;
      } catch (err) {
        if (!(err instanceof AdapterError)) throw err;
        log.debug({ server: server.key, code: err.code }, 'Serveur injoignable');
      }
    }
    const status = resolveStatus(server);
    if (status.stale) await this.markOffline(server);
    else await this.updateStatusMessage(server).catch(() => null);
  }

  // ───── Message de statut Discord ─────

  async setStatusChannel(guildId: string, key: string, channelId: string | null): Promise<FiveMServer> {
    const server = await this.updateServer(guildId, key, { statusChannelId: channelId, statusMessageId: null });
    if (channelId) await this.updateStatusMessage(server);
    return server;
  }

  buildStatusEmbed(server: FiveMServer, lang: string): EmbedBuilder {
    const t = translationService.bind(lang, server.guildId);
    const status = resolveStatus(server);
    const state = status.maintenance ? 'maintenance' : status.online ? 'online' : 'offline';
    const icon = state === 'online' ? '🟢' : state === 'maintenance' ? '🟠' : '🔴';
    const color: number = state === 'offline' ? BRAND.colors.danger : state === 'maintenance' ? BRAND.colors.warning : BRAND.colors.primary;
    const embed = new EmbedBuilder()
      .setColor(color as ColorResolvable)
      .setTitle(`${icon} ${server.name}`)
      .addFields(
        { name: t('fivem.status.state'), value: t(`fivem.status.${state}`), inline: true },
        { name: t('fivem.status.players'), value: status.online ? `${status.players}/${status.maxPlayers || '—'}` : '—', inline: true },
        { name: t('fivem.status.version'), value: status.version ? `\`${status.version}\`` : '—', inline: true },
      )
      .setFooter({ text: `${BRAND.footer} • ${server.key} • ${server.framework}` });
    if (status.lastSeenAt) {
      embed.addFields({ name: t('fivem.status.last_update'), value: discordTimestamp(status.lastSeenAt, 'R'), inline: true });
      const since = onlineSince(server);
      if (status.online && since) embed.addFields({ name: t('fivem.status.uptime'), value: formatDuration(Math.floor((Date.now() - since) / 1000), lang), inline: true });
    }
    if (server.host) embed.addFields({ name: t('fivem.status.host'), value: `\`${server.host}\``, inline: true });
    return embed;
  }

  async updateStatusMessage(server: FiveMServer): Promise<void> {
    if (!this.client || !server.statusChannelId) return;
    const channel = await this.client.channels.fetch(server.statusChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return;
    const cfg = await guildConfigService.get(server.guildId);
    const embed = this.buildStatusEmbed(server, cfg?.defaultLanguage ?? 'fr');
    if (server.statusMessageId) {
      const msg = await channel.messages.fetch(server.statusMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }
    }
    const sent = await channel.send({ embeds: [embed] });
    await prisma.fiveMServer.update({ where: { id: server.id }, data: { statusMessageId: sent.id } });
    this.invalidate(server);
  }

  // ───── Sockets ─────

  registerSocket(server: FiveMServer, socket: Socket): void {
    if (!this.sockets.has(server.id)) this.sockets.set(server.id, new Set());
    this.sockets.get(server.id)!.add(socket);
    socket.once('disconnect', () => {
      this.sockets.get(server.id)?.delete(socket);
      if (this.sockets.get(server.id)?.size === 0) this.sockets.delete(server.id);
    });
    log.info({ server: server.key, guildId: server.guildId }, 'Serveur FiveM connecté (socket)');
  }

  connectedCount(serverId: number): number {
    return this.sockets.get(serverId)?.size ?? 0;
  }

  emitToServer<E extends keyof SocketEvents>(server: Pick<FiveMServer, 'id'>, event: E, payload: SocketEvents[E]): number {
    const set = this.sockets.get(server.id);
    if (!set?.size) return 0;
    for (const s of set) s.emit(event, payload);
    return set.size;
  }

  /** Émet vers tous les serveurs d'un guild (ex : whitelist acceptée). */
  async emitToGuild<E extends keyof SocketEvents>(guildId: string, event: E, payload: SocketEvents[E]): Promise<number> {
    if (!this.sockets.size) return 0;
    const servers = await this.listServers(guildId);
    let n = 0;
    for (const s of servers) n += this.emitToServer(s, event, payload);
    return n;
  }

  // ───── Sanctions distantes ─────

  /** Enregistre une sanction venant du serveur de jeu (table Sanction + log MODERATION). */
  async recordSanction(server: FiveMServer, sanction: NormalizedSanction): Promise<{ caseNumber: number; userId: string | null }> {
    let userId = sanction.discordId ?? null;
    if (!userId && sanction.identifier) {
      const profile = await prisma.battleRoyaleProfile.findFirst({ where: { guildId: server.guildId, identifier: sanction.identifier }, select: { userId: true } });
      userId = profile?.userId ?? (await prisma.whitelist.findFirst({ where: { guildId: server.guildId, identifier: sanction.identifier }, select: { userId: true } }))?.userId ?? null;
    }
    const type: SanctionType = sanction.type === 'BAN' && sanction.duration ? SanctionType.TEMPBAN : (sanction.type as SanctionType);
    // Même numérotation (et même retry sur collision P2002) que les sanctions Discord.
    const created = await moderationService.createSanction({
      guildId: server.guildId,
      type,
      userId,
      moderatorId: this.client?.user?.id ?? 'fivem',
      reason: sanction.reason,
      duration: sanction.duration ?? null,
      metadata: { source: 'fivem', serverKey: server.key, identifier: sanction.identifier ?? null, staff: sanction.staff },
    });
    await loggingService.log({
      guildId: server.guildId,
      category: LogCategory.MODERATION,
      action: `fivem.sanction.${sanction.type.toLowerCase()}`,
      title: `🎮 ${sanction.type} — ${server.name} (#${created.caseNumber})`,
      color: BRAND.colors.danger,
      fields: [
        { name: 'Joueur', value: userId ? `<@${userId}>` : sanction.identifier ?? '—', inline: true },
        { name: 'Staff', value: sanction.staff, inline: true },
        ...(sanction.duration ? [{ name: 'Durée', value: formatDuration(sanction.duration), inline: true }] : []),
        { name: 'Raison', value: sanction.reason.slice(0, 1024) },
      ],
      targetId: userId,
      data: { source: 'fivem', serverKey: server.key, caseNumber: created.caseNumber, identifier: sanction.identifier ?? null, type: sanction.type, reason: sanction.reason, staff: sanction.staff },
    });
    return { caseNumber: created.caseNumber, userId };
  }

  async testConnection(server: FiveMServer): Promise<ServerStatus> {
    if (!server.host) throw new FiveMError('no_host');
    try {
      return await this.getAdapter(server.framework).fetchStatus(server);
    } catch (err) {
      throw new FiveMError('unreachable', err instanceof Error ? err.message : String(err));
    }
  }
}

/** Début de la session en ligne courante (persisté dans `lastStatus.onlineSince` par applyStatus). */
export function onlineSince(server: Pick<FiveMServer, 'lastStatus'>): number | null {
  const raw = server.lastStatus as { onlineSince?: number } | null;
  return raw?.onlineSince && Number.isFinite(raw.onlineSince) ? raw.onlineSince : null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const fivemService = new FiveMService();
