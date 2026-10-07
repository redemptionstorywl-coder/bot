import { PermissionFlagsBits, type Client } from 'discord.js';
import { GuildKind, type FiveMServer, type LogHub, type LogHubGame, type LogHubSource } from '@prisma/client';
import { prisma } from '../database/client';
import { env } from '../config/env';
import { BRAND } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { logDispatchService } from './LogDispatchService';
import { guildConfigService } from './GuildConfigService';
import { translationService, type Translator } from './TranslationService';
import { buildLogEmbed, toHubEmbed } from './logs/embeds';
import { GLOBAL_SOURCE_KEY, type AnyRouteKey } from './logs/routes';
import type { RouteTable } from './logs/delivery';

const log = childLogger('LogHub');

/**
 * Serveur de logs central (hub) : liens hub ⇄ sources (serveurs Discord) et serveurs de jeu, routes (salons du hub),
 * vérification de sécurité des liens, événements « bot » (démarrage, erreurs, déploiements) vers la section générale.
 *
 * Sécurité : une source ne peut être reliée QUE par un propriétaire du bot (OWNER_IDS), le propriétaire de la source ou
 * un membre ayant la permission Administrateur SUR LA SOURCE (membre relu via l'API Discord). Même exigence côté hub.
 * Sans cela, n'importe qui pourrait inviter le bot sur son propre serveur et y aspirer les logs d'un serveur qu'il ne gère pas.
 * Une source est reliée à UN seul hub (MAX_HUBS_PER_SOURCE) ; un hub accepte MAX_HUB_SOURCES sources et MAX_HUB_GAMES jeux.
 */

export const MAX_HUB_SOURCES = 10;
export const MAX_HUB_GAMES = 10;
export const MAX_HUBS_PER_SOURCE = 1;

export type LinkDenyReason = 'bot_not_in_guild' | 'not_member' | 'not_admin';
export type LinkGrant = 'bot_owner' | 'guild_owner' | 'administrator';
export type LinkPermission = { allowed: true; via: LinkGrant } | { allowed: false; reason: LinkDenyReason };

export interface LinkPermissionInput {
  userId: string;
  ownerIds: readonly string[];
  /** Serveur vu par le bot (null = le bot n'y est pas) */
  guild: { ownerId: string } | null;
  /** Membre relu sur ce serveur (null = pas membre) */
  member: { administrator: boolean } | null;
}

/** Règle de sécurité d'un lien hub ⇄ source (fonction pure). */
export function decideLinkPermission(input: LinkPermissionInput): LinkPermission {
  if (!input.guild) return { allowed: false, reason: 'bot_not_in_guild' };
  if (input.ownerIds.includes(input.userId)) return { allowed: true, via: 'bot_owner' };
  if (input.guild.ownerId === input.userId) return { allowed: true, via: 'guild_owner' };
  if (!input.member) return { allowed: false, reason: 'not_member' };
  if (input.member.administrator) return { allowed: true, via: 'administrator' };
  return { allowed: false, reason: 'not_admin' };
}

export type LogHubErrorCode = LinkDenyReason | 'self' | 'is_hub' | 'is_source' | 'already_linked' | 'max_sources' | 'max_games' | 'not_found' | 'game_source_missing' | 'hub_not_admin';

export class LogHubError extends Error {
  constructor(
    readonly code: LogHubErrorCode,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = 'LogHubError';
  }
}

/** Emoji des catégories d'une source selon son type / son nom. */
export function sourceEmoji(kind: GuildKind | string, name: string): string {
  if (/studio/i.test(name)) return '🎬';
  if (kind === GuildKind.BATTLE_ROYALE || /battle\s*royale/i.test(name)) return '🎯';
  if (kind === GuildKind.SHOP || /shop|boutique/i.test(name)) return '🛒';
  if (kind === GuildKind.SCHOOL || /school/i.test(name)) return '🎓';
  if (kind === GuildKind.PRISON || /prison/i.test(name)) return '🔒';
  return '📁';
}

/** Libellé de section par défaut : nom du serveur (64 caractères). */
export const defaultSourceLabel = (name: string): string => name.trim().slice(0, 64) || 'Serveur';

/** Pré-sélection du premier `/template logs` : serveurs « Battle Royale » et « Studio ». */
export const isPreselectedSource = (name: string): boolean => /battle\s*royale|studio/i.test(name);

export interface SourceLink {
  hubGuildId: string;
  sourceGuildId: string;
  label: string;
  emoji: string;
  keepLocal: boolean;
}

export interface GameLink {
  hubGuildId: string;
  fivemServerId: number;
  chat: boolean;
}

export interface SourceCandidate {
  guildId: string;
  name: string;
  kind: GuildKind;
  iconUrl: string | null;
  permission: LinkPermission;
  /** Hub actuel de ce serveur (null = libre) */
  linkedHubId: string | null;
  linkedHubName: string | null;
  /** Ce serveur est lui-même un hub */
  isHub: boolean;
}

export type SystemAction = 'bot.startup' | 'bot.error' | 'bot.deploy' | 'bot.guild_join' | 'bot.guild_leave';

export interface SystemEventContent {
  title: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  color?: number;
}

export class LogHubService {
  private readonly sources = new TTLCache<SourceLink | null>(60_000, 5000);
  private readonly games = new TTLCache<GameLink | null>(60_000, 5000);
  private readonly routes = new TTLCache<RouteTable>(60_000, 500);
  private readonly hubs = new TTLCache<LogHub[]>(60_000, 2);
  private readonly errorThrottle = new TTLCache<true>(10 * 60_000, 500);

  // ───────────── Lecture (caches) ─────────────

  async getSourceLink(sourceGuildId: string): Promise<SourceLink | null> {
    const cached = this.sources.get(sourceGuildId);
    if (cached !== undefined) return cached;
    const row = await prisma.logHubSource.findFirst({ where: { sourceGuildId }, orderBy: { id: 'asc' } }).catch((err) => {
      log.debug({ err, sourceGuildId }, 'Lien de hub illisible');
      return null;
    });
    const link = row ? { hubGuildId: row.hubGuildId, sourceGuildId: row.sourceGuildId, label: row.label, emoji: row.emoji, keepLocal: row.keepLocal } : null;
    this.sources.set(sourceGuildId, link);
    return link;
  }

  async getGameLink(fivemServerId: number): Promise<GameLink | null> {
    const key = String(fivemServerId);
    const cached = this.games.get(key);
    if (cached !== undefined) return cached;
    const row = await prisma.logHubGame.findFirst({ where: { fivemServerId }, orderBy: { id: 'asc' } }).catch(() => null);
    const link = row ? { hubGuildId: row.hubGuildId, fivemServerId: row.fivemServerId, chat: row.chat } : null;
    this.games.set(key, link);
    return link;
  }

  async getRoutes(hubGuildId: string): Promise<RouteTable> {
    const cached = this.routes.get(hubGuildId);
    if (cached) return cached;
    const rows = (await prisma.logRoute.findMany({ where: { hubGuildId } }).catch(() => [])) ?? [];
    const table: RouteTable = {};
    for (const r of rows) (table[r.sourceKey] ??= {})[r.routeKey] = r.channelId;
    this.routes.set(hubGuildId, table);
    return table;
  }

  async getHub(guildId: string): Promise<LogHub | null> {
    return (await this.listHubs()).find((h) => h.guildId === guildId) ?? null;
  }

  async listHubs(): Promise<LogHub[]> {
    const cached = this.hubs.get('all');
    if (cached) return cached;
    const rows = (await prisma.logHub.findMany().catch(() => [])) ?? [];
    this.hubs.set('all', rows);
    return rows;
  }

  async listSources(hubGuildId: string): Promise<LogHubSource[]> {
    return (await prisma.logHubSource.findMany({ where: { hubGuildId }, orderBy: { id: 'asc' } })) ?? [];
  }

  async listGames(hubGuildId: string): Promise<(LogHubGame & { server: FiveMServer | null })[]> {
    const rows = (await prisma.logHubGame.findMany({ where: { hubGuildId }, orderBy: { id: 'asc' } })) ?? [];
    const servers = rows.length ? ((await prisma.fiveMServer.findMany({ where: { id: { in: rows.map((r) => r.fivemServerId) } } })) ?? []) : [];
    return rows.map((r) => ({ ...r, server: servers.find((s) => s.id === r.fivemServerId) ?? null }));
  }

  invalidate(hubGuildId?: string): void {
    this.sources.clear();
    this.games.clear();
    this.hubs.clear();
    if (hubGuildId) this.routes.delete(hubGuildId);
    else this.routes.clear();
  }

  // ───────────── Sécurité ─────────────

  /** Vérifie qu'un utilisateur peut relier `guildId` (source ou hub) : membre relu via l'API Discord (permissions à jour). */
  async checkLinkPermission(client: Client, userId: string, guildId: string): Promise<LinkPermission> {
    const guild = client.guilds.cache.get(guildId) ?? null;
    let member: { administrator: boolean } | null = null;
    if (guild && !env().OWNER_IDS.includes(userId) && guild.ownerId !== userId) {
      const m = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
      member = m ? { administrator: Boolean(m.permissions?.has(PermissionFlagsBits.Administrator)) } : null;
    }
    return decideLinkPermission({ userId, ownerIds: env().OWNER_IDS, guild: guild ? { ownerId: guild.ownerId } : null, member });
  }

  /** Serveurs du bot (hors hub) avec le droit de l'utilisateur à les relier et leur état de liaison. */
  async eligibleSources(client: Client, hubGuildId: string, userId: string): Promise<SourceCandidate[]> {
    const guilds = [...client.guilds.cache.values()].filter((g) => g.id !== hubGuildId).slice(0, 50);
    const [links, hubs] = await Promise.all([prisma.logHubSource.findMany({ where: { sourceGuildId: { in: guilds.map((g) => g.id) } } }).then((r) => r ?? []), this.listHubs()]);
    const kinds = guilds.length ? ((await prisma.guild.findMany({ where: { id: { in: guilds.map((g) => g.id) } }, select: { id: true, kind: true } })) ?? []) : [];
    const out: SourceCandidate[] = [];
    for (const g of guilds) {
      const link = links.find((l) => l.sourceGuildId === g.id) ?? null;
      out.push({
        guildId: g.id,
        name: g.name,
        kind: kinds.find((k) => k.id === g.id)?.kind ?? GuildKind.GENERIC,
        iconUrl: g.iconURL(),
        permission: await this.checkLinkPermission(client, userId, g.id),
        linkedHubId: link?.hubGuildId ?? null,
        linkedHubName: link ? (client.guilds.cache.get(link.hubGuildId)?.name ?? link.hubGuildId) : null,
        isHub: hubs.some((h) => h.guildId === g.id),
      });
    }
    return out.sort((a, b) => Number(b.linkedHubId === hubGuildId) - Number(a.linkedHubId === hubGuildId) || a.name.localeCompare(b.name));
  }

  // ───────────── Liens ─────────────

  /** Crée (ou retrouve) le hub. L'utilisateur doit être propriétaire / administrateur du hub (ou propriétaire du bot). */
  async ensureHub(client: Client, hubGuildId: string, userId: string): Promise<LogHub> {
    const existing = await this.getHub(hubGuildId);
    if (existing) return existing;
    const perm = await this.checkLinkPermission(client, userId, hubGuildId);
    if (!perm.allowed) throw new LogHubError('hub_not_admin');
    if (await this.getSourceLink(hubGuildId)) throw new LogHubError('is_source');
    const hub = await prisma.logHub.upsert({ where: { guildId: hubGuildId }, create: { guildId: hubGuildId, createdById: userId }, update: {} });
    this.invalidate(hubGuildId);
    return hub;
  }

  /**
   * Relie une source au hub après la vérification de sécurité (source ET hub). Idempotent pour une source déjà reliée à ce hub.
   * Erreurs : not_admin / not_member / bot_not_in_guild (droits), self, is_hub, is_source, already_linked, max_sources.
   */
  async linkSource(client: Client, hubGuildId: string, sourceGuildId: string, userId: string, opts: { label?: string; kind?: GuildKind } = {}): Promise<LogHubSource> {
    if (hubGuildId === sourceGuildId) throw new LogHubError('self');
    const source = client.guilds.cache.get(sourceGuildId);
    const sourcePerm = await this.checkLinkPermission(client, userId, sourceGuildId);
    if (!sourcePerm.allowed) throw new LogHubError(sourcePerm.reason, { server: source?.name ?? sourceGuildId });
    const hubPerm = await this.checkLinkPermission(client, userId, hubGuildId);
    if (!hubPerm.allowed) throw new LogHubError('hub_not_admin');
    if (!source) throw new LogHubError('bot_not_in_guild', { server: sourceGuildId });
    if (await this.getHub(sourceGuildId)) throw new LogHubError('is_hub', { server: source.name });
    const existing = (await prisma.logHubSource.findMany({ where: { sourceGuildId } })) ?? [];
    const here = existing.find((l) => l.hubGuildId === hubGuildId);
    if (here) return here;
    if (existing.length >= MAX_HUBS_PER_SOURCE) throw new LogHubError('already_linked', { server: source.name, hub: client.guilds.cache.get(existing[0]!.hubGuildId)?.name ?? existing[0]!.hubGuildId });
    const count = await prisma.logHubSource.count({ where: { hubGuildId } });
    if (count >= MAX_HUB_SOURCES) throw new LogHubError('max_sources', { max: MAX_HUB_SOURCES });
    await this.ensureHub(client, hubGuildId, userId);
    const kind = opts.kind ?? (await prisma.guild.findUnique({ where: { id: sourceGuildId }, select: { kind: true } }))?.kind ?? GuildKind.GENERIC;
    const label = (opts.label ?? defaultSourceLabel(source.name)).slice(0, 64);
    const row = await prisma.logHubSource.create({ data: { hubGuildId, sourceGuildId, label, emoji: sourceEmoji(kind, source.name), linkedById: userId } });
    this.invalidate(hubGuildId);
    log.info({ hub: hubGuildId, source: sourceGuildId, user: userId, via: sourcePerm.via }, 'Source reliée au hub de logs');
    return row;
  }

  /** Délie une source (et ses serveurs de jeu). Les salons et routes du hub sont conservés (historique, re-liaison). */
  async unlinkSource(hubGuildId: string, sourceGuildId: string): Promise<boolean> {
    const removed = await prisma.logHubSource.deleteMany({ where: { hubGuildId, sourceGuildId } });
    const servers = (await prisma.fiveMServer.findMany({ where: { guildId: sourceGuildId }, select: { id: true } })) ?? [];
    if (servers.length) await prisma.logHubGame.deleteMany({ where: { hubGuildId, fivemServerId: { in: servers.map((s) => s.id) } } });
    this.invalidate(hubGuildId);
    return (removed?.count ?? 0) > 0;
  }

  async setKeepLocal(hubGuildId: string, sourceGuildId: string, keepLocal: boolean): Promise<void> {
    const r = await prisma.logHubSource.updateMany({ where: { hubGuildId, sourceGuildId }, data: { keepLocal } });
    if (!r?.count) throw new LogHubError('not_found');
    this.invalidate(hubGuildId);
  }

  async setLabel(hubGuildId: string, sourceGuildId: string, label: string): Promise<void> {
    const clean = label.trim().slice(0, 64);
    if (!clean) return;
    const r = await prisma.logHubSource.updateMany({ where: { hubGuildId, sourceGuildId }, data: { label: clean } });
    if (!r?.count) throw new LogHubError('not_found');
    this.invalidate(hubGuildId);
  }

  /** Relie un serveur de jeu : son serveur Discord doit déjà être une source de ce hub (droits vérifiés à ce moment-là). */
  async linkGame(hubGuildId: string, fivemServerId: number, userId: string, chat = false): Promise<LogHubGame> {
    const server = await prisma.fiveMServer.findUnique({ where: { id: fivemServerId } });
    if (!server) throw new LogHubError('not_found');
    const source = await prisma.logHubSource.findFirst({ where: { hubGuildId, sourceGuildId: server.guildId } });
    if (!source) throw new LogHubError('game_source_missing', { server: server.name });
    const existing = await prisma.logHubGame.findFirst({ where: { hubGuildId, fivemServerId } });
    if (existing) {
      if (existing.chat !== chat) {
        await prisma.logHubGame.updateMany({ where: { hubGuildId, fivemServerId }, data: { chat } });
        this.invalidate(hubGuildId);
      }
      return { ...existing, chat };
    }
    const count = await prisma.logHubGame.count({ where: { hubGuildId } });
    if (count >= MAX_HUB_GAMES) throw new LogHubError('max_games', { max: MAX_HUB_GAMES });
    const row = await prisma.logHubGame.create({ data: { hubGuildId, fivemServerId, chat, linkedById: userId } });
    this.invalidate(hubGuildId);
    return row;
  }

  async unlinkGame(hubGuildId: string, fivemServerId: number): Promise<boolean> {
    const r = await prisma.logHubGame.deleteMany({ where: { hubGuildId, fivemServerId } });
    this.invalidate(hubGuildId);
    return (r?.count ?? 0) > 0;
  }

  async setGameChat(hubGuildId: string, fivemServerId: number, chat: boolean): Promise<void> {
    const r = await prisma.logHubGame.updateMany({ where: { hubGuildId, fivemServerId }, data: { chat } });
    if (!r?.count) throw new LogHubError('not_found');
    this.invalidate(hubGuildId);
  }

  /** Enregistre (ou retire, `null`) le salon d'une route. */
  async setRoute(hubGuildId: string, sourceKey: string, routeKey: AnyRouteKey, channelId: string | null): Promise<void> {
    if (!channelId) await prisma.logRoute.deleteMany({ where: { hubGuildId, sourceKey, routeKey } });
    else await prisma.logRoute.upsert({ where: { hubGuildId_sourceKey_routeKey: { hubGuildId, sourceKey, routeKey } }, create: { hubGuildId, sourceKey, routeKey, channelId }, update: { channelId } });
    this.routes.delete(hubGuildId);
  }

  async setSummaryMessage(hubGuildId: string, messageId: string | null): Promise<void> {
    await prisma.logHub.update({ where: { guildId: hubGuildId }, data: { summaryMessageId: messageId } });
    this.hubs.clear();
  }

  // ───────────── Événements du bot → section générale ─────────────

  /**
   * Envoie un événement « bot » (démarrage, erreur, déploiement, serveur rejoint / quitté) dans le salon bot-système de chaque hub,
   * dans la langue du hub. Les erreurs identiques sont limitées à une toutes les 10 minutes. Ne lance jamais.
   */
  async system(client: Client, action: SystemAction, build: (t: Translator) => SystemEventContent, throttleKey?: string): Promise<number> {
    try {
      if (throttleKey) {
        if (this.errorThrottle.has(throttleKey)) return 0;
        this.errorThrottle.set(throttleKey, true);
      }
      let sent = 0;
      for (const hub of await this.listHubs()) {
        const channelId = (await this.getRoutes(hub.guildId))[GLOBAL_SOURCE_KEY]?.['global.system'];
        if (!channelId) continue;
        const cfg = await guildConfigService.get(hub.guildId).catch(() => null);
        const content = build(translationService.bind(cfg?.defaultLanguage ?? 'fr', hub.guildId));
        const embed = buildLogEmbed({ category: 'SYSTEM', action, title: content.title, description: content.description, fields: content.fields, color: content.color ?? BRAND.colors.primary });
        logDispatchService.enqueue(channelId, toHubEmbed(embed, { name: client.user?.username ?? BRAND.name, iconUrl: client.user?.displayAvatarURL() ?? null }));
        sent++;
      }
      return sent;
    } catch (err) {
      log.warn({ err, action }, 'Événement bot non envoyé aux hubs');
      return 0;
    }
  }

  /** Nom affiché d'une source dans le hub (« 🎯 RS BATTLE ROYALE »). */
  originName(link: Pick<SourceLink, 'emoji' | 'label'>): string {
    return `${link.emoji} ${link.label}`.trim();
  }

}

export const logHubService = new LogHubService();
