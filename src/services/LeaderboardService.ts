import type { Client, Message } from 'discord.js';
import { LogCategory, type BattleRoyaleConfig } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { scheduler } from './SchedulerService';
import { loggingService } from './LoggingService';
import { guildConfigService } from './GuildConfigService';
import { translationService } from './TranslationService';
import { battleRoyaleService } from './BattleRoyaleService';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { DEFAULT_LEADERBOARD_SIZE, LEADERBOARD_SIZES, RefreshGate, buildBoards, renderLeaderboardEmbed, type LeaderboardView } from './battleroyale/leaderboard';

const log = childLogger('Leaderboard');

/** Rafraîchissement de sécurité (message supprimé, nouvelle saison, noms) : toutes les 10 minutes. */
export const LEADERBOARD_SAFETY_INTERVAL_MS = 10 * 60_000;

const snowflake = z.string().regex(/^\d{15,22}$/, 'ID Discord attendu');
export const displaySettingsSchema = z
  .object({
    leaderboardChannelId: snowflake.nullable(),
    leaderboardSize: z.coerce.number().int().refine((n) => (LEADERBOARD_SIZES as readonly number[]).includes(n), { message: `taille : ${LEADERBOARD_SIZES.join(' ou ')}` }),
    statChannelId: snowflake.nullable(),
  })
  .partial()
  .strict();
export type DisplaySettingsPatch = z.infer<typeof displaySettingsSchema>;

export interface DisplaySettings {
  leaderboardChannelId: string | null;
  leaderboardMessageId: string | null;
  leaderboardSize: number;
  statChannelId: string | null;
}

const DEFAULTS: DisplaySettings = { leaderboardChannelId: null, leaderboardMessageId: null, leaderboardSize: DEFAULT_LEADERBOARD_SIZE, statChannelId: null };

/**
 * Affichage Battle Royale : message de classement en direct (un message par serveur, édité quand les stats changent,
 * au plus une fois par minute, recréé s'il est supprimé) et salon dédié à /stat. Réglages : `BattleRoyaleConfig`.
 */
export class LeaderboardService {
  private client: Client | null = null;
  private tasksRegistered = false;
  private readonly gate = new RefreshGate();
  private readonly cache = new TTLCache<DisplaySettings>(5 * 60_000, 2000);
  /** messageId → guildId des messages de classement connus (suppression → republication) */
  private readonly messages = new Map<string, string>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor() {
    battleRoyaleService.onChange((guildId) => this.markDirty(guildId));
  }

  attach(client: Client): void {
    this.client = client;
  }

  registerTasks(): void {
    if (this.tasksRegistered || scheduler.registered.includes('br:leaderboard:debounce')) return;
    this.tasksRegistered = true;
    scheduler.register({ name: 'br:leaderboard:debounce', intervalMs: 15_000, run: () => this.flushDue() });
    scheduler.register({ name: 'br:leaderboard:refresh', intervalMs: LEADERBOARD_SAFETY_INTERVAL_MS, runOnStart: true, run: () => this.refreshAll() });
  }

  // ───── Réglages ─────

  async getSettings(guildId: string): Promise<DisplaySettings> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = await prisma.battleRoyaleConfig.findUnique({ where: { guildId } });
    const settings = row ? toSettings(row) : { ...DEFAULTS };
    this.cache.set(guildId, settings);
    if (settings.leaderboardMessageId) this.messages.set(settings.leaderboardMessageId, guildId);
    return settings;
  }

  /** Met à jour les réglages (validés par Zod) ; nouveau salon / nouvelle taille → message republié tout de suite. */
  async updateSettings(guildId: string, patch: unknown, actorId?: string | null): Promise<DisplaySettings> {
    const data = displaySettingsSchema.parse(patch);
    const before = await this.getSettings(guildId);
    const channelChanged = data.leaderboardChannelId !== undefined && data.leaderboardChannelId !== before.leaderboardChannelId;
    const update = { ...data, ...(channelChanged ? { leaderboardMessageId: null } : {}) };
    const row = await prisma.battleRoyaleConfig.upsert({ where: { guildId }, create: { guildId, ...update }, update });
    const settings = toSettings(row);
    this.cache.set(guildId, settings);
    if (channelChanged && before.leaderboardChannelId && before.leaderboardMessageId) {
      this.messages.delete(before.leaderboardMessageId);
      await this.deleteMessage(before.leaderboardChannelId, before.leaderboardMessageId);
    }
    await loggingService.log({ guildId, category: LogCategory.BATTLE_ROYALE, action: 'br.display.update', title: '⚔️ Affichage Battle Royale modifié', actorId: actorId ?? null, data: { ...data } });
    if (settings.leaderboardChannelId && (channelChanged || data.leaderboardSize !== undefined)) await this.refreshNow(guildId);
    return settings;
  }

  // ───── Rafraîchissement ─────

  /** Stats / profils / saison modifiés : rafraîchit tout de suite si la dernière édition date de plus d'une minute, sinon plus tard. */
  markDirty(guildId: string): void {
    if (!this.client) return;
    void this.getSettings(guildId)
      .then((s) => {
        if (!s.leaderboardChannelId) return;
        if (this.gate.request(guildId)) return this.run(guildId);
      })
      .catch((err) => log.warn({ err, guildId }, 'Classement non planifié'));
  }

  /** Republie / édite le message immédiatement (bouton « Republier », changement de salon). */
  async refreshNow(guildId: string): Promise<void> {
    if (this.gate.force(guildId)) await this.run(guildId);
  }

  private async flushDue(): Promise<void> {
    for (const guildId of this.gate.due()) await this.run(guildId);
  }

  private async refreshAll(): Promise<void> {
    if (!this.client) return;
    const rows = await prisma.battleRoyaleConfig.findMany({ where: { leaderboardChannelId: { not: null } } });
    for (const row of rows) {
      if (!this.client.guilds.cache.has(row.guildId)) continue;
      this.cache.set(row.guildId, toSettings(row));
      await this.refreshNow(row.guildId);
    }
  }

  private async run(guildId: string): Promise<void> {
    try {
      await this.withLock(guildId, () => this.publish(guildId));
    } catch (err) {
      log.warn({ err, guildId }, 'Message de classement non mis à jour');
    } finally {
      this.gate.finish(guildId);
    }
  }

  private async withLock(guildId: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.locks.get(guildId) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(guildId, tail);
    void tail.then(() => {
      if (this.locks.get(guildId) === tail) this.locks.delete(guildId);
    });
    return run;
  }

  /** Données + embed du classement (aussi utilisé pour l'aperçu du panneau). */
  async buildView(guildId: string, size: number): Promise<LeaderboardView> {
    const guild = this.client?.guilds.cache.get(guildId) ?? null;
    const [season, pass] = await Promise.all([battleRoyaleService.getCurrentSeason(guildId), battleRoyaleService.getActiveBattlePass(guildId)]);
    const [wins, kills, kd] = await Promise.all([
      battleRoyaleService.leaderboard(guildId, 'wins', season, size),
      battleRoyaleService.leaderboard(guildId, 'kills', season, size),
      battleRoyaleService.leaderboard(guildId, 'kd', season, 500),
    ]);
    const rows = [...wins, ...kills, ...kd];
    const names = new Map<string, string>();
    for (const r of rows) {
      if (r.nickname) continue;
      const member = guild?.members.cache.get(r.userId);
      if (member) names.set(r.userId, member.displayName);
    }
    const players = await prisma.battleRoyaleStats.count({ where: { season, profile: { guildId }, matches: { gt: 0 } } });
    const cfg = await guildConfigService.get(guildId);
    return {
      guildName: guild?.name ?? '',
      season,
      seasonName: pass?.season === season ? pass.name : null,
      seasonEndsAt: pass?.season === season ? pass.endsAt : null,
      size,
      boards: buildBoards(rows, size, names),
      players,
      updatedAt: new Date(),
      color: cfg?.brandColor,
    };
  }

  private async publish(guildId: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    const settings = await this.getSettings(guildId);
    if (!settings.leaderboardChannelId) return;
    const channel = await client.channels.fetch(settings.leaderboardChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return;
    const cfg = await guildConfigService.get(guildId);
    const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', guildId);
    const embed = renderLeaderboardEmbed(await this.buildView(guildId, settings.leaderboardSize), t);
    let message: Message | null = null;
    if (settings.leaderboardMessageId) message = await channel.messages.fetch(settings.leaderboardMessageId).catch(() => null);
    if (message) {
      await message.edit({ content: '', embeds: [embed] });
      return;
    }
    const sent = await channel.send({ embeds: [embed] });
    if (settings.leaderboardMessageId) this.messages.delete(settings.leaderboardMessageId);
    this.messages.set(sent.id, guildId);
    const row = await prisma.battleRoyaleConfig.update({ where: { guildId }, data: { leaderboardMessageId: sent.id } });
    this.cache.set(guildId, toSettings(row));
  }

  private async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const channel = await this.client?.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    await msg?.delete().catch(() => null);
  }

  /** Un message supprimé était-il un message de classement ? → republié (au plus une fois par minute). */
  onMessageDeleted(messageId: string): void {
    const guildId = this.messages.get(messageId);
    if (!guildId) return;
    this.messages.delete(messageId);
    this.markDirty(guildId);
  }
}

function toSettings(row: BattleRoyaleConfig): DisplaySettings {
  return { leaderboardChannelId: row.leaderboardChannelId, leaderboardMessageId: row.leaderboardMessageId, leaderboardSize: row.leaderboardSize, statChannelId: row.statChannelId };
}

export const leaderboardService = new LeaderboardService();
