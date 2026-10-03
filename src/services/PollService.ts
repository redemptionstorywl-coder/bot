import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Client,
  type ColorResolvable,
  type Message,
} from 'discord.js';
import { LogCategory, PollType, Prisma, type Poll, type PollVote } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { childLogger } from '../utils/logger';
import { translationService, type Translator } from './TranslationService';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';

const log = childLogger('PollService');

/** Délai minimal entre deux éditions de l'embed d'un même sondage. */
export const POLL_REFRESH_THROTTLE_MS = 3_000;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 10;
/** Au-delà de ce nombre d'options (ou en multi-sélection), on passe en select menu. */
export const POLL_BUTTONS_MAX = 5;
export const POLL_BAR_SIZE = 10;
const OPTION_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export interface PollOption {
  label: string;
  emoji?: string;
}

export interface PollCreateData {
  question: string;
  channelId: string;
  /** Ignoré pour le type YES_NO. */
  options?: PollOption[];
  type?: PollType;
  anonymous?: boolean;
  multiSelect?: boolean;
  endsAt?: Date | null;
}

export interface PollResults {
  counts: number[];
  /** Nombre de votants distincts */
  voters: number;
  /** Nombre total de voix (≥ voters en multi-sélection) */
  total: number;
  percentages: number[];
  bars: string[];
}

export type PollWithVotes = Poll & { votes: PollVote[] };

export type VoteResult = { ok: true; indexes: number[]; removed: boolean } | { ok: false; reason: 'ended' | 'not_found' | 'invalid_option' | 'single_choice' };

export function parsePollOptions(v: unknown): PollOption[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o): PollOption | null => {
      if (typeof o === 'string') return { label: o };
      if (o && typeof o === 'object' && typeof (o as PollOption).label === 'string') {
        const emoji = (o as PollOption).emoji;
        return { label: (o as PollOption).label, emoji: typeof emoji === 'string' && emoji ? emoji : undefined };
      }
      return null;
    })
    .filter((o): o is PollOption => o !== null);
}

/** Fonction pure : parse "A | B | C" en options (2–10). Retourne null si invalide. */
export function parseOptionsInput(input: string): PollOption[] | null {
  const labels = input
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 100));
  if (labels.length < POLL_MIN_OPTIONS || labels.length > POLL_MAX_OPTIONS) return null;
  return labels.map((label, i) => ({ label, emoji: OPTION_EMOJIS[i] }));
}

/** Fonction pure : barre de progression `█░` sur `size` cases. */
export function renderBar(count: number, total: number, size = POLL_BAR_SIZE): string {
  const ratio = total > 0 ? count / total : 0;
  const filled = Math.min(size, Math.round(ratio * size));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

/** Fonction pure : calcule compteurs, pourcentages et barres pour chaque option. */
export function computeResults(optionCount: number, votes: readonly Pick<PollVote, 'userId' | 'optionIndex'>[], size = POLL_BAR_SIZE): PollResults {
  const counts = new Array<number>(optionCount).fill(0);
  const voters = new Set<string>();
  for (const v of votes) {
    if (v.optionIndex < 0 || v.optionIndex >= optionCount) continue;
    counts[v.optionIndex]! += 1;
    voters.add(v.userId);
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const percentages = counts.map((c) => (total > 0 ? Math.round((c / total) * 100) : 0));
  const bars = counts.map((c) => renderBar(c, total, size));
  return { counts, voters: voters.size, total, percentages, bars };
}

/**
 * Service Sondages : création, votes (boutons / select), résultats, fin automatique.
 */
export class PollService {
  private client: Client | null = null;
  private readonly refreshState = new Map<number, { lastEdit: number; timer: NodeJS.Timeout | null }>();

  attach(client: Client): void {
    this.client = client;
  }

  // ───── API (commandes + dashboard) ─────

  async list(guildId: string, opts: { ended?: boolean } = {}): Promise<PollWithVotes[]> {
    return prisma.poll.findMany({
      where: { guildId, ...(opts.ended !== undefined ? { ended: opts.ended } : {}) },
      include: { votes: true },
      orderBy: [{ ended: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: number): Promise<PollWithVotes | null> {
    return prisma.poll.findUnique({ where: { id }, include: { votes: true } });
  }

  async create(guildId: string, data: PollCreateData, createdById: string): Promise<PollWithVotes> {
    const type = data.type ?? PollType.MULTIPLE;
    let options: PollOption[];
    if (type === PollType.YES_NO) {
      const t = await this.translatorFor({ guildId });
      options = [
        { label: t('polls.yes'), emoji: '✅' },
        { label: t('polls.no'), emoji: '❌' },
      ];
    } else {
      options = (data.options ?? []).slice(0, POLL_MAX_OPTIONS);
      if (options.length < POLL_MIN_OPTIONS) throw new Error('Un sondage requiert au moins 2 options');
    }
    const poll = await prisma.poll.create({
      data: {
        guildId,
        channelId: data.channelId,
        question: data.question.slice(0, 1000),
        options: options as unknown as Prisma.InputJsonValue,
        type,
        anonymous: data.anonymous ?? false,
        multiSelect: type === PollType.YES_NO ? false : (data.multiSelect ?? false),
        endsAt: data.endsAt ?? null,
        createdById,
      },
      include: { votes: true },
    });
    const published = await this.publish(poll);
    void loggingService.log({
      guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'poll.create',
      title: `📊 ${poll.question.slice(0, 200)}`,
      actorId: createdById,
      data: { pollId: poll.id, options: options.map((o) => o.label) },
    });
    return published;
  }

  /**
   * Enregistre le vote d'un utilisateur. Remplace l'ensemble de ses voix précédentes.
   * - sondage simple : un seul index ; revoter la même option retire le vote.
   * - multi-sélection : la liste complète remplace l'ancienne.
   */
  async vote(id: number, userId: string, indexes: number[]): Promise<VoteResult> {
    const poll = await this.get(id);
    if (!poll) return { ok: false, reason: 'not_found' };
    if (poll.ended || (poll.endsAt && poll.endsAt.getTime() <= Date.now())) return { ok: false, reason: 'ended' };
    const options = parsePollOptions(poll.options);
    const unique = [...new Set(indexes)];
    if (unique.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) return { ok: false, reason: 'invalid_option' };
    if (!poll.multiSelect && unique.length > 1) return { ok: false, reason: 'single_choice' };

    const previous = poll.votes.filter((v) => v.userId === userId).map((v) => v.optionIndex);
    let next = unique;
    let removed = false;
    if (!poll.multiSelect && unique.length === 1 && previous.length === 1 && previous[0] === unique[0]) {
      next = [];
      removed = true;
    }
    await prisma.$transaction([
      prisma.pollVote.deleteMany({ where: { pollId: id, userId } }),
      ...(next.length ? [prisma.pollVote.createMany({ data: next.map((optionIndex) => ({ pollId: id, userId, optionIndex })) })] : []),
    ]);
    this.scheduleRefresh(id);
    return { ok: true, indexes: next, removed };
  }

  async end(id: number, actorId?: string): Promise<PollWithVotes | null> {
    const poll = await this.get(id);
    if (!poll || poll.ended) return poll;
    const results = computeResults(parsePollOptions(poll.options).length, poll.votes);
    const updated = await prisma.poll.update({
      where: { id },
      data: {
        ended: true,
        endsAt: poll.endsAt && poll.endsAt.getTime() <= Date.now() ? poll.endsAt : new Date(),
        results: { counts: results.counts, voters: results.voters, total: results.total, endedAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
      include: { votes: true },
    });
    this.clearRefresh(id);
    await this.refreshMessage(updated);
    void loggingService.log({
      guildId: updated.guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'poll.end',
      title: `📊 ${updated.question.slice(0, 200)}`,
      actorId: actorId ?? null,
      data: { pollId: id, counts: results.counts, voters: results.voters },
    });
    return updated;
  }

  /** Résultats : compteurs par option + votants par option (uniquement si non anonyme). */
  async results(id: number): Promise<{ poll: PollWithVotes; options: PollOption[]; results: PollResults; voters: string[][] | null } | null> {
    const poll = await this.get(id);
    if (!poll) return null;
    const options = parsePollOptions(poll.options);
    const results = computeResults(options.length, poll.votes);
    const voters = poll.anonymous ? null : options.map((_, i) => poll.votes.filter((v) => v.optionIndex === i).map((v) => v.userId));
    return { poll, options, results, voters };
  }

  // ───── Rendu ─────

  /** Les sondages sont rendus dans la langue par défaut du serveur (pas de langue propre en base). */
  async languageFor(poll: { guildId: string }): Promise<string> {
    const cfg = await guildConfigService.get(poll.guildId);
    return cfg?.defaultLanguage ?? 'fr';
  }

  async translatorFor(poll: { guildId: string }): Promise<Translator> {
    return translationService.bind(await this.languageFor(poll), poll.guildId);
  }

  buildEmbed(poll: PollWithVotes, t: Translator, color: number = BRAND.colors.primary): EmbedBuilder {
    const options = parsePollOptions(poll.options);
    const results = computeResults(options.length, poll.votes);
    const lines = options.map((o, i) => {
      const label = `${o.emoji ?? OPTION_EMOJIS[i] ?? '•'} **${o.label}**`;
      return `${label}\n\`${results.bars[i]}\` ${results.percentages[i]}% · ${t('polls.embed.votes', { count: results.counts[i] })}`;
    });
    const flags: string[] = [];
    if (poll.anonymous) flags.push(t('polls.embed.anonymous'));
    if (poll.multiSelect) flags.push(t('polls.embed.multi_select'));

    const embed = new EmbedBuilder()
      .setColor((poll.ended ? BRAND.colors.neutral : color) as ColorResolvable)
      .setTitle(`📊 ${poll.question.slice(0, 250)}`)
      .setDescription(lines.join('\n\n').slice(0, 4096))
      .setFooter({ text: `${t('polls.embed.footer', { id: poll.id })} • ${t('polls.embed.voters', { count: results.voters })}${flags.length ? ` • ${flags.join(' • ')}` : ''}` });
    if (poll.ended) embed.addFields({ name: t('polls.embed.status'), value: t('polls.embed.ended'), inline: true });
    else if (poll.endsAt) embed.addFields({ name: t('polls.embed.ends'), value: discordTimestamp(poll.endsAt, 'R'), inline: true });
    return embed;
  }

  buildComponents(poll: Poll, t: Translator): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const options = parsePollOptions(poll.options);
    const useSelect = poll.multiSelect || options.length > POLL_BUTTONS_MAX;
    if (useSelect) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(buildCustomId('poll', 'vote', poll.id))
        .setPlaceholder(t(poll.multiSelect ? 'polls.select.placeholder_multi' : 'polls.select.placeholder'))
        .setMinValues(1)
        .setMaxValues(poll.multiSelect ? options.length : 1)
        .setDisabled(poll.ended)
        .addOptions(
          options.map((o, i) => {
            const opt = new StringSelectMenuOptionBuilder().setLabel(o.label.slice(0, 100)).setValue(String(i));
            if (o.emoji) opt.setEmoji(o.emoji);
            return opt;
          }),
        );
      return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      options.map((o, i) => {
        const btn = new ButtonBuilder().setCustomId(buildCustomId('poll', 'vote', poll.id, i)).setLabel(o.label.slice(0, 80)).setStyle(ButtonStyle.Secondary).setDisabled(poll.ended);
        if (o.emoji) btn.setEmoji(o.emoji);
        return btn;
      }),
    );
    return [row];
  }

  private async channelOf(poll: Pick<Poll, 'channelId'>) {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return null;
    return channel;
  }

  async publish(poll: PollWithVotes): Promise<PollWithVotes> {
    const channel = await this.channelOf(poll);
    if (!channel) throw new Error(`Salon ${poll.channelId} introuvable pour le sondage ${poll.id}`);
    const cfg = await guildConfigService.get(poll.guildId);
    const t = await this.translatorFor(poll);
    const message: Message = await channel.send({ embeds: [this.buildEmbed(poll, t, cfg?.brandColor)], components: this.buildComponents(poll, t) });
    return prisma.poll.update({ where: { id: poll.id }, data: { messageId: message.id }, include: { votes: true } });
  }

  async refreshMessage(poll: PollWithVotes): Promise<void> {
    if (!poll.messageId) return;
    const channel = await this.channelOf(poll);
    if (!channel) return;
    const message = await channel.messages.fetch(poll.messageId).catch(() => null);
    if (!message) return;
    const cfg = await guildConfigService.get(poll.guildId);
    const t = await this.translatorFor(poll);
    await message
      .edit({ embeds: [this.buildEmbed(poll, t, cfg?.brandColor)], components: this.buildComponents(poll, t) })
      .catch((err) => log.warn({ err, pollId: poll.id }, 'Impossible de mettre à jour le message du sondage'));
    const state = this.refreshState.get(poll.id);
    if (state) state.lastEdit = Date.now();
  }

  /** Mise à jour throttlée (≤ 1 édition / POLL_REFRESH_THROTTLE_MS par sondage). */
  scheduleRefresh(id: number): void {
    const state = this.refreshState.get(id) ?? { lastEdit: 0, timer: null };
    this.refreshState.set(id, state);
    if (state.timer) return;
    const wait = Math.max(0, state.lastEdit + POLL_REFRESH_THROTTLE_MS - Date.now());
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

  /** Tâche scheduler `polls:end` : clôture les sondages arrivés à échéance. */
  async tick(now: Date = new Date()): Promise<void> {
    const due = await prisma.poll.findMany({ where: { ended: false, endsAt: { not: null, lte: now } }, select: { id: true } });
    for (const { id } of due) {
      try {
        await this.end(id);
      } catch (err) {
        log.error({ err, pollId: id }, 'Fin de sondage en erreur');
      }
    }
  }
}

export const pollService = new PollService();
