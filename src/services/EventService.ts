import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type Message,
} from 'discord.js';
import { EventStatus, LogCategory, Prisma, type Event, type EventParticipant } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { translationService, type Translator } from './TranslationService';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';

const log = childLogger('EventService');

export const DEFAULT_REMINDER_OFFSETS = [1440, 60, 30, 10, 5];
/** Durée par défaut d'un événement sans date de fin (2 h). */
export const DEFAULT_EVENT_DURATION_MS = 2 * 3600_000;
const MAX_NAMES_IN_EMBED = 10;

export interface EventCreateData {
  name: string;
  description: string;
  startsAt: Date;
  endsAt?: Date | null;
  location?: string | null;
  imageUrl?: string | null;
  mentionRoleId?: string | null;
  maxParticipants?: number | null;
  channelId: string;
  language?: string | null;
  reminderOffsets?: number[];
}

export type EventUpdateData = Partial<Omit<EventCreateData, 'channelId'>>;

export type EventWithParticipants = Event & { participants: EventParticipant[] };

export type JoinResult = { ok: true; count: number } | { ok: false; reason: 'already' | 'full' | 'closed' | 'not_found' };
export type LeaveResult = { ok: true; count: number } | { ok: false; reason: 'not_joined' | 'closed' | 'not_found' };

/** Options passées en ligne de commande, conservées le temps que l'utilisateur remplisse la modal. */
export interface PendingEventOptions {
  guildId: string;
  channelId: string;
  imageUrl?: string | null;
  mentionRoleId?: string | null;
  language?: string | null;
}

function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [];
}

/**
 * Fonction pure : rappels dus pour un événement à l'instant `now`.
 * Un rappel `offset` (minutes) est dû si : il est configuré, pas encore envoyé,
 * `startsAt - offset <= now < startsAt`. Résultat trié du plus grand au plus petit.
 */
export function dueReminders(event: Pick<Event, 'startsAt' | 'reminderOffsets' | 'remindersSent' | 'status'>, now: Date | number = Date.now()): number[] {
  if (event.status !== EventStatus.SCHEDULED) return [];
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const start = event.startsAt.getTime();
  if (nowMs >= start) return [];
  const offsets = asNumberArray(event.reminderOffsets).length ? asNumberArray(event.reminderOffsets) : DEFAULT_REMINDER_OFFSETS;
  const sent = new Set(asNumberArray(event.remindersSent));
  return [...new Set(offsets)]
    .filter((offset) => offset > 0 && !sent.has(offset) && start - offset * 60_000 <= nowMs)
    .sort((a, b) => b - a);
}

/** Fonction pure : date de fin effective d'un événement (endsAt ou startsAt + 2 h). */
export function effectiveEndsAt(event: Pick<Event, 'startsAt' | 'endsAt'>): Date {
  return event.endsAt ?? new Date(event.startsAt.getTime() + DEFAULT_EVENT_DURATION_MS);
}

/**
 * Service Événements : création / édition / participation / rappels / cycle de vie.
 * Toutes les méthodes publiques sont utilisables par les commandes ET le dashboard.
 */
export class EventService {
  private client: Client | null = null;
  private readonly pendingOptions = new TTLCache<PendingEventOptions>(10 * 60_000, 1000);

  attach(client: Client): void {
    this.client = client;
  }

  // ───── Options en attente (commande → modal) ─────

  stashOptions(userId: string, opts: PendingEventOptions): void {
    this.pendingOptions.set(userId, opts);
  }

  takeOptions(userId: string): PendingEventOptions | undefined {
    const v = this.pendingOptions.get(userId);
    this.pendingOptions.delete(userId);
    return v;
  }

  // ───── API (commandes + dashboard) ─────

  async list(guildId: string, status?: EventStatus | EventStatus[]): Promise<EventWithParticipants[]> {
    return prisma.event.findMany({
      where: { guildId, ...(status ? { status: Array.isArray(status) ? { in: status } : status } : {}) },
      include: { participants: { orderBy: { joinedAt: 'asc' } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async get(id: number): Promise<EventWithParticipants | null> {
    return prisma.event.findUnique({ where: { id }, include: { participants: { orderBy: { joinedAt: 'asc' } } } });
  }

  async create(guildId: string, data: EventCreateData, createdById: string): Promise<EventWithParticipants> {
    const event = await prisma.event.create({
      data: {
        guildId,
        name: data.name.slice(0, 190),
        description: data.description,
        startsAt: data.startsAt,
        endsAt: data.endsAt ?? null,
        location: data.location ?? null,
        imageUrl: data.imageUrl ?? null,
        mentionRoleId: data.mentionRoleId ?? null,
        maxParticipants: data.maxParticipants ?? null,
        channelId: data.channelId,
        language: data.language ?? null,
        reminderOffsets: (data.reminderOffsets ?? DEFAULT_REMINDER_OFFSETS) as Prisma.InputJsonValue,
        createdById,
      },
      include: { participants: true },
    });
    const published = await this.publish(event);
    void loggingService.log({
      guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'event.create',
      title: `📅 ${event.name}`,
      description: discordTimestamp(event.startsAt, 'F'),
      actorId: createdById,
      data: { eventId: event.id, name: event.name, startsAt: event.startsAt.toISOString() },
    });
    return published;
  }

  async update(id: number, data: EventUpdateData, actorId?: string): Promise<EventWithParticipants | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const update: Prisma.EventUpdateInput = {};
    if (data.name !== undefined) update.name = data.name.slice(0, 190);
    if (data.description !== undefined) update.description = data.description;
    if (data.startsAt !== undefined) {
      update.startsAt = data.startsAt;
      // Nouvelle date → on réarme les rappels dont l'heure n'est pas encore passée.
      const sent = asNumberArray(existing.remindersSent).filter((o) => data.startsAt!.getTime() - o * 60_000 <= Date.now());
      update.remindersSent = sent as Prisma.InputJsonValue;
      if (existing.status === EventStatus.ONGOING && data.startsAt.getTime() > Date.now()) update.status = EventStatus.SCHEDULED;
    }
    if (data.endsAt !== undefined) update.endsAt = data.endsAt;
    if (data.location !== undefined) update.location = data.location;
    if (data.imageUrl !== undefined) update.imageUrl = data.imageUrl;
    if (data.mentionRoleId !== undefined) update.mentionRoleId = data.mentionRoleId;
    if (data.maxParticipants !== undefined) update.maxParticipants = data.maxParticipants;
    if (data.language !== undefined) update.language = data.language;
    if (data.reminderOffsets !== undefined) update.reminderOffsets = data.reminderOffsets as Prisma.InputJsonValue;
    const event = await prisma.event.update({ where: { id }, data: update, include: { participants: { orderBy: { joinedAt: 'asc' } } } });
    await this.refreshMessage(event);
    void loggingService.log({
      guildId: event.guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'event.update',
      title: `📅 ${event.name}`,
      actorId: actorId ?? null,
      data: { eventId: event.id, changes: Object.keys(update) },
    });
    return event;
  }

  async cancel(id: number, actorId?: string): Promise<EventWithParticipants | null> {
    const existing = await this.get(id);
    if (!existing || existing.status === EventStatus.CANCELLED) return existing;
    const event = await prisma.event.update({
      where: { id },
      data: { status: EventStatus.CANCELLED },
      include: { participants: { orderBy: { joinedAt: 'asc' } } },
    });
    await this.refreshMessage(event);
    const t = await this.translatorFor(event);
    await this.dmParticipants(event, t('events.dm.cancelled', { name: event.name }));
    void loggingService.log({
      guildId: event.guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'event.cancel',
      title: `📅 ${event.name}`,
      actorId: actorId ?? null,
      color: BRAND.colors.warning,
      data: { eventId: event.id },
    });
    return event;
  }

  async participants(id: number): Promise<EventParticipant[]> {
    return prisma.eventParticipant.findMany({ where: { eventId: id }, orderBy: { joinedAt: 'asc' } });
  }

  async join(id: number, userId: string): Promise<JoinResult> {
    const event = await this.get(id);
    if (!event) return { ok: false, reason: 'not_found' };
    if (event.status !== EventStatus.SCHEDULED && event.status !== EventStatus.ONGOING) return { ok: false, reason: 'closed' };
    if (event.participants.some((p) => p.userId === userId)) return { ok: false, reason: 'already' };
    if (event.maxParticipants && event.participants.length >= event.maxParticipants) return { ok: false, reason: 'full' };
    try {
      await prisma.eventParticipant.create({ data: { eventId: id, userId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { ok: false, reason: 'already' };
      throw err;
    }
    const count = event.participants.length + 1;
    await this.refreshMessage({ ...event, participants: [...event.participants, { id: 0, eventId: id, userId, joinedAt: new Date() }] });
    return { ok: true, count };
  }

  async leave(id: number, userId: string): Promise<LeaveResult> {
    const event = await this.get(id);
    if (!event) return { ok: false, reason: 'not_found' };
    if (event.status !== EventStatus.SCHEDULED && event.status !== EventStatus.ONGOING) return { ok: false, reason: 'closed' };
    if (!event.participants.some((p) => p.userId === userId)) return { ok: false, reason: 'not_joined' };
    await prisma.eventParticipant.deleteMany({ where: { eventId: id, userId } });
    const remaining = event.participants.filter((p) => p.userId !== userId);
    await this.refreshMessage({ ...event, participants: remaining });
    return { ok: true, count: remaining.length };
  }

  /** Rappel manuel (/event remind) : message dans le salon + DM. */
  async remind(id: number): Promise<boolean> {
    const event = await this.get(id);
    if (!event || event.status === EventStatus.CANCELLED || event.status === EventStatus.ENDED) return false;
    await this.sendReminder(event);
    return true;
  }

  // ───── Rendu ─────

  async languageFor(event: Pick<Event, 'guildId' | 'language'>): Promise<string> {
    if (event.language) return event.language;
    const cfg = await guildConfigService.get(event.guildId);
    return cfg?.defaultLanguage ?? 'fr';
  }

  async translatorFor(event: Pick<Event, 'guildId' | 'language'>): Promise<Translator> {
    return translationService.bind(await this.languageFor(event), event.guildId);
  }

  statusEmoji(status: EventStatus): string {
    switch (status) {
      case EventStatus.SCHEDULED:
        return '🗓️';
      case EventStatus.ONGOING:
        return '🟣';
      case EventStatus.ENDED:
        return '⚫';
      case EventStatus.CANCELLED:
        return '⛔';
    }
  }

  buildEmbed(event: EventWithParticipants, t: Translator, color: number = BRAND.colors.primary): EmbedBuilder {
    const count = event.participants.length;
    const max = event.maxParticipants;
    const names = event.participants
      .slice(0, MAX_NAMES_IN_EMBED)
      .map((p) => `<@${p.userId}>`)
      .join(', ');
    const more = count > MAX_NAMES_IN_EMBED ? ` ${t('events.embed.and_more', { count: count - MAX_NAMES_IN_EMBED })}` : '';
    const inactive = event.status === EventStatus.CANCELLED || event.status === EventStatus.ENDED;

    const embed = new EmbedBuilder()
      .setColor((inactive ? BRAND.colors.neutral : color) as ColorResolvable)
      .setTitle(`${this.statusEmoji(event.status)} ${event.name}`)
      .setDescription(event.description.slice(0, 4096))
      .addFields(
        { name: t('events.embed.date'), value: `${discordTimestamp(event.startsAt, 'F')}\n${discordTimestamp(event.startsAt, 'R')}`, inline: true },
        { name: t('events.embed.participants'), value: max ? `${count}/${max}` : String(count), inline: true },
      )
      .setFooter({ text: `${t('events.embed.footer', { id: event.id })} • ${t(`events.status.${event.status}`)}` })
      .setTimestamp(event.startsAt);
    if (event.endsAt) embed.addFields({ name: t('events.embed.ends'), value: discordTimestamp(event.endsAt, 'f'), inline: true });
    if (event.location) embed.addFields({ name: t('events.embed.location'), value: event.location.slice(0, 1024), inline: true });
    if (event.mentionRoleId) embed.addFields({ name: t('events.embed.role'), value: `<@&${event.mentionRoleId}>`, inline: true });
    if (count > 0) embed.addFields({ name: t('events.embed.registered'), value: `${names}${more}`.slice(0, 1024), inline: false });
    if (event.imageUrl) embed.setImage(event.imageUrl);
    return embed;
  }

  buildComponents(event: Event, t: Translator): ActionRowBuilder<ButtonBuilder>[] {
    const disabled = event.status === EventStatus.CANCELLED || event.status === EventStatus.ENDED;
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId('event', 'join', event.id)).setLabel(t('events.buttons.join')).setEmoji('✅').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(buildCustomId('event', 'leave', event.id)).setLabel(t('events.buttons.leave')).setEmoji('❌').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(buildCustomId('event', 'list', event.id)).setLabel(t('events.buttons.list')).setEmoji('👥').setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  private async channelOf(event: Pick<Event, 'channelId'>) {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(event.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return null;
    return channel;
  }

  /** Publie (ou republie) le message de l'événement dans son salon. */
  async publish(event: EventWithParticipants): Promise<EventWithParticipants> {
    const channel = await this.channelOf(event);
    if (!channel) throw new Error(`Salon ${event.channelId} introuvable pour l'événement ${event.id}`);
    const cfg = await guildConfigService.get(event.guildId);
    const t = await this.translatorFor(event);
    const message: Message = await channel.send({
      content: event.mentionRoleId ? `<@&${event.mentionRoleId}>` : undefined,
      embeds: [this.buildEmbed(event, t, cfg?.brandColor)],
      components: this.buildComponents(event, t),
      allowedMentions: { roles: event.mentionRoleId ? [event.mentionRoleId] : [] },
    });
    return prisma.event.update({ where: { id: event.id }, data: { messageId: message.id }, include: { participants: { orderBy: { joinedAt: 'asc' } } } });
  }

  /** Met à jour l'embed publié (compteur, statut, boutons). Silencieux si le message a disparu. */
  async refreshMessage(event: EventWithParticipants): Promise<void> {
    if (!event.messageId) return;
    const channel = await this.channelOf(event);
    if (!channel) return;
    const message = await channel.messages.fetch(event.messageId).catch(() => null);
    if (!message) return;
    const cfg = await guildConfigService.get(event.guildId);
    const t = await this.translatorFor(event);
    await message
      .edit({ embeds: [this.buildEmbed(event, t, cfg?.brandColor)], components: this.buildComponents(event, t) })
      .catch((err) => log.warn({ err, eventId: event.id }, 'Impossible de mettre à jour le message de l’événement'));
  }

  // ───── Rappels & cycle de vie (scheduler) ─────

  private async dmParticipants(event: EventWithParticipants, content: string): Promise<void> {
    if (!this.client) return;
    for (const p of event.participants) {
      const user = await this.client.users.fetch(p.userId).catch(() => null);
      if (!user) continue;
      await user.send(content).catch(() => null);
    }
  }

  /** Envoie un rappel dans le salon (mention du rôle) + DM à chaque participant (best effort). */
  async sendReminder(event: EventWithParticipants): Promise<void> {
    const t = await this.translatorFor(event);
    const text = t('events.reminder.message', { name: event.name, when: discordTimestamp(event.startsAt, 'R') });
    const channel = await this.channelOf(event);
    if (channel) {
      const link = event.messageId ? `https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}` : null;
      await channel
        .send({
          content: `${event.mentionRoleId ? `<@&${event.mentionRoleId}> ` : ''}${text}${link ? `\n${link}` : ''}`,
          allowedMentions: { roles: event.mentionRoleId ? [event.mentionRoleId] : [] },
        })
        .catch((err) => log.warn({ err, eventId: event.id }, 'Rappel impossible'));
    }
    await this.dmParticipants(event, t('events.dm.reminder', { name: event.name, when: discordTimestamp(event.startsAt, 'R'), server: event.guildId }));
  }

  /**
   * Tâche scheduler `events:reminders` :
   *  - envoie les rappels dus (un seul message par passage, marque tous les offsets dus),
   *  - SCHEDULED → ONGOING à startsAt,
   *  - ONGOING → ENDED à endsAt (ou startsAt + 2 h).
   */
  async tick(now: Date = new Date()): Promise<void> {
    const active = await prisma.event.findMany({
      where: { status: { in: [EventStatus.SCHEDULED, EventStatus.ONGOING] } },
      include: { participants: { orderBy: { joinedAt: 'asc' } } },
    });
    for (const event of active) {
      try {
        if (event.status === EventStatus.SCHEDULED) {
          const due = dueReminders(event, now);
          if (due.length) {
            const sent = [...new Set([...asNumberArray(event.remindersSent), ...due])];
            await prisma.event.update({ where: { id: event.id }, data: { remindersSent: sent as Prisma.InputJsonValue } });
            await this.sendReminder(event);
          }
          if (event.startsAt.getTime() <= now.getTime()) {
            const updated = await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.ONGOING }, include: { participants: { orderBy: { joinedAt: 'asc' } } } });
            await this.refreshMessage(updated);
            if (effectiveEndsAt(updated).getTime() <= now.getTime()) await this.end(updated);
          }
        } else if (effectiveEndsAt(event).getTime() <= now.getTime()) {
          await this.end(event);
        }
      } catch (err) {
        log.error({ err, eventId: event.id }, 'Cycle de vie événement en erreur');
      }
    }
  }

  private async end(event: EventWithParticipants): Promise<void> {
    const updated = await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.ENDED }, include: { participants: { orderBy: { joinedAt: 'asc' } } } });
    await this.refreshMessage(updated);
    void loggingService.log({
      guildId: updated.guildId,
      category: LogCategory.ANNOUNCEMENT,
      action: 'event.end',
      title: `📅 ${updated.name}`,
      data: { eventId: updated.id, participants: updated.participants.length },
      skipDatabase: true,
    });
  }
}

export const eventService = new EventService();
