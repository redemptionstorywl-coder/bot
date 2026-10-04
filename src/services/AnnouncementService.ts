import type { Client, Message, MessageCreateOptions } from 'discord.js';
import { AnnouncementStatus, ScheduleStatus, type Announcement, type Prisma, type ScheduledAnnouncement } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { buttonSpecSchema, colorToHex, embedService, embedSpecSchema, type ButtonSpec, type EmbedSpec, type MessageSpec } from './EmbedService';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { translationService } from './TranslationService';
import type { TemplateContext } from '../utils/variables';
import { discordTimestamp } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('AnnouncementService');

// ───────────────────────── Types & schémas ─────────────────────────

/** Référence du message publié (le champ `language` éventuel des anciennes données est ignoré). */
export const announcementMessageRefSchema = z.object({ channelId: z.string(), messageId: z.string() });
export type AnnouncementMessageRef = z.infer<typeof announcementMessageRefSchema>;

export interface AnnouncementInput {
  title?: string;
  content?: string | null;
  spec: EmbedSpec;
  channelId?: string | null;
  mentionRoleIds?: string[];
  mentionEveryone?: boolean;
  buttons?: ButtonSpec[];
}

/** Ligne Announcement avec ses colonnes JSON typées. */
export interface AnnouncementData {
  id: number;
  guildId: string;
  title: string;
  content: string | null;
  spec: EmbedSpec;
  channelId: string | null;
  mentionRoleIds: string[];
  mentionEveryone: boolean;
  buttons: ButtonSpec[];
  status: AnnouncementStatus;
  messages: AnnouncementMessageRef[];
  createdById: string;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AnnouncementErrorCode = 'not_found' | 'already_published' | 'no_channel' | 'send_failed' | 'invalid_status' | 'no_client' | 'invalid_spec' | 'past_date';

export class AnnouncementError extends Error {
  constructor(
    public readonly code: AnnouncementErrorCode,
    public readonly details?: string,
  ) {
    super(`${code}${details ? `: ${details}` : ''}`);
    this.name = 'AnnouncementError';
  }
}

export interface RenderOptions {
  includeMentions?: boolean;
}

// ───────────────────────── Fonctions pures ─────────────────────────

function safeArray<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S>[] {
  const r = z.array(schema).safeParse(value);
  return r.success ? (r.data as z.infer<S>[]) : [];
}

/** Applique la couleur par défaut du serveur si l'embed n'en définit pas. */
export function withDefaultColor(spec: EmbedSpec, brandColor: number | undefined): EmbedSpec {
  if (spec.color || brandColor === undefined) return spec;
  return { ...spec, color: colorToHex(brandColor) };
}

/** Construit le message Discord d'un MessageSpec en appliquant la couleur par défaut du serveur. */
export function buildMessageWithBrand(spec: MessageSpec, ctx: TemplateContext, brandColor: number | undefined) {
  return embedService.buildMessage({ ...spec, embeds: (spec.embeds ?? []).map((e) => withDefaultColor(e, brandColor)) }, ctx);
}

export function parseAnnouncement(row: Announcement): AnnouncementData {
  const spec = embedSpecSchema.safeParse(row.spec);
  return {
    id: row.id,
    guildId: row.guildId,
    title: row.title,
    content: row.content,
    spec: spec.success ? spec.data : {},
    channelId: row.channelId,
    mentionRoleIds: safeArray(z.string(), row.mentionRoleIds),
    mentionEveryone: row.mentionEveryone,
    buttons: safeArray(buttonSpecSchema, row.buttons),
    status: row.status,
    messages: safeArray(announcementMessageRefSchema, row.messages),
    createdById: row.createdById,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Ligne de mentions (@everyone + rôles) placée au-dessus de l'embed. */
export function mentionLine(ann: { mentionEveryone: boolean; mentionRoleIds: string[] }): string {
  return [ann.mentionEveryone ? '@everyone' : null, ...ann.mentionRoleIds.map((r) => `<@&${r}>`)].filter(Boolean).join(' ');
}

/**
 * Construit le MessageSpec (non rendu : variables `{server}`… intactes) d'une annonce :
 * mentions + contenu au-dessus de l'embed, puis les boutons.
 */
export function renderAnnouncement(ann: Pick<AnnouncementData, 'spec' | 'content' | 'buttons' | 'mentionEveryone' | 'mentionRoleIds'>, opts: RenderOptions = {}): MessageSpec {
  const parts: string[] = [];
  if (opts.includeMentions ?? true) {
    const m = mentionLine(ann);
    if (m) parts.push(m);
  }
  if (ann.content) parts.push(ann.content);
  const content = parts.join('\n').slice(0, 2000);
  return { content: content || undefined, embeds: [ann.spec], buttons: ann.buttons.length ? ann.buttons : undefined };
}

/** Une programmation est due si elle est PENDING et que sa date est passée. */
export function isScheduleDue(schedule: Pick<ScheduledAnnouncement, 'status' | 'scheduledAt'>, now: Date = new Date()): boolean {
  return schedule.status === ScheduleStatus.PENDING && schedule.scheduledAt.getTime() <= now.getTime();
}

// ───────────────────────── Service ─────────────────────────

export interface ListOptions {
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  items: AnnouncementData[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export class AnnouncementService {
  private client: Client | null = null;

  attach(client: Client): void {
    this.client = client;
  }

  private requireClient(): Client {
    if (!this.client) throw new AnnouncementError('no_client');
    return this.client;
  }

  private toJson(input: Partial<AnnouncementInput>): Prisma.AnnouncementUncheckedUpdateInput {
    const data: Prisma.AnnouncementUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title.trim().slice(0, 190);
    if (input.content !== undefined) data.content = input.content ? input.content.slice(0, 2000) : null;
    if (input.spec !== undefined) {
      const r = embedSpecSchema.safeParse(input.spec);
      if (!r.success) throw new AnnouncementError('invalid_spec', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      data.spec = r.data as Prisma.InputJsonValue;
    }
    if (input.channelId !== undefined) data.channelId = input.channelId;
    if (input.mentionRoleIds !== undefined) data.mentionRoleIds = input.mentionRoleIds as Prisma.InputJsonValue;
    if (input.mentionEveryone !== undefined) data.mentionEveryone = input.mentionEveryone;
    if (input.buttons !== undefined) {
      const r = z.array(buttonSpecSchema).max(25).safeParse(input.buttons);
      if (!r.success) throw new AnnouncementError('invalid_spec', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      data.buttons = r.data as Prisma.InputJsonValue;
    }
    return data;
  }

  private async t(guildId: string) {
    const cfg = await guildConfigService.get(guildId);
    return translationService.bind(cfg?.defaultLanguage ?? 'fr', guildId);
  }

  // ───── CRUD ─────

  async list(guildId: string, status?: AnnouncementStatus, opts: ListOptions = {}): Promise<ListResult> {
    const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 50);
    const where: Prisma.AnnouncementWhereInput = { guildId, ...(status ? { status } : {}) };
    const total = await prisma.announcement.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(opts.page ?? 1, 1), pages);
    const rows = await prisma.announcement.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize });
    return { items: rows.map(parseAnnouncement), total, page, pageSize, pages };
  }

  /** Recherche rapide (autocomplete) : titre contenant `query`. */
  async search(guildId: string, query: string, limit = 25): Promise<AnnouncementData[]> {
    const rows = await prisma.announcement.findMany({
      where: { guildId, ...(query ? { title: { contains: query } } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
    });
    return rows.map(parseAnnouncement);
  }

  async get(id: number): Promise<AnnouncementData | null> {
    const row = await prisma.announcement.findUnique({ where: { id } });
    return row ? parseAnnouncement(row) : null;
  }

  private async require(id: number): Promise<AnnouncementData> {
    const ann = await this.get(id);
    if (!ann) throw new AnnouncementError('not_found', String(id));
    return ann;
  }

  async create(guildId: string, data: AnnouncementInput, createdById: string): Promise<AnnouncementData> {
    const json = this.toJson(data);
    const row = await prisma.announcement.create({
      data: {
        guildId,
        createdById,
        title: (json.title as string | undefined) ?? data.spec.title?.slice(0, 190) ?? '',
        content: (json.content as string | null | undefined) ?? null,
        spec: (json.spec as Prisma.InputJsonValue | undefined) ?? ({} as Prisma.InputJsonValue),
        channelId: data.channelId ?? null,
        mentionRoleIds: data.mentionRoleIds ?? [],
        mentionEveryone: data.mentionEveryone ?? false,
        buttons: (json.buttons as Prisma.InputJsonValue | undefined) ?? [],
      },
    });
    return parseAnnouncement(row);
  }

  /**
   * Met à jour une annonce. Si elle est publiée et `sync` (défaut true), le message Discord
   * enregistré est ré-édité avec le nouveau contenu.
   */
  async update(id: number, data: Partial<AnnouncementInput>, opts: { actorId?: string; sync?: boolean } = {}): Promise<AnnouncementData> {
    const current = await this.require(id);
    const row = await prisma.announcement.update({ where: { id }, data: this.toJson(data) });
    let ann = parseAnnouncement(row);
    if ((opts.sync ?? true) && current.status === AnnouncementStatus.PUBLISHED && ann.messages.length) {
      ann = await this.syncMessages(ann, opts.actorId);
    }
    return ann;
  }

  /** Ré-édite tous les messages publiés d'une annonce avec son contenu actuel. */
  async syncMessages(ann: AnnouncementData, actorId?: string): Promise<AnnouncementData> {
    const client = this.requireClient();
    const config = await guildConfigService.get(ann.guildId);
    const guild = client.guilds.cache.get(ann.guildId) ?? null;
    const lang = config?.defaultLanguage ?? 'fr';
    let edited = 0;
    for (const ref of ann.messages) {
      const message = await this.fetchMessage(ref).catch(() => null);
      if (!message) continue;
      const built = buildMessageWithBrand(renderAnnouncement(ann), this.templateContext(guild, lang), config?.brandColor);
      await message
        .edit({ content: built.content || null, embeds: built.embeds, components: built.components, allowedMentions: this.allowedMentions(ann) })
        .then(() => {
          edited++;
        })
        .catch((err) => log.warn({ err, ref }, 'Édition d’un message d’annonce impossible'));
    }
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.update',
      title: t('announcements.log.updated_title'),
      description: t('announcements.log.updated_desc', { id: ann.id, title: ann.title, count: edited }),
      actorId,
      targetId: String(ann.id),
    });
    return ann;
  }

  async delete(id: number, actorId?: string): Promise<void> {
    const ann = await this.require(id);
    let deleted = 0;
    for (const ref of ann.messages) {
      const message = await this.fetchMessage(ref).catch(() => null);
      if (message) await message.delete().then(() => deleted++).catch((err) => log.warn({ err, ref }, 'Suppression message annonce impossible'));
    }
    await prisma.announcement.delete({ where: { id } });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.delete',
      title: t('announcements.log.deleted_title'),
      description: t('announcements.log.deleted_desc', { id: ann.id, title: ann.title, count: deleted }),
      actorId,
      targetId: String(ann.id),
    });
  }

  /** Copie une annonce en brouillon (sans messages ni programmation). */
  async duplicate(id: number, actorId: string): Promise<AnnouncementData> {
    const ann = await this.require(id);
    const t = await this.t(ann.guildId);
    const row = await prisma.announcement.create({
      data: {
        guildId: ann.guildId,
        createdById: actorId,
        title: `${ann.title} ${t('announcements.duplicate_suffix')}`.slice(0, 190),
        content: ann.content,
        spec: ann.spec as Prisma.InputJsonValue,
        channelId: ann.channelId,
        mentionRoleIds: ann.mentionRoleIds,
        mentionEveryone: ann.mentionEveryone,
        buttons: ann.buttons as Prisma.InputJsonValue,
        status: AnnouncementStatus.DRAFT,
        messages: [],
      },
    });
    return parseAnnouncement(row);
  }

  /** Archive : conserve les messages publiés, annule toute programmation en attente. */
  async archive(id: number, actorId?: string): Promise<AnnouncementData> {
    const ann = await this.require(id);
    await prisma.scheduledAnnouncement.updateMany({ where: { announcementId: id, status: ScheduleStatus.PENDING }, data: { status: ScheduleStatus.CANCELLED } });
    const row = await prisma.announcement.update({ where: { id }, data: { status: AnnouncementStatus.ARCHIVED, archivedAt: new Date() } });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.archive',
      title: t('announcements.log.archived_title'),
      description: t('announcements.log.archived_desc', { id: ann.id, title: ann.title }),
      actorId,
      targetId: String(ann.id),
    });
    return parseAnnouncement(row);
  }

  // ───── Programmation ─────

  getPendingSchedule(id: number): Promise<ScheduledAnnouncement | null> {
    return prisma.scheduledAnnouncement.findFirst({ where: { announcementId: id, status: ScheduleStatus.PENDING }, orderBy: { scheduledAt: 'asc' } });
  }

  async schedule(id: number, date: Date, actorId?: string): Promise<ScheduledAnnouncement> {
    const ann = await this.require(id);
    if (ann.status === AnnouncementStatus.PUBLISHED) throw new AnnouncementError('already_published', String(id));
    if (date.getTime() <= Date.now()) throw new AnnouncementError('past_date');
    if (!ann.channelId) throw new AnnouncementError('no_channel');
    await prisma.scheduledAnnouncement.updateMany({ where: { announcementId: id, status: ScheduleStatus.PENDING }, data: { status: ScheduleStatus.CANCELLED } });
    const schedule = await prisma.scheduledAnnouncement.create({ data: { announcementId: id, scheduledAt: date } });
    await prisma.announcement.update({ where: { id }, data: { status: AnnouncementStatus.SCHEDULED } });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.schedule',
      title: t('announcements.log.scheduled_title'),
      description: t('announcements.log.scheduled_desc', { id: ann.id, title: ann.title, date: discordTimestamp(date, 'F') }),
      actorId,
      targetId: String(ann.id),
    });
    return schedule;
  }

  /** Annule les programmations en attente ; l'annonce repasse en brouillon si elle n'est pas publiée. */
  async cancelSchedule(id: number): Promise<number> {
    const ann = await this.require(id);
    const r = await prisma.scheduledAnnouncement.updateMany({ where: { announcementId: id, status: ScheduleStatus.PENDING }, data: { status: ScheduleStatus.CANCELLED } });
    if (ann.status === AnnouncementStatus.SCHEDULED) await prisma.announcement.update({ where: { id }, data: { status: AnnouncementStatus.DRAFT } });
    return r.count;
  }

  /** Publie les programmations dues. Appelé par la tâche `announcements:scheduled`. */
  async processDue(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const due = await prisma.scheduledAnnouncement.findMany({ where: { status: ScheduleStatus.PENDING, scheduledAt: { lte: now } }, include: { announcement: true }, take: 20, orderBy: { scheduledAt: 'asc' } });
    let sent = 0;
    let failed = 0;
    for (const schedule of due) {
      if (!isScheduleDue(schedule, now)) continue;
      try {
        await this.publish(schedule.announcementId, { actorId: schedule.announcement.createdById, scheduled: true });
        await prisma.scheduledAnnouncement.update({ where: { id: schedule.id }, data: { status: ScheduleStatus.SENT, sentAt: new Date() } });
        sent++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, scheduleId: schedule.id, announcementId: schedule.announcementId }, 'Publication programmée en échec');
        await prisma.scheduledAnnouncement.update({ where: { id: schedule.id }, data: { status: ScheduleStatus.FAILED, error: message.slice(0, 2000) } }).catch(() => null);
        await prisma.announcement.updateMany({ where: { id: schedule.announcementId, status: AnnouncementStatus.SCHEDULED }, data: { status: AnnouncementStatus.DRAFT } }).catch(() => null);
        const t = await this.t(schedule.announcement.guildId);
        await loggingService.log({
          guildId: schedule.announcement.guildId,
          category: 'ANNOUNCEMENT',
          action: 'announcement.schedule_failed',
          title: t('announcements.log.failed_title'),
          description: t('announcements.log.failed_desc', { id: schedule.announcementId, title: schedule.announcement.title, error: message.slice(0, 500) }),
          color: 0xef4444,
          targetId: String(schedule.announcementId),
        });
      }
    }
    return { sent, failed };
  }

  // ───── Publication ─────

  private templateContext(guild: TemplateContext['guild'], language: string): TemplateContext {
    return { guild, language };
  }

  private allowedMentions(ann: Pick<AnnouncementData, 'mentionEveryone' | 'mentionRoleIds'>): MessageCreateOptions['allowedMentions'] {
    return { parse: ann.mentionEveryone ? ['everyone'] : [], roles: ann.mentionRoleIds.slice(0, 100) };
  }

  private async fetchMessage(ref: AnnouncementMessageRef): Promise<Message | null> {
    const client = this.requireClient();
    const channel = await client.channels.fetch(ref.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
    return channel.messages.fetch(ref.messageId).catch(() => null);
  }

  /**
   * Publie l'annonce dans son salon, enregistre la référence du message, passe le statut à PUBLISHED
   * et journalise (catégorie ANNOUNCEMENT).
   */
  async publish(id: number, opts: { actorId?: string; scheduled?: boolean } = {}): Promise<AnnouncementData> {
    const client = this.requireClient();
    const ann = await this.require(id);
    if (ann.status === AnnouncementStatus.PUBLISHED) throw new AnnouncementError('already_published', String(id));
    if (!ann.channelId) throw new AnnouncementError('no_channel');
    const config = await guildConfigService.get(ann.guildId);
    if (!config) throw new AnnouncementError('not_found', ann.guildId);
    const guild = client.guilds.cache.get(ann.guildId) ?? null;

    const channel = await client.channels.fetch(ann.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) throw new AnnouncementError('send_failed', `${ann.channelId}: invalid channel`);
    const built = buildMessageWithBrand(renderAnnouncement(ann), this.templateContext(guild, config.defaultLanguage), config.brandColor);
    let ref: AnnouncementMessageRef;
    try {
      const message = await channel.send({
        content: built.content || undefined,
        embeds: built.embeds,
        components: built.components.length ? built.components : undefined,
        allowedMentions: this.allowedMentions(ann),
      });
      ref = { channelId: ann.channelId, messageId: message.id };
    } catch (err) {
      log.warn({ err, announcementId: id, channelId: ann.channelId }, 'Envoi d’une annonce impossible');
      throw new AnnouncementError('send_failed', `${ann.channelId}: ${(err as Error).message}`);
    }

    const row = await prisma.announcement.update({
      where: { id },
      data: { status: AnnouncementStatus.PUBLISHED, publishedAt: new Date(), messages: [ref] as unknown as Prisma.InputJsonValue },
    });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: opts.scheduled ? 'announcement.publish_scheduled' : 'announcement.publish',
      title: t('announcements.log.published_title'),
      description: t('announcements.log.published_desc', { id: ann.id, title: ann.title }),
      fields: [{ name: t('announcements.log.messages'), value: `https://discord.com/channels/${ann.guildId}/${ref.channelId}/${ref.messageId}` }],
      actorId: opts.actorId,
      targetId: String(ann.id),
    });
    return parseAnnouncement(row);
  }

  /** MessageSpec rendu (variables remplacées) d'une annonce — pour /announce preview et le dashboard. */
  async preview(id: number): Promise<MessageSpec> {
    const ann = await this.require(id);
    const config = await guildConfigService.get(ann.guildId);
    const guild = this.client?.guilds.cache.get(ann.guildId) ?? null;
    const spec = renderAnnouncement(ann);
    const built = buildMessageWithBrand(spec, this.templateContext(guild, config?.defaultLanguage ?? 'fr'), config?.brandColor);
    return {
      content: built.content,
      embeds: built.embeds.map((e) => embedService.fromApiEmbed(e.toJSON())),
      buttons: spec.buttons,
    };
  }
}

export const announcementService = new AnnouncementService();
