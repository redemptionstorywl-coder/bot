import { randomInt } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type GuildMember,
  type Message,
} from 'discord.js';
import { LogCategory, Prisma, type Giveaway, type GiveawayEntry } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { childLogger } from '../utils/logger';
import { translationService, type Translator } from './TranslationService';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { activityService } from './ActivityService';

const log = childLogger('GiveawayService');

/** Délai minimal entre deux éditions de l'embed d'un même giveaway. */
export const GIVEAWAY_REFRESH_THROTTLE_MS = 5_000;

export interface GiveawayCreateData {
  prize: string;
  description?: string | null;
  winnersCount: number;
  endsAt: Date;
  channelId: string;
  requiredRoleId?: string | null;
  minMessages?: number;
  language?: string | null;
}

export type GiveawayWithEntries = Giveaway & { entries: GiveawayEntry[] };

export type EntryResult =
  | { ok: true; entered: boolean; count: number }
  | { ok: false; reason: 'ended' | 'not_found' | 'missing_role' | 'min_messages'; roleId?: string; required?: number; current?: number };

export type EndResult = { ok: true; winners: string[]; giveaway: GiveawayWithEntries } | { ok: false; reason: 'not_found' | 'already_ended' | 'not_ended' };

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Fonction pure : tire `count` gagnants distincts parmi `entries`, en excluant `exclude`.
 * Utilise crypto.randomInt (tirage non biaisé). Retourne moins de `count` gagnants si
 * le nombre de candidats est insuffisant.
 */
export function pickWinners(entries: readonly string[], count: number, exclude: readonly string[] = []): string[] {
  const excluded = new Set(exclude);
  const pool = [...new Set(entries)].filter((id) => !excluded.has(id));
  const winners: string[] = [];
  const n = Math.max(0, Math.floor(count));
  while (winners.length < n && pool.length > 0) {
    const index = randomInt(pool.length);
    winners.push(pool[index]!);
    pool.splice(index, 1);
  }
  return winners;
}

/**
 * Service Giveaways : création, participation (conditions rôle / messages), tirage sécurisé,
 * reroll, annulation, mise à jour throttlée de l'embed.
 */
export class GiveawayService {
  private client: Client | null = null;
  private readonly refreshState = new Map<number, { lastEdit: number; timer: NodeJS.Timeout | null }>();

  attach(client: Client): void {
    this.client = client;
  }

  // ───── API (commandes + dashboard) ─────

  async list(guildId: string, opts: { ended?: boolean } = {}): Promise<GiveawayWithEntries[]> {
    return prisma.giveaway.findMany({
      where: { guildId, ...(opts.ended !== undefined ? { ended: opts.ended } : {}) },
      include: { entries: true },
      orderBy: [{ ended: 'asc' }, { endsAt: 'asc' }],
    });
  }

  async get(id: number): Promise<GiveawayWithEntries | null> {
    return prisma.giveaway.findUnique({ where: { id }, include: { entries: true } });
  }

  async create(guildId: string, data: GiveawayCreateData, hostId: string): Promise<GiveawayWithEntries> {
    const giveaway = await prisma.giveaway.create({
      data: {
        guildId,
        channelId: data.channelId,
        prize: data.prize.slice(0, 190),
        description: data.description ?? null,
        winnersCount: Math.max(1, Math.min(50, Math.floor(data.winnersCount))),
        endsAt: data.endsAt,
        requiredRoleId: data.requiredRoleId ?? null,
        minMessages: Math.max(0, data.minMessages ?? 0),
        language: data.language ?? null,
        hostId,
      },
      include: { entries: true },
    });
    const published = await this.publish(giveaway);
    void loggingService.log({
      guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'giveaway.create',
      title: `🎁 ${giveaway.prize}`,
      description: discordTimestamp(giveaway.endsAt, 'F'),
      actorId: hostId,
      data: { giveawayId: giveaway.id, prize: giveaway.prize, winnersCount: giveaway.winnersCount },
    });
    return published;
  }

  /** Vérifie les conditions puis ajoute / retire la participation (toggle). */
  async toggleEntry(id: number, member: GuildMember): Promise<EntryResult> {
    const giveaway = await this.get(id);
    if (!giveaway) return { ok: false, reason: 'not_found' };
    if (giveaway.ended || giveaway.endsAt.getTime() <= Date.now()) return { ok: false, reason: 'ended' };
    const userId = member.id;
    const existing = giveaway.entries.find((e) => e.userId === userId);
    if (existing) {
      await prisma.giveawayEntry.deleteMany({ where: { giveawayId: id, userId } });
      const count = giveaway.entries.length - 1;
      this.scheduleRefresh(id);
      return { ok: true, entered: false, count };
    }
    if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) {
      return { ok: false, reason: 'missing_role', roleId: giveaway.requiredRoleId };
    }
    if (giveaway.minMessages > 0) {
      const current = await activityService.getCount(giveaway.guildId, userId);
      if (current < giveaway.minMessages) return { ok: false, reason: 'min_messages', required: giveaway.minMessages, current };
    }
    try {
      await prisma.giveawayEntry.create({ data: { giveawayId: id, userId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    this.scheduleRefresh(id);
    return { ok: true, entered: true, count: giveaway.entries.length + 1 };
  }

  /** Termine le giveaway (tirage). `force` = terminer avant endsAt. */
  async end(id: number, opts: { force?: boolean; actorId?: string } = {}): Promise<EndResult> {
    const giveaway = await this.get(id);
    if (!giveaway) return { ok: false, reason: 'not_found' };
    if (giveaway.ended) return { ok: false, reason: 'already_ended' };
    if (!opts.force && giveaway.endsAt.getTime() > Date.now()) return { ok: false, reason: 'not_ended' };
    const winners = pickWinners(
      giveaway.entries.map((e) => e.userId),
      giveaway.winnersCount,
    );
    const updated = await prisma.giveaway.update({
      where: { id },
      data: { ended: true, winners: winners as Prisma.InputJsonValue, ...(opts.force ? { endsAt: new Date() } : {}) },
      include: { entries: true },
    });
    this.clearRefresh(id);
    await this.refreshMessage(updated);
    await this.announceWinners(updated, winners, false);
    void loggingService.log({
      guildId: updated.guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'giveaway.end',
      title: `🎁 ${updated.prize}`,
      description: winners.length ? winners.map((w) => `<@${w}>`).join(', ') : '—',
      actorId: opts.actorId ?? null,
      data: { giveawayId: id, winners, entries: updated.entries.length, forced: !!opts.force },
    });
    return { ok: true, winners, giveaway: updated };
  }

  /** Retire `count` nouveaux gagnants (exclut les anciens). */
  async reroll(id: number, count = 1, actorId?: string): Promise<EndResult> {
    const giveaway = await this.get(id);
    if (!giveaway) return { ok: false, reason: 'not_found' };
    if (!giveaway.ended) return { ok: false, reason: 'not_ended' };
    const previous = asStringArray(giveaway.winners);
    const winners = pickWinners(
      giveaway.entries.map((e) => e.userId),
      Math.max(1, count),
      previous,
    );
    const updated = await prisma.giveaway.update({
      where: { id },
      data: { winners: [...previous, ...winners] as Prisma.InputJsonValue },
      include: { entries: true },
    });
    await this.refreshMessage(updated);
    await this.announceWinners(updated, winners, true);
    void loggingService.log({
      guildId: updated.guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'giveaway.reroll',
      title: `🎁 ${updated.prize}`,
      description: winners.length ? winners.map((w) => `<@${w}>`).join(', ') : '—',
      actorId: actorId ?? null,
      data: { giveawayId: id, winners, previous },
    });
    return { ok: true, winners, giveaway: updated };
  }

  /** Annule : marqué terminé sans gagnant, participations supprimées, embed grisé. */
  async cancel(id: number, actorId?: string): Promise<GiveawayWithEntries | null> {
    const giveaway = await this.get(id);
    if (!giveaway || giveaway.ended) return giveaway;
    await prisma.giveawayEntry.deleteMany({ where: { giveawayId: id } });
    const updated = await prisma.giveaway.update({ where: { id }, data: { ended: true, winners: [] as Prisma.InputJsonValue, endsAt: new Date() }, include: { entries: true } });
    this.clearRefresh(id);
    await this.refreshMessage(updated, { cancelled: true });
    void loggingService.log({
      guildId: updated.guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'giveaway.cancel',
      title: `🎁 ${updated.prize}`,
      actorId: actorId ?? null,
      color: BRAND.colors.warning,
      data: { giveawayId: id },
    });
    return updated;
  }

  // ───── Rendu ─────

  async languageFor(giveaway: Pick<Giveaway, 'guildId' | 'language'>): Promise<string> {
    if (giveaway.language) return giveaway.language;
    const cfg = await guildConfigService.get(giveaway.guildId);
    return cfg?.defaultLanguage ?? 'fr';
  }

  async translatorFor(giveaway: Pick<Giveaway, 'guildId' | 'language'>): Promise<Translator> {
    return translationService.bind(await this.languageFor(giveaway), giveaway.guildId);
  }

  buildEmbed(giveaway: GiveawayWithEntries, t: Translator, color: number = BRAND.colors.primary, opts: { cancelled?: boolean } = {}): EmbedBuilder {
    const winners = asStringArray(giveaway.winners);
    const conditions: string[] = [];
    if (giveaway.requiredRoleId) conditions.push(t('giveaways.embed.condition_role', { role: `<@&${giveaway.requiredRoleId}>` }));
    if (giveaway.minMessages > 0) conditions.push(t('giveaways.embed.condition_messages', { count: giveaway.minMessages }));

    const embed = new EmbedBuilder()
      .setColor((giveaway.ended ? BRAND.colors.neutral : color) as ColorResolvable)
      .setTitle(`🎁 ${giveaway.prize}`)
      .setFooter({ text: t('giveaways.embed.footer', { id: giveaway.id }) })
      .setTimestamp(giveaway.endsAt);
    if (giveaway.description) embed.setDescription(giveaway.description.slice(0, 4096));

    if (opts.cancelled) {
      embed.addFields({ name: t('giveaways.embed.status'), value: t('giveaways.embed.cancelled'), inline: false });
    } else if (giveaway.ended) {
      embed.addFields(
        { name: t('giveaways.embed.ended_at'), value: discordTimestamp(giveaway.endsAt, 'R'), inline: true },
        { name: t('giveaways.embed.winners', { count: giveaway.winnersCount }), value: winners.length ? winners.map((w) => `<@${w}>`).join('\n').slice(0, 1024) : t('giveaways.embed.no_winner'), inline: true },
      );
    } else {
      embed.addFields(
        { name: t('giveaways.embed.ends'), value: `${discordTimestamp(giveaway.endsAt, 'R')}\n${discordTimestamp(giveaway.endsAt, 'f')}`, inline: true },
        { name: t('giveaways.embed.winners_count'), value: String(giveaway.winnersCount), inline: true },
      );
    }
    embed.addFields(
      { name: t('giveaways.embed.host'), value: `<@${giveaway.hostId}>`, inline: true },
      { name: t('giveaways.embed.entries'), value: String(giveaway.entries.length), inline: true },
    );
    if (conditions.length) embed.addFields({ name: t('giveaways.embed.conditions'), value: conditions.join('\n'), inline: false });
    return embed;
  }

  buildComponents(giveaway: Giveaway, t: Translator): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId('giveaway', 'enter', giveaway.id))
          .setLabel(t('giveaways.buttons.enter'))
          .setEmoji('🎁')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(giveaway.ended),
      ),
    ];
  }

  private async channelOf(giveaway: Pick<Giveaway, 'channelId'>) {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return null;
    return channel;
  }

  async publish(giveaway: GiveawayWithEntries): Promise<GiveawayWithEntries> {
    const channel = await this.channelOf(giveaway);
    if (!channel) throw new Error(`Salon ${giveaway.channelId} introuvable pour le giveaway ${giveaway.id}`);
    const cfg = await guildConfigService.get(giveaway.guildId);
    const t = await this.translatorFor(giveaway);
    const message: Message = await channel.send({ embeds: [this.buildEmbed(giveaway, t, cfg?.brandColor)], components: this.buildComponents(giveaway, t) });
    return prisma.giveaway.update({ where: { id: giveaway.id }, data: { messageId: message.id }, include: { entries: true } });
  }

  async refreshMessage(giveaway: GiveawayWithEntries, opts: { cancelled?: boolean } = {}): Promise<void> {
    if (!giveaway.messageId) return;
    const channel = await this.channelOf(giveaway);
    if (!channel) return;
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!message) return;
    const cfg = await guildConfigService.get(giveaway.guildId);
    const t = await this.translatorFor(giveaway);
    await message
      .edit({ embeds: [this.buildEmbed(giveaway, t, cfg?.brandColor, opts)], components: this.buildComponents(giveaway, t) })
      .catch((err) => log.warn({ err, giveawayId: giveaway.id }, 'Impossible de mettre à jour le message du giveaway'));
    const state = this.refreshState.get(giveaway.id);
    if (state) state.lastEdit = Date.now();
  }

  /**
   * Mise à jour du compteur de participants avec throttle : au plus une édition
   * toutes les GIVEAWAY_REFRESH_THROTTLE_MS par giveaway (la dernière demande est toujours honorée).
   */
  scheduleRefresh(id: number): void {
    const state = this.refreshState.get(id) ?? { lastEdit: 0, timer: null };
    this.refreshState.set(id, state);
    if (state.timer) return; // une édition est déjà programmée
    const wait = Math.max(0, state.lastEdit + GIVEAWAY_REFRESH_THROTTLE_MS - Date.now());
    const run = async () => {
      state.timer = null;
      state.lastEdit = Date.now();
      const fresh = await this.get(id).catch(() => null);
      if (fresh) await this.refreshMessage(fresh);
    };
    if (wait === 0) {
      state.lastEdit = Date.now();
      void run();
      return;
    }
    state.timer = setTimeout(() => void run(), wait);
    state.timer.unref?.();
  }

  private clearRefresh(id: number): void {
    const state = this.refreshState.get(id);
    if (state?.timer) clearTimeout(state.timer);
    this.refreshState.delete(id);
  }

  private async announceWinners(giveaway: GiveawayWithEntries, winners: string[], reroll: boolean): Promise<void> {
    const t = await this.translatorFor(giveaway);
    const channel = await this.channelOf(giveaway);
    const link = giveaway.messageId ? `https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${giveaway.messageId}` : null;
    if (channel) {
      const content = winners.length
        ? t(reroll ? 'giveaways.announce.reroll' : 'giveaways.announce.winners', { winners: winners.map((w) => `<@${w}>`).join(', '), prize: giveaway.prize })
        : t('giveaways.announce.no_winner', { prize: giveaway.prize });
      await channel
        .send({ content: link ? `${content}\n${link}` : content, allowedMentions: { users: winners } })
        .catch((err) => log.warn({ err, giveawayId: giveaway.id }, 'Annonce des gagnants impossible'));
    }
    if (!this.client) return;
    for (const userId of winners) {
      const user = await this.client.users.fetch(userId).catch(() => null);
      if (!user) continue;
      await user.send(t('giveaways.dm.won', { prize: giveaway.prize, link: link ?? '' })).catch(() => null);
    }
  }

  /** Tâche scheduler `giveaways:end` : termine les giveaways arrivés à échéance. */
  async tick(now: Date = new Date()): Promise<void> {
    const due = await prisma.giveaway.findMany({ where: { ended: false, endsAt: { lte: now } }, select: { id: true } });
    for (const { id } of due) {
      try {
        await this.end(id);
      } catch (err) {
        log.error({ err, giveawayId: id }, 'Fin de giveaway en erreur');
      }
    }
  }
}

export const giveawayService = new GiveawayService();
