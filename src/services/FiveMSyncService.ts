import { PermissionFlagsBits, type Client, type Guild, type GuildMember } from 'discord.js';
import { FiveMActionType, LogCategory, Prisma, type FiveMPlayer, type FiveMServer } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { scheduler } from './SchedulerService';
import { loggingService } from './LoggingService';
import { moderationService } from './ModerationService';
import { whitelistService } from './WhitelistService';
import { guildConfigService } from './GuildConfigService';
import { translationService } from './TranslationService';
import { fivemService, FiveMError, resolveStatus } from './FiveMService';
import { TTLCache } from '../utils/cache';
import { formatDuration } from '../utils/time';
import { childLogger } from '../utils/logger';
import { fivemIdentifierSchema, type NormalizedSanction, type ServerPlayer, type ServerStatus } from './fivem/schemas';
import {
  bulkKey,
  canSetNickname,
  decideConnection,
  EchoGuard,
  echoKey,
  formatNickname,
  parseIdentifiers,
  playerCountChannelName,
  RenameThrottle,
  resolveDiscordId,
  sanitizePlayerName,
  sessionMinutes,
  syncSettingsSchema,
  trackingLicense,
  type ConnectionDecision,
  type EchoKind,
  type GameActionPayload,
  type GameActionType,
  type SyncSettingsPatch,
} from './fivem/sync';

const log = childLogger('FiveMSync');

/** Actions non délivrées plus vieilles que ce délai ne sont plus servies (le /check couvre les bans). */
export const ACTION_MAX_AGE_MS = 7 * 86400_000;
const ACTIONS_PER_POLL = 50;
const NICK_FAIL_TTL_MS = 30 * 60_000;

export interface JoinResult {
  discordId: string | null;
  linked: boolean;
  member: boolean;
  nickname: string | null;
}

export interface SanctionOutcome {
  caseNumber: number | null;
  userId: string | null;
  /** Ce qui a été fait côté Discord */
  discord: 'banned' | 'unbanned' | 'kicked' | 'warned' | 'recorded';
  /** Nombre d'autres serveurs FiveM du guild vers lesquels l'action a été relayée */
  propagated: number;
}

export interface PlayerSummary {
  online: boolean;
  serverKey: string | null;
  serverName: string | null;
  lastSeenAt: Date | null;
  playtimeMinutes: number;
  name: string | null;
  licenses: string[];
}

type OnlineEntry = { license: string; id: number; name: string; discordId: string | null };

/**
 * Synchronisation jeu ⇄ Discord : liaison automatique des comptes, bans/kicks/warns dans les deux sens,
 * pseudo en jeu → surnom, rôles « lié » / « en jeu », salon compteur, temps de jeu, contrôle à la connexion.
 * La logique pure (décisions, formats, throttle, anti-écho) est dans `./fivem/sync.ts`.
 */
export class FiveMSyncService {
  private client: Client | null = null;
  private tasksRegistered = false;
  private readonly echo = new EchoGuard(30_000);
  private readonly renames = new RenameThrottle();
  /** serverId → licence → joueur en ligne (vu par ce process) */
  private readonly online = new Map<number, Map<string, OnlineEntry>>();
  /** serverId déjà réconciliés avec la base depuis le démarrage */
  private readonly reconciled = new Set<number>();
  /** `${guildId}:${userId}` → dernier surnom appliqué (ou `fail:<nom>`) */
  private readonly nickCache = new TTLCache<string>(6 * 3600_000, 20_000);
  /** `${guildId}:${userId}` → ban Discord (60 s) */
  private readonly banCache = new TTLCache<{ active: boolean; reason: string | null; expiresAt: Date | null }>(60_000, 10_000);
  /** Actions non persistées (base indisponible) : `${guildId}:${serverKey}` → actions */
  private readonly memoryQueue = new Map<string, { type: GameActionType; payload: GameActionPayload; createdAt: Date }[]>();
  private readonly statusListener = (server: FiveMServer, status: ServerStatus, previous: FiveMServer) => this.onStatus(server, status, previous);

  attach(client: Client): void {
    this.client = client;
    fivemService.attach(client);
    fivemService.onStatus(this.statusListener);
  }

  registerTasks(): void {
    if (this.tasksRegistered || scheduler.registered.includes('fivem:sync:counter')) return;
    this.tasksRegistered = true;
    scheduler.register({ name: 'fivem:sync:counter', intervalMs: 60_000, run: () => this.flushRenames() });
    scheduler.register({ name: 'fivem:sync:cleanup', intervalMs: 3600_000, runOnStart: true, run: () => this.cleanupActions() });
  }

  // ───────────── Anti-écho ─────────────

  markFromGame(kind: EchoKind, guildId: string, userId: string): void {
    this.echo.mark(echoKey('fromGame', kind, guildId, userId));
  }

  isFromGame(kind: EchoKind, guildId: string, userId: string): boolean {
    return this.echo.has(echoKey('fromGame', kind, guildId, userId));
  }

  /**
   * Opération de masse côté Discord (/unban-all) : à appeler juste avant chaque action Discord.
   * `skip` : l'événement Discord qui suit ne sera PAS relayé vers les serveurs FiveM (anti-écho, 30 s) ;
   * `quiet` : il est relayé comme d'habitude, mais sans log « Discord → FiveM » par membre.
   */
  markBulk(kind: EchoKind, guildId: string, userId: string, mode: 'skip' | 'quiet'): void {
    this.echo.mark(bulkKey(mode, kind, guildId, userId));
  }

  /** Lit et consomme un marqueur d'opération de masse. */
  private takeBulk(mode: 'skip' | 'quiet', kind: EchoKind, guildId: string, userId: string): boolean {
    const key = bulkKey(mode, kind, guildId, userId);
    const hit = this.echo.has(key);
    if (hit) this.echo.clear(key);
    return hit;
  }

  invalidateBan(guildId: string, userId: string): void {
    this.banCache.delete(`${guildId}:${userId}`);
  }

  // ───────────── Réglages ─────────────

  /** Met à jour les options de synchronisation d'un serveur (validées par Zod). Utilisé par le panneau `/config module:fivem` et le dashboard. */
  async updateSyncSettings(guildId: string, key: string, patch: unknown): Promise<FiveMServer> {
    const data: SyncSettingsPatch = syncSettingsSchema.parse(patch);
    const before = await fivemService.requireServer(guildId, key);
    const updated = Object.keys(data).length ? await fivemService.updateServer(guildId, key, data) : before;
    if (data.playerCountChannelId !== undefined && before.playerCountChannelId && before.playerCountChannelId !== data.playerCountChannelId) this.renames.forget(before.playerCountChannelId);
    if (data.playerCountChannelId) await this.requestCounterRename(updated).catch(() => null);
    return updated;
  }

  // ───────────── Helpers Discord ─────────────

  private guild(guildId: string): Guild | null {
    return this.client?.guilds.cache.get(guildId) ?? null;
  }

  private async fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
    return guild.members.fetch(userId).catch(() => null);
  }

  private async setRole(member: GuildMember, roleId: string | null, add: boolean, reason: string): Promise<void> {
    if (!roleId) return;
    const role = member.guild.roles.cache.get(roleId);
    if (!role || !role.editable) return;
    const has = member.roles.cache.has(roleId);
    if (has === add) return;
    try {
      if (add) await member.roles.add(roleId, reason);
      else await member.roles.remove(roleId, reason);
    } catch (err) {
      log.debug({ err, guild: member.guild.id, roleId }, 'Rôle FiveM non appliqué');
    }
  }

  private async translator(guildId: string) {
    const cfg = await guildConfigService.get(guildId);
    const lang = cfg?.defaultLanguage ?? 'fr';
    return { t: translationService.bind(lang, guildId), lang };
  }

  // ───────────── Liaison des comptes ─────────────

  /**
   * Lie le profil Battle Royale du membre à la licence. Si `proven` (identifiant `discord:` fourni par FiveM),
   * la licence est retirée d'un éventuel autre profil qui l'aurait revendiquée.
   */
  private async linkBattleRoyale(guildId: string, userId: string, license: string, nickname: string | null, proven: boolean): Promise<boolean> {
    const mine = await prisma.battleRoyaleProfile.findUnique({ where: { guildId_userId: { guildId, userId } }, select: { identifier: true } });
    if (mine?.identifier === license) return false;
    const other = await prisma.battleRoyaleProfile.findFirst({ where: { guildId, identifier: license, NOT: { userId } }, select: { id: true, userId: true } });
    if (other) {
      if (!proven) return false;
      await prisma.battleRoyaleProfile.update({ where: { id: other.id }, data: { identifier: null } });
      log.info({ guildId, license, from: other.userId, to: userId }, 'Licence réattribuée (preuve discord:)');
    }
    await prisma.battleRoyaleProfile.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, identifier: license, nickname },
      update: { identifier: license },
    });
    return true;
  }

  /** Liaison manuelle (panneaux `/config module:fivem` et `battleroyale`) : membre ⇄ licence, sur FiveMPlayer et le profil BR. */
  async linkManually(guildId: string, userId: string, license: string, actorId: string): Promise<FiveMPlayer> {
    const lic = fivemIdentifierSchema.parse(license.trim());
    if (!lic.startsWith('license')) throw new FiveMError('invalid_key', 'license attendue');
    const player = await prisma.fiveMPlayer.upsert({
      where: { guildId_license: { guildId, license: lic } },
      create: { guildId, license: lic, discordId: userId, name: '—' },
      update: { discordId: userId },
    });
    await this.linkBattleRoyale(guildId, userId, lic, null, true);
    const guild = this.guild(guildId);
    const member = guild ? await this.fetchMember(guild, userId) : null;
    if (member) for (const s of await fivemService.listServers(guildId)) await this.setRole(member, s.linkedRoleId, true, 'FiveM : compte lié');
    await loggingService.log({ guildId, category: LogCategory.SYSTEM, action: 'fivem.link.manual', title: '🔗 FiveM — liaison manuelle', description: `<@${userId}> ⇄ \`${lic}\``, actorId, targetId: userId, data: { license: lic } });
    return player;
  }

  // ───────────── Connexion / déconnexion ─────────────

  private onlineMap(serverId: number): Map<string, OnlineEntry> {
    let m = this.online.get(serverId);
    if (!m) this.online.set(serverId, (m = new Map()));
    return m;
  }

  /** Arrivée en jeu (REST /players/join, socket player:join, nouveau joueur dans un statut). */
  async handleJoin(server: FiveMServer, player: ServerPlayer): Promise<JoinResult> {
    const parsed = parseIdentifiers(player.identifiers);
    const license = trackingLicense(parsed);
    const cleanName = sanitizePlayerName(player.name) ?? player.name.slice(0, 128);
    const now = new Date();
    let existing: FiveMPlayer | null = null;
    if (license) {
      // Inscrit avant tout await : un statut concurrent ne re-déclenchera pas la même arrivée.
      this.onlineMap(server.id).set(license, { license, id: player.id, name: player.name, discordId: parsed.discordId ?? null });
      existing = await prisma.fiveMPlayer.findUnique({ where: { guildId_license: { guildId: server.guildId, license } } });
    }
    const known = existing?.discordId ?? (license && !parsed.discordId ? await fivemService.findDiscordIdByLicense(server.guildId, license) : null);
    const discordId = resolveDiscordId({ identifiers: player.identifiers, knownByLicense: known });
    if (license) {
      const keepSession = existing?.online && existing.sessionStartedAt;
      await prisma.fiveMPlayer.upsert({
        where: { guildId_license: { guildId: server.guildId, license } },
        create: { guildId: server.guildId, license, discordId, steam: parsed.steam ?? null, fivemId: parsed.fivemId ?? null, name: cleanName.slice(0, 128), serverKey: server.key, lastSeenAt: now, sessionStartedAt: now, online: true },
        update: {
          ...(discordId ? { discordId } : {}),
          ...(parsed.steam ? { steam: parsed.steam } : {}),
          ...(parsed.fivemId ? { fivemId: parsed.fivemId } : {}),
          name: cleanName.slice(0, 128),
          serverKey: server.key,
          lastSeenAt: now,
          online: true,
          ...(keepSession ? {} : { sessionStartedAt: now }),
        },
      });
      const entry = this.onlineMap(server.id).get(license);
      if (entry) entry.discordId = discordId;
    }

    const result: JoinResult = { discordId, linked: !!discordId, member: false, nickname: null };
    const guild = this.guild(server.guildId);
    if (!discordId || !guild) return result;
    const member = await this.fetchMember(guild, discordId);
    if (!member) return result;
    result.member = true;
    if (license) {
      const linkedNow = await this.linkBattleRoyale(server.guildId, discordId, license, cleanName, parsed.discordId === discordId).catch((err) => {
        log.warn({ err, guild: server.guildId }, 'Liaison BR automatique impossible');
        return false;
      });
      if (linkedNow) {
        await loggingService.log({ guildId: server.guildId, category: LogCategory.BATTLE_ROYALE, action: 'fivem.link.auto', title: '🔗 FiveM — compte lié automatiquement', description: `<@${discordId}> ⇄ \`${license}\` (${cleanName})`, targetId: discordId, data: { license, serverKey: server.key }, skipDatabase: false });
      }
    }
    await this.setRole(member, server.linkedRoleId, true, 'FiveM : compte lié');
    await this.setRole(member, server.onlineRoleId, true, 'FiveM : en jeu');
    result.nickname = await this.syncNickname(server, member, player.name, player.id);
    return result;
  }

  /**
   * Départ (REST /players/leave, socket player:leave, joueur disparu d'un statut, serveur hors ligne).
   * Ajoute la durée de session au temps de jeu (FiveMPlayer + profil BR) et retire le rôle « en jeu ».
   */
  async handleLeave(server: FiveMServer, ref: { license?: string | null; id?: number | null; identifiers?: string[] }, endedAt = new Date()): Promise<{ minutes: number; discordId: string | null }> {
    const map = this.onlineMap(server.id);
    let license = ref.license ?? trackingLicense(parseIdentifiers(ref.identifiers)) ?? null;
    if (!license && ref.id !== undefined && ref.id !== null) license = [...map.values()].find((e) => e.id === ref.id)?.license ?? null;
    if (!license) return { minutes: 0, discordId: null };
    map.delete(license);
    const row = await prisma.fiveMPlayer.findUnique({ where: { guildId_license: { guildId: server.guildId, license } } });
    if (!row || !row.online) return { minutes: 0, discordId: row?.discordId ?? null };
    const minutes = sessionMinutes(row.sessionStartedAt, endedAt);
    await prisma.fiveMPlayer.update({ where: { id: row.id }, data: { online: false, sessionStartedAt: null, lastSeenAt: endedAt, playtimeMinutes: { increment: minutes } } });
    if (row.discordId && minutes > 0) await prisma.battleRoyaleProfile.updateMany({ where: { guildId: server.guildId, userId: row.discordId }, data: { playtimeMinutes: { increment: minutes } } });
    if (row.discordId && server.onlineRoleId) {
      const stillOnline = await prisma.fiveMPlayer.count({ where: { guildId: server.guildId, discordId: row.discordId, online: true } });
      const guild = this.guild(server.guildId);
      const member = !stillOnline && guild ? await this.fetchMember(guild, row.discordId) : null;
      if (member) await this.setRole(member, server.onlineRoleId, false, 'FiveM : hors jeu');
    }
    return { minutes, discordId: row.discordId };
  }

  /** Ferme toutes les sessions d'un serveur (hors ligne / démarrage) et retire le rôle « en jeu » à tous. */
  async closeAllSessions(server: FiveMServer, endedAt = server.lastSeenAt ?? new Date()): Promise<number> {
    const rows = await prisma.fiveMPlayer.findMany({ where: { guildId: server.guildId, serverKey: server.key, online: true }, select: { license: true } });
    const licenses = new Set<string>([...this.onlineMap(server.id).keys(), ...rows.map((r) => r.license).filter((l): l is string => !!l)]);
    const end = endedAt.getTime() > Date.now() ? new Date() : endedAt;
    for (const license of licenses) await this.handleLeave(server, { license }, end).catch((err) => log.warn({ err, server: server.key }, 'Fermeture de session impossible'));
    this.online.delete(server.id);
    await this.clearOnlineRole(server);
    return licenses.size;
  }

  /** Retire le rôle « en jeu » à tous les membres qui l'ont (si plus aucun serveur du guild ne les voit en ligne). */
  private async clearOnlineRole(server: FiveMServer): Promise<void> {
    if (!server.onlineRoleId) return;
    const guild = this.guild(server.guildId);
    const role = guild?.roles.cache.get(server.onlineRoleId);
    if (!guild || !role || !role.editable) return;
    if (role.members.size === 0) await guild.members.fetch().catch(() => null);
    const stillOnline = new Set(
      (await prisma.fiveMPlayer.findMany({ where: { guildId: server.guildId, online: true, discordId: { not: null } }, select: { discordId: true } })).map((r) => r.discordId!),
    );
    for (const member of role.members.values()) if (!stillOnline.has(member.id)) await this.setRole(member, role.id, false, 'FiveM : serveur hors ligne');
  }

  // ───────────── Statut → diff des joueurs ─────────────

  private async onStatus(server: FiveMServer, status: ServerStatus, previous: FiveMServer): Promise<void> {
    if (!status.online) {
      await this.closeAllSessions(server, previous.lastSeenAt ?? new Date());
      await this.requestCounterRename(server);
      return;
    }
    const map = this.onlineMap(server.id);
    const present = new Map<string, ServerPlayer>();
    for (const p of status.playerList) {
      const lic = trackingLicense(parseIdentifiers(p.identifiers));
      if (lic) present.set(lic, p);
    }
    // Liste vide alors que `players` > 0 : statut sans détail → ne rien déduire des départs.
    const hasDetail = status.playerList.length > 0 || status.players === 0;
    if (hasDetail && !this.reconciled.has(server.id)) {
      this.reconciled.add(server.id);
      const rows = await prisma.fiveMPlayer.findMany({ where: { guildId: server.guildId, serverKey: server.key, online: true }, select: { license: true } });
      for (const r of rows) if (r.license && !present.has(r.license)) await this.handleLeave(server, { license: r.license }).catch(() => null);
    }
    for (const [lic, p] of present) {
      const known = map.get(lic);
      if (!known || known.name !== p.name || known.id !== p.id) await this.handleJoin(server, p).catch((err) => log.warn({ err, server: server.key }, 'Arrivée joueur non traitée'));
    }
    if (hasDetail) for (const lic of [...map.keys()]) if (!present.has(lic)) await this.handleLeave(server, { license: lic }).catch(() => null);
    await this.requestCounterRename(server);
  }

  // ───────────── Pseudo → surnom ─────────────

  /** Applique le surnom formaté si nécessaire. Retourne le surnom appliqué/actuel, ou null si ignoré. */
  async syncNickname(server: FiveMServer, member: GuildMember, rawName: string, playerId?: number): Promise<string | null> {
    if (!server.syncNicknames) return null;
    let level: number | null = null;
    if (server.nicknameFormat.includes('{level}')) level = (await prisma.battleRoyaleProfile.findUnique({ where: { guildId_userId: { guildId: member.guild.id, userId: member.id } }, select: { level: true } }))?.level ?? 1;
    const desired = formatNickname(server.nicknameFormat, { name: rawName, id: playerId ?? null, level });
    if (!desired) return null;
    const key = `${member.guild.id}:${member.id}`;
    if (member.nickname === desired) {
      this.nickCache.set(key, desired);
      return desired;
    }
    if (this.nickCache.get(key) === `fail:${desired}`) return null;
    const me = member.guild.members.me;
    const allowed = !!me && canSetNickname({ isOwner: member.guild.ownerId === member.id, botHasPermission: me.permissions.has(PermissionFlagsBits.ManageNicknames), botHighestPosition: me.roles.highest.position, memberHighestPosition: member.roles.highest.position });
    if (!allowed) {
      this.nickCache.set(key, `fail:${desired}`, NICK_FAIL_TTL_MS);
      return null;
    }
    try {
      await member.setNickname(desired, 'FiveM : pseudo en jeu');
      this.nickCache.set(key, desired);
      return desired;
    } catch (err) {
      log.debug({ err, guild: member.guild.id, user: member.id }, 'Surnom non appliqué');
      this.nickCache.set(key, `fail:${desired}`, NICK_FAIL_TTL_MS);
      return null;
    }
  }

  /** `POST /players/name` : pseudo choisi en jeu. */
  async handleNameChange(server: FiveMServer, input: { discordId?: string; identifiers: string[]; name: string; id?: number }): Promise<{ discordId: string | null; nickname: string | null }> {
    const parsed = parseIdentifiers(input.identifiers);
    const license = trackingLicense(parsed);
    const clean = sanitizePlayerName(input.name);
    if (license && clean) {
      await prisma.fiveMPlayer.updateMany({ where: { guildId: server.guildId, license }, data: { name: clean.slice(0, 128) } });
      const entry = this.onlineMap(server.id).get(license);
      if (entry) entry.name = input.name;
    }
    const known = license && !input.discordId && !parsed.discordId ? await fivemService.findDiscordIdByLicense(server.guildId, license) : null;
    const discordId = resolveDiscordId({ discordId: input.discordId, identifiers: input.identifiers, knownByLicense: known });
    const guild = this.guild(server.guildId);
    if (!discordId || !guild) return { discordId, nickname: null };
    const member = await this.fetchMember(guild, discordId);
    if (!member) return { discordId, nickname: null };
    return { discordId, nickname: await this.syncNickname(server, member, input.name, input.id) };
  }

  // ───────────── Salon compteur ─────────────

  private async counterName(server: FiveMServer): Promise<string> {
    const { t } = await this.translator(server.guildId);
    const st = resolveStatus(server);
    return playerCountChannelName(
      { online: st.online, maintenance: st.maintenance, players: st.players, maxPlayers: st.maxPlayers },
      { online: t('fivem.counter.online'), offline: t('fivem.counter.offline'), maintenance: t('fivem.counter.maintenance') },
    );
  }

  async requestCounterRename(server: FiveMServer): Promise<void> {
    if (!server.playerCountChannelId || !this.client) return;
    const channel = await this.client.channels.fetch(server.playerCountChannelId).catch(() => null);
    if (!channel || channel.isDMBased() || !('setName' in channel)) return;
    this.renames.seed(channel.id, channel.name);
    const desired = await this.counterName(server);
    if (!this.renames.request(channel.id, desired)) return;
    await this.applyRename(channel.id, desired);
  }

  private async applyRename(channelId: string, name: string): Promise<void> {
    const channel = await this.client?.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.isDMBased() || !('setName' in channel)) return;
    try {
      await channel.setName(name, 'FiveM : compteur de joueurs');
      this.renames.applied(channelId, name);
    } catch (err) {
      // Échec (permissions, rate limit) : on attend la prochaine fenêtre.
      this.renames.applied(channelId, channel.name);
      log.debug({ err, channelId }, 'Renommage du salon compteur impossible');
    }
  }

  private async flushRenames(): Promise<void> {
    for (const { channelId, name } of this.renames.due()) await this.applyRename(channelId, name);
  }

  // ───────────── Démarrage ─────────────

  /** Au démarrage : serveurs hors ligne → sessions fermées, rôle « en jeu » retiré, compteur à jour. */
  async onReady(): Promise<void> {
    const servers = await prisma.fiveMServer.findMany({ where: { enabled: true } });
    for (const server of servers) {
      try {
        if (!resolveStatus(server).online) await this.closeAllSessions(server);
        await this.requestCounterRename(server);
      } catch (err) {
        log.warn({ err, server: server.key }, 'Réconciliation FiveM au démarrage impossible');
      }
    }
  }

  // ───────────── Ban Discord / contrôle de connexion ─────────────

  /** Ban Discord actif (cache 60 s) : API Discord si le bot est sur le serveur, sinon table Ban. */
  async getDiscordBan(guildId: string, userId: string): Promise<{ active: boolean; reason: string | null; expiresAt: Date | null }> {
    const key = `${guildId}:${userId}`;
    const cached = this.banCache.get(key);
    if (cached) return cached;
    const row = await prisma.ban.findFirst({ where: { guildId, userId, active: true }, orderBy: { createdAt: 'desc' } });
    const guild = this.guild(guildId);
    let result: { active: boolean; reason: string | null; expiresAt: Date | null };
    if (guild) {
      const ban = await guild.bans.fetch({ user: userId, force: true }).catch(() => null);
      result = ban ? { active: true, reason: ban.reason ?? row?.reason ?? null, expiresAt: row?.expiresAt ?? null } : { active: false, reason: null, expiresAt: null };
    } else {
      const active = !!row && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
      result = { active, reason: active ? (row?.reason ?? null) : null, expiresAt: active ? (row?.expiresAt ?? null) : null };
    }
    this.banCache.set(key, result);
    return result;
  }

  /** `POST /check` : autorise ou refuse la connexion d'un joueur (deferrals). */
  async checkConnection(server: FiveMServer, identifiers: string[]): Promise<ConnectionDecision & { message?: string }> {
    const parsed = parseIdentifiers(identifiers);
    const license = trackingLicense(parsed);
    const known = license && !parsed.discordId ? await fivemService.findDiscordIdByLicense(server.guildId, license) : null;
    const discordId = resolveDiscordId({ identifiers, knownByLicense: known });
    const guild = this.guild(server.guildId);
    const member = discordId && guild ? await this.fetchMember(guild, discordId) : null;
    const isMember = discordId ? (guild ? !!member : null) : null;
    const ban = discordId ? await this.getDiscordBan(server.guildId, discordId) : null;
    let whitelisted = false;
    if (discordId) whitelisted = (await whitelistService.check(server.guildId, discordId)).whitelisted;
    if (!whitelisted && license) whitelisted = (await whitelistService.check(server.guildId, license)).whitelisted;
    const decision = decideConnection({
      discordId,
      isMember,
      ban,
      requireDiscord: server.requireDiscord,
      requireRoleId: server.requireRoleId,
      hasRequiredRole: !!(member && server.requireRoleId && member.roles.cache.has(server.requireRoleId)),
      requireWhitelist: server.requireWhitelist,
      whitelisted,
    });
    if (decision.allowed) return decision;
    const { t, lang } = await this.translator(server.guildId);
    const vars: Record<string, string> = { server: guild?.name ?? server.name, reason: decision.banReason ?? t('fivem.check.no_reason'), role: (server.requireRoleId && guild?.roles.cache.get(server.requireRoleId)?.name) || '—' };
    let message = t(`fivem.check.${decision.reason}`, vars);
    if (decision.reason === 'banned' && decision.banExpiresAt) message += ` ${t('fivem.check.until', { duration: formatDuration(Math.max(60, Math.floor((new Date(decision.banExpiresAt).getTime() - Date.now()) / 1000)), lang) })}`;
    return { ...decision, message };
  }

  // ───────────── Sanctions jeu → Discord ─────────────

  /** Sanction prise en jeu (REST /sanctions, socket `sanction`) : appliquée sur Discord selon la config du serveur. */
  async handleSanction(server: FiveMServer, sanction: NormalizedSanction): Promise<SanctionOutcome> {
    const userId = await fivemService.resolveSanctionTarget(server.guildId, sanction);
    const guild = this.guild(server.guildId);
    const bot = this.client?.user ?? null;
    const reason = `[FiveM] ${sanction.reason} (${sanction.staff})`.slice(0, 450);
    const metadata = { source: 'fivem', serverKey: server.key, identifier: sanction.identifier ?? null, staff: sanction.staff };
    const record = async (): Promise<SanctionOutcome> => {
      const r = await fivemService.recordSanction(server, sanction, userId);
      return { caseNumber: r.caseNumber, userId, discord: 'recorded', propagated: 0 };
    };
    let outcome: SanctionOutcome | null = null;

    if (guild && bot && userId) {
      try {
        switch (sanction.type) {
          case 'BAN': {
            if (!server.syncBansToDiscord) break;
            const already = await guild.bans.fetch({ user: userId, force: true }).catch(() => null);
            if (already) break;
            const user = await guild.client.users.fetch(userId).catch(() => null);
            if (!user) break;
            // Membre présent mais hors de portée (propriétaire, rôle ≥ bot) : on n'essaie pas (la case serait créée avant l'échec).
            const target = await this.fetchMember(guild, userId);
            if (target && !target.bannable) break;
            this.markFromGame('ban', guild.id, userId);
            const r = await moderationService.ban({ guild, target: user, moderator: bot, reason, duration: sanction.duration ?? null, metadata });
            this.invalidateBan(guild.id, userId);
            outcome = { caseNumber: r.sanction.caseNumber, userId, discord: 'banned', propagated: 0 };
            break;
          }
          case 'UNBAN': {
            if (!server.syncBansToDiscord) break;
            const banned = await guild.bans.fetch({ user: userId, force: true }).catch(() => null);
            if (!banned) break;
            this.markFromGame('unban', guild.id, userId);
            const r = await moderationService.unban({ guild, userId, moderator: bot, reason, metadata });
            this.invalidateBan(guild.id, userId);
            outcome = { caseNumber: r.sanction.caseNumber, userId, discord: 'unbanned', propagated: 0 };
            break;
          }
          case 'KICK': {
            if (!server.syncKicks) break;
            const member = await this.fetchMember(guild, userId);
            if (!member?.kickable) break;
            this.markFromGame('kick', guild.id, userId);
            const r = await moderationService.kick({ guild, target: member, moderator: bot, reason, metadata });
            outcome = { caseNumber: r.sanction.caseNumber, userId, discord: 'kicked', propagated: 0 };
            break;
          }
          case 'WARN': {
            const member = await this.fetchMember(guild, userId);
            if (!member) break;
            const r = await moderationService.warn({ guild, target: member, moderator: bot, reason });
            outcome = { caseNumber: r.sanction.caseNumber, userId, discord: 'warned', propagated: 0 };
            break;
          }
        }
      } catch (err) {
        log.warn({ err, guild: server.guildId, user: userId, type: sanction.type }, 'Sanction FiveM non appliquée sur Discord');
        outcome = null;
      }
    }
    if (!outcome) outcome = await record();

    // Relais vers les AUTRES serveurs FiveM du guild (le serveur d'origine a déjà appliqué la sanction).
    if (sanction.type === 'BAN' || sanction.type === 'UNBAN') {
      const parsed = parseIdentifiers([...(sanction.identifiers ?? []), ...(sanction.identifier ? [sanction.identifier] : [])]);
      const payload: GameActionPayload = {
        discordId: userId,
        license: trackingLicense(parsed) ?? sanction.identifier ?? null,
        identifiers: sanction.identifiers,
        reason: sanction.reason,
        staff: sanction.staff,
        expiresAt: sanction.type === 'BAN' && sanction.duration ? new Date(Date.now() + sanction.duration * 1000).toISOString() : null,
      };
      outcome.propagated = await this.pushToGuild(server.guildId, sanction.type, payload, { exceptServerId: server.id });
    }
    return outcome;
  }

  // ───────────── Actions Discord → jeu ─────────────

  /** Licences connues d'un membre (FiveMPlayer + profil BR). */
  async licensesOf(guildId: string, userId: string): Promise<string[]> {
    const rows = await prisma.fiveMPlayer.findMany({ where: { guildId, discordId: userId }, select: { license: true } });
    const profile = await prisma.battleRoyaleProfile.findUnique({ where: { guildId_userId: { guildId, userId } }, select: { identifier: true } });
    return [...new Set([...rows.map((r) => r.license), profile?.identifier].filter((l): l is string => !!l))];
  }

  /** Pousse une action vers un serveur : socket si connecté (+ trace en base), sinon file persistée lue par GET /actions. */
  async pushAction(server: FiveMServer, type: GameActionType, payload: GameActionPayload): Promise<{ delivered: boolean; id: number | null }> {
    const event = `player:${type.toLowerCase()}` as 'player:ban' | 'player:unban' | 'player:kick' | 'player:message';
    let id: number | null = null;
    try {
      const row = await prisma.fiveMPendingAction.create({ data: { guildId: server.guildId, serverKey: server.key, type: type as FiveMActionType, payload: payload as Prisma.InputJsonValue } });
      id = row.id;
    } catch (err) {
      log.warn({ err, server: server.key }, 'Action FiveM non persistée : file mémoire');
    }
    const delivered = fivemService.emitToServer(server, event, { ...payload, ...(id ? { id } : {}) }) > 0;
    if (delivered && id) await prisma.fiveMPendingAction.update({ where: { id }, data: { deliveredAt: new Date() } }).catch(() => null);
    if (!delivered && !id) {
      const k = `${server.guildId}:${server.key}`;
      const q = this.memoryQueue.get(k) ?? [];
      q.push({ type, payload, createdAt: new Date() });
      this.memoryQueue.set(k, q.slice(-200));
    }
    return { delivered, id };
  }

  /** Pousse une action vers tous les serveurs du guild ayant `syncBansToGame` (bans/unbans) ou tous (kick/message). */
  async pushToGuild(guildId: string, type: GameActionType, payload: GameActionPayload, opts: { exceptServerId?: number } = {}): Promise<number> {
    const servers = (await fivemService.listServers(guildId)).filter((s) => s.enabled && s.id !== opts.exceptServerId && (type === 'BAN' || type === 'UNBAN' ? s.syncBansToGame : true));
    for (const s of servers) await this.pushAction(s, type, payload);
    return servers.length;
  }

  /** `GET /actions` : actions en attente pour ce serveur (marquées délivrées). */
  async takeActions(server: FiveMServer): Promise<{ id: number | null; type: GameActionType; createdAt: string; [k: string]: unknown }[]> {
    const since = new Date(Date.now() - ACTION_MAX_AGE_MS);
    const rows = await prisma.fiveMPendingAction.findMany({ where: { guildId: server.guildId, serverKey: server.key, deliveredAt: null, createdAt: { gte: since } }, orderBy: { id: 'asc' }, take: ACTIONS_PER_POLL });
    if (rows.length) await prisma.fiveMPendingAction.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deliveredAt: new Date() } });
    const out: { id: number | null; type: GameActionType; createdAt: string; [k: string]: unknown }[] = rows.map((r) => ({ ...(r.payload as Record<string, unknown>), id: r.id, type: r.type, createdAt: r.createdAt.toISOString() }));
    const k = `${server.guildId}:${server.key}`;
    const mem = this.memoryQueue.get(k);
    if (mem?.length) {
      this.memoryQueue.delete(k);
      for (const a of mem) out.push({ ...a.payload, id: null, type: a.type, createdAt: a.createdAt.toISOString() });
    }
    return out;
  }

  private async cleanupActions(): Promise<void> {
    const now = Date.now();
    await prisma.fiveMPendingAction.deleteMany({ where: { OR: [{ deliveredAt: { lt: new Date(now - ACTION_MAX_AGE_MS) } }, { deliveredAt: null, createdAt: { lt: new Date(now - 4 * ACTION_MAX_AGE_MS) } }] } }).catch(() => null);
  }

  /** Ban / unban Discord (événements GuildBanAdd / GuildBanRemove) → serveurs de jeu. */
  async onDiscordBan(guild: Guild, userId: string, kind: 'ban' | 'unban'): Promise<number> {
    this.invalidateBan(guild.id, userId);
    if (this.takeBulk('skip', kind, guild.id, userId) || this.isFromGame(kind, guild.id, userId)) return 0;
    const quiet = this.takeBulk('quiet', kind, guild.id, userId);
    const servers = (await fivemService.listServers(guild.id)).filter((s) => s.enabled && s.syncBansToGame);
    if (!servers.length) return 0;
    let reason: string | null = null;
    let expiresAt: string | null = null;
    if (kind === 'ban') {
      reason = (await guild.bans.fetch({ user: userId, force: true }).catch(() => null))?.reason ?? null;
      // La case est créée avant l'appel Discord par ModerationService.ban : son expiresAt est déjà connu.
      const recent = await prisma.sanction.findFirst({ where: { guildId: guild.id, userId, type: { in: ['BAN', 'TEMPBAN'] }, createdAt: { gte: new Date(Date.now() - 120_000) } }, orderBy: { id: 'desc' } });
      const meta = (recent?.metadata ?? null) as { expiresAt?: string | null } | null;
      expiresAt = recent?.type === 'TEMPBAN' && meta?.expiresAt ? meta.expiresAt : null;
      reason = reason ?? recent?.reason ?? null;
    }
    const licenses = await this.licensesOf(guild.id, userId);
    const payload: GameActionPayload = { discordId: userId, license: licenses[0] ?? null, identifiers: licenses, reason, expiresAt, staff: 'Discord' };
    for (const s of servers) await this.pushAction(s, kind === 'ban' ? 'BAN' : 'UNBAN', payload);
    if (quiet) return servers.length;
    await loggingService.log({
      guildId: guild.id,
      category: LogCategory.MODERATION,
      action: `fivem.sync.${kind}`,
      title: kind === 'ban' ? '🎮 Ban Discord → serveurs FiveM' : '🎮 Unban Discord → serveurs FiveM',
      description: `<@${userId}> → ${servers.map((s) => `\`${s.key}\``).join(', ')}`,
      color: kind === 'ban' ? BRAND.colors.danger : BRAND.colors.primary,
      targetId: userId,
      data: { kind, servers: servers.map((s) => s.key), licenses, expiresAt },
      skipDatabase: true,
    });
    return servers.length;
  }

  // ───────────── Profil ─────────────

  async getPlayerSummary(guildId: string, userId: string): Promise<PlayerSummary | null> {
    const rows = await prisma.fiveMPlayer.findMany({ where: { guildId, discordId: userId }, orderBy: { lastSeenAt: 'desc' } });
    if (!rows.length) return null;
    const online = rows.find((r) => r.online) ?? null;
    const latest = rows[0]!;
    const serverKey = online?.serverKey ?? latest.serverKey ?? null;
    const server = serverKey ? await fivemService.getServer(guildId, serverKey) : null;
    return {
      online: !!online,
      serverKey,
      serverName: server?.name ?? serverKey,
      lastSeenAt: latest.lastSeenAt,
      playtimeMinutes: rows.reduce((a, r) => a + r.playtimeMinutes, 0),
      name: latest.name,
      licenses: rows.map((r) => r.license).filter((l): l is string => !!l),
    };
  }

  /** Liaison Discord des joueurs listés (bouton « Joueurs » du panneau `/config module:fivem`). */
  async discordIdsFor(guildId: string, players: ServerPlayer[]): Promise<Map<number, string | null>> {
    const licenses = players.map((p) => trackingLicense(parseIdentifiers(p.identifiers))).filter((l): l is string => !!l);
    const rows = licenses.length ? await prisma.fiveMPlayer.findMany({ where: { guildId, license: { in: licenses } }, select: { license: true, discordId: true } }) : [];
    const byLicense = new Map(rows.map((r) => [r.license, r.discordId]));
    const out = new Map<number, string | null>();
    for (const p of players) {
      const lic = trackingLicense(parseIdentifiers(p.identifiers));
      out.set(p.id, resolveDiscordId({ identifiers: p.identifiers, knownByLicense: lic ? (byLicense.get(lic) ?? null) : null }));
    }
    return out;
  }
}

export const fivemSyncService = new FiveMSyncService();
