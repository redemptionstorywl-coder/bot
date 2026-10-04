import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
  type GuildMember,
  type Message,
  type NewsChannel,
  type OverwriteResolvable,
  type TextChannel,
  type User,
} from 'discord.js';
import { LogCategory, PanelStyle, Prisma, TicketStatus, type Ticket, type TicketPanel, type TicketTranscript, type TicketType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import type { RedemptionClient } from '../core/Client';
import { BRAND } from '../config/constants';
import { env } from '../config/env';
import { embedService, embedSpecSchema, parseColor, type EmbedSpec } from './EmbedService';
import { guildConfigService, type ResolvedGuildConfig } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { scheduler } from './SchedulerService';
import { translationService, type Translator } from './TranslationService';
import { transcriptService, type TranscriptData, type TranscriptFiles, type TranscriptMessage, type TranscriptParticipant } from './TranscriptService';
import { buildCustomId } from '../utils/customId';
import { hasInternalPermission } from '../utils/permissions';
import { renderTemplate, type TemplateContext } from '../utils/variables';
import { discordTimestamp, formatDuration } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('TicketService');

// ───────────────────────── Types & schémas ─────────────────────────

/** Erreur métier traduite côté handler via `t('tickets.errors.<code>', vars)`. */
export class TicketError extends Error {
  constructor(
    readonly code: string,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(`tickets.errors.${code}`);
    this.name = 'TicketError';
  }
}

export const ticketQuestionSchema = z.object({
  id: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(1).max(45),
  placeholder: z.string().max(100).optional(),
  style: z.enum(['short', 'paragraph']).default('short'),
  required: z.boolean().default(true),
  maxLength: z.number().int().min(1).max(4000).optional(),
});
export const ticketQuestionsSchema = z.array(ticketQuestionSchema).max(5);
export type TicketQuestion = z.infer<typeof ticketQuestionSchema>;

const snowflake = z.string().regex(/^\d{15,22}$/);

export const ticketTypeInputSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,32}$/),
  label: z.string().min(1).max(80),
  emoji: z.string().max(64).nullable().optional(),
  description: z.string().max(100).nullable().optional(),
  categoryId: snowflake.nullable().optional(),
  archiveCategoryId: snowflake.nullable().optional(),
  staffRoleIds: z.array(snowflake).max(25).optional(),
  questions: ticketQuestionsSchema.optional(),
  embed: embedSpecSchema.nullable().optional(),
  welcomeMessage: z.string().max(2000).nullable().optional(),
  language: z.string().max(8).nullable().optional(),
  nameFormat: z.string().min(1).max(60).optional(),
  maxPerUser: z.number().int().min(1).max(25).optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().optional(),
});
export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;
export type TicketTypePatch = Partial<Omit<TicketTypeInput, 'key'>>;

type TypeColumns = Partial<
  Pick<Prisma.TicketTypeUncheckedCreateInput, 'emoji' | 'description' | 'categoryId' | 'archiveCategoryId' | 'staffRoleIds' | 'questions' | 'embed' | 'welcomeMessage' | 'language' | 'nameFormat' | 'maxPerUser' | 'enabled' | 'order'>
>;

export interface FormAnswer {
  question: string;
  answer: string;
}

export type TicketWithType = Ticket & { type: TicketType | null };
export type TicketFull = Ticket & { type: TicketType | null; transcript: TicketTranscript | null };

export interface TicketListFilters {
  status?: TicketStatus | TicketStatus[] | 'open' | 'closed';
  userId?: string;
  typeId?: number;
  claimedById?: string;
  search?: string;
}

export interface TicketListResult {
  items: TicketWithType[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
}

export interface TicketStats {
  open: number;
  claimed: number;
  closed: number;
  deleted: number;
  total: number;
  /** Temps moyen de résolution (secondes) calculé sur les transcripts */
  avgDurationSeconds: number;
  avgMessages: number;
  byType: { typeId: number | null; label: string; count: number }[];
}

export interface TicketActor {
  userId: string;
  staff: boolean;
}

export type TicketBusEvent = 'ticket:open' | 'ticket:close' | 'ticket:update';

/** Types par défaut (bouton « Raisons par défaut » de /config tickets, dashboard). */
export const DEFAULT_TICKET_TYPES: { key: string; emoji: string }[] = [
  { key: 'support', emoji: '🎫' },
  { key: 'bug', emoji: '🐛' },
  { key: 'shop', emoji: '🛒' },
  { key: 'payment', emoji: '💳' },
  { key: 'battle-royale', emoji: '🎮' },
  { key: 'prison', emoji: '🔒' },
  { key: 'school', emoji: '🎓' },
  { key: 'whitelist', emoji: '📝' },
  { key: 'staff', emoji: '👮' },
  { key: 'partnership', emoji: '🤝' },
  { key: 'report', emoji: '🚨' },
];

const OPEN_STATUSES: TicketStatus[] = [TicketStatus.OPEN, TicketStatus.CLAIMED];
const CLOSED_STATUSES: TicketStatus[] = [TicketStatus.CLOSED, TicketStatus.ARCHIVED];
const USER_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const STAFF_PERMS = [...USER_PERMS, PermissionFlagsBits.ManageMessages];
const BOT_PERMS = [...STAFF_PERMS, PermissionFlagsBits.ManageChannels];
const HISTORY_LIMIT = 2000;
export const DELETE_COUNTDOWN_SECONDS = 5;

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function asFormAnswers(v: unknown): FormAnswer[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({ question: String(a.question ?? ''), answer: String(a.answer ?? '') }))
    .filter((a) => a.question);
}

/** Lit les questions d'un type (JSON) en ignorant les entrées invalides. */
export function parseQuestions(v: unknown): TicketQuestion[] {
  if (!Array.isArray(v)) return [];
  const out: TicketQuestion[] = [];
  for (const raw of v) {
    const r = ticketQuestionSchema.safeParse(raw);
    if (r.success) out.push(r.data);
    if (out.length === 5) break;
  }
  return out;
}

export function parseEmbedSpec(v: unknown): EmbedSpec | null {
  if (!v || typeof v !== 'object') return null;
  const r = embedSpecSchema.safeParse(v);
  return r.success ? r.data : null;
}

/** Rend un EmbedSpec avec une couleur par défaut libre (contourne le littéral `as const` de BRAND). */
function buildEmbed(spec: EmbedSpec, ctx: TemplateContext, defaultColor: number): EmbedBuilder {
  return embedService.build(spec, ctx).setColor(parseColor(spec.color, defaultColor));
}

function sanitizeChannelName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return (cleaned || 'ticket').slice(0, 100);
}

/** Pure : le créateur ou le staff peut fermer un ticket ouvert. */
export function canCloseTicket(ticket: Pick<Ticket, 'userId' | 'status'>, actor: TicketActor): boolean {
  if (!OPEN_STATUSES.includes(ticket.status)) return false;
  return actor.staff || ticket.userId === actor.userId;
}

/** Pure : seul le staff gère le ticket (claim, add, remove, transfer, delete). */
export function canManageTicket(ticket: Pick<Ticket, 'status'>, actor: TicketActor): boolean {
  return actor.staff && ticket.status !== TicketStatus.DELETED;
}

/** Pure : le créateur ou le staff peut consulter le transcript / réouvrir. */
export function canViewTicket(ticket: Pick<Ticket, 'userId' | 'status'>, actor: TicketActor): boolean {
  if (ticket.status === TicketStatus.DELETED) return false;
  return actor.staff || ticket.userId === actor.userId;
}

// ───────────────────────── Service ─────────────────────────

/**
 * Système de tickets : types configurables, panneaux, cycle de vie (open/claim/close/reopen/transfer/delete),
 * transcripts, logs et événements temps réel (`client.bus`).
 */
export class TicketService {
  private client: RedemptionClient | null = null;
  /** channelId → ticketId des tickets ouverts (évite toute requête SQL sur les messages hors ticket) */
  private readonly openChannels = new Map<string, number>();
  private messageBuffer: Prisma.TicketMessageCreateManyInput[] = [];
  /** Écriture en cours du buffer : un flush concurrent (transcript à la fermeture) l'attend avant d'écrire le reste. */
  private flushInFlight: Promise<void> | null = null;
  private schedulerRegistered = false;

  // ───── Cycle de vie ─────

  /** Relie le service au client Discord (appelé dans ready.tickets.ts). */
  attach(client: RedemptionClient): void {
    this.client = client;
    if (!this.schedulerRegistered) {
      scheduler.register({ name: 'tickets:flush-messages', intervalMs: 5_000, run: () => this.flushMessages() });
      this.schedulerRegistered = true;
    }
  }

  /** Charge en mémoire les salons des tickets ouverts. */
  async loadOpenChannels(): Promise<number> {
    const rows = await prisma.ticket.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { id: true, channelId: true } });
    this.openChannels.clear();
    for (const r of rows) this.openChannels.set(r.channelId, r.id);
    return rows.length;
  }

  getOpenChannelIds(): string[] {
    return [...this.openChannels.keys()];
  }

  isTicketChannel(channelId: string): boolean {
    return this.openChannels.has(channelId);
  }

  getTicketIdByChannel(channelId: string): number | undefined {
    return this.openChannels.get(channelId);
  }

  private emit(event: TicketBusEvent, guildId: string, ticketId: number, extra: Record<string, unknown> = {}): void {
    this.client?.bus.emit(event, { guildId, ticketId, ...extra });
  }

  private requireClient(): RedemptionClient {
    if (!this.client) throw new Error('TicketService: client non attaché (appelez ticketService.attach(client))');
    return this.client;
  }

  private async translator(guildId: string, lang?: string | null): Promise<Translator> {
    const cfg = await guildConfigService.get(guildId);
    return translationService.bind(lang ?? cfg?.defaultLanguage ?? 'fr', guildId);
  }

  // ───── Messages (collecte live) ─────

  /** Enregistre un message d'un ticket ouvert dans un buffer flushé périodiquement. */
  recordMessage(message: Message): void {
    if (!message.inGuild()) return;
    const ticketId = this.openChannels.get(message.channelId);
    if (!ticketId) return;
    if (message.system) return;
    if (message.author.id === message.client.user?.id) return;
    this.messageBuffer.push({
      ticketId,
      messageId: message.id,
      authorId: message.author.id,
      authorTag: message.author.tag,
      authorAvatar: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
      content: message.content ?? '',
      attachments: message.attachments.map((a) => ({ name: a.name, url: a.url, size: a.size })) as Prisma.InputJsonValue,
      embeds: message.embeds.map((e) => ({ title: e.title, description: e.description })) as Prisma.InputJsonValue,
      createdAt: message.createdAt,
    });
    if (this.messageBuffer.length >= 50) void this.flushMessages();
  }

  /**
   * Écrit le buffer des messages en base. Si une écriture est déjà en cours (tâche planifiée), on l'attend puis on
   * écrit ce qui reste : le transcript d'un ticket fermé à ce moment-là contient bien les derniers messages.
   */
  async flushMessages(): Promise<void> {
    while (this.flushInFlight) await this.flushInFlight;
    if (!this.messageBuffer.length) return;
    const batch = this.messageBuffer;
    this.messageBuffer = [];
    this.flushInFlight = prisma.ticketMessage
      .createMany({ data: batch, skipDuplicates: true })
      .then(() => undefined)
      .catch((err) => log.error({ err, count: batch.length }, 'Flush des messages de tickets échoué'));
    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }

  // ───── Types ─────

  async listTypes(guildId: string, opts: { enabledOnly?: boolean } = {}): Promise<TicketType[]> {
    return prisma.ticketType.findMany({ where: { guildId, ...(opts.enabledOnly ? { enabled: true } : {}) }, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
  }

  async getType(guildId: string, idOrKey: number | string): Promise<TicketType | null> {
    if (typeof idOrKey === 'number' || /^\d+$/.test(idOrKey)) {
      const t = await prisma.ticketType.findUnique({ where: { id: Number(idOrKey) } });
      if (t && t.guildId === guildId) return t;
      if (typeof idOrKey === 'number') return null;
    }
    return prisma.ticketType.findUnique({ where: { guildId_key: { guildId, key: String(idOrKey) } } });
  }

  /** Crée ou met à jour un type (clé unique par serveur). Utilisé par les commandes et le dashboard. */
  async upsertType(guildId: string, input: TicketTypeInput): Promise<TicketType> {
    const data = ticketTypeInputSchema.parse(input);
    const payload = this.typeData(data);
    const type = await prisma.ticketType.upsert({
      where: { guildId_key: { guildId, key: data.key } },
      create: { guildId, key: data.key, label: data.label, ...payload },
      update: { label: data.label, ...payload },
    });
    this.client?.bus.emit('ticket:type', { guildId, typeId: type.id });
    return type;
  }

  /** Met à jour partiellement un type existant. */
  async updateType(guildId: string, typeId: number, patch: TicketTypePatch): Promise<TicketType> {
    const existing = await prisma.ticketType.findUnique({ where: { id: typeId } });
    if (!existing || existing.guildId !== guildId) throw new TicketError('type_not_found');
    const data = ticketTypeInputSchema.partial().parse(patch);
    const type = await prisma.ticketType.update({ where: { id: typeId }, data: { ...(data.label !== undefined ? { label: data.label } : {}), ...this.typeData(data) } });
    this.client?.bus.emit('ticket:type', { guildId, typeId: type.id });
    return type;
  }

  private typeData(d: Partial<TicketTypeInput>): TypeColumns {
    const out: TypeColumns = {};
    if (d.emoji !== undefined) out.emoji = d.emoji;
    if (d.description !== undefined) out.description = d.description;
    if (d.categoryId !== undefined) out.categoryId = d.categoryId;
    if (d.archiveCategoryId !== undefined) out.archiveCategoryId = d.archiveCategoryId;
    if (d.staffRoleIds !== undefined) out.staffRoleIds = d.staffRoleIds;
    if (d.questions !== undefined) out.questions = d.questions as Prisma.InputJsonValue;
    if (d.embed !== undefined) out.embed = d.embed === null ? Prisma.DbNull : (d.embed as Prisma.InputJsonValue);
    if (d.welcomeMessage !== undefined) out.welcomeMessage = d.welcomeMessage;
    if (d.language !== undefined) out.language = d.language;
    if (d.nameFormat !== undefined) out.nameFormat = d.nameFormat;
    if (d.maxPerUser !== undefined) out.maxPerUser = d.maxPerUser;
    if (d.enabled !== undefined) out.enabled = d.enabled;
    if (d.order !== undefined) out.order = d.order;
    return out;
  }

  async deleteType(guildId: string, typeId: number): Promise<TicketType> {
    const existing = await prisma.ticketType.findUnique({ where: { id: typeId } });
    if (!existing || existing.guildId !== guildId) throw new TicketError('type_not_found');
    await prisma.ticketType.delete({ where: { id: typeId } });
    this.client?.bus.emit('ticket:type', { guildId, typeId });
    return existing;
  }

  /** Seed les types par défaut si le serveur n'en a aucun. Retourne le nombre créé. */
  async ensureDefaultTypes(guildId: string, lang: string): Promise<number> {
    const count = await prisma.ticketType.count({ where: { guildId } });
    if (count > 0) return 0;
    const t = translationService.bind(lang, guildId);
    const question: TicketQuestion = { id: 'details', label: t('tickets.defaults.question_label').slice(0, 45), placeholder: t('tickets.defaults.question_placeholder').slice(0, 100), style: 'paragraph', required: true, maxLength: 1000 };
    await prisma.ticketType.createMany({
      data: DEFAULT_TICKET_TYPES.map((d, i) => ({
        guildId,
        key: d.key,
        label: t(`tickets.defaults.${d.key}.label`),
        emoji: d.emoji,
        description: t(`tickets.defaults.${d.key}.description`).slice(0, 100),
        questions: [question] as unknown as Prisma.InputJsonValue,
        language: lang,
        order: i,
      })),
      skipDuplicates: true,
    });
    return DEFAULT_TICKET_TYPES.length;
  }

  // ───── Panneaux ─────

  async listPanels(guildId: string): Promise<TicketPanel[]> {
    return prisma.ticketPanel.findMany({ where: { guildId }, orderBy: { id: 'asc' } });
  }

  async getPanel(id: number): Promise<TicketPanel | null> {
    return prisma.ticketPanel.findUnique({ where: { id } });
  }

  /** Types affichés par un panneau (ordre du panneau, uniquement activés). */
  async getPanelTypes(panel: TicketPanel): Promise<TicketType[]> {
    const ids = (Array.isArray(panel.typeIds) ? panel.typeIds : []).map(Number).filter((n) => Number.isInteger(n));
    const types = await this.listTypes(panel.guildId, { enabledOnly: true });
    if (!ids.length) return types;
    return ids.map((id) => types.find((t) => t.id === id)).filter((t): t is TicketType => !!t);
  }

  buildPanelMessage(panel: TicketPanel, types: TicketType[], guild: Guild, lang: string, brandColor: number) {
    const t = translationService.bind(lang, guild.id);
    const spec = parseEmbedSpec(panel.embed) ?? this.defaultPanelEmbed(t);
    const embed = buildEmbed(spec, { guild, language: lang }, brandColor);
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    if (panel.style === PanelStyle.SELECT && types.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(buildCustomId('ticket', 'panel-select', panel.id))
        .setPlaceholder(t('tickets.panel.select_placeholder'))
        .addOptions(types.slice(0, 25).map((ty) => this.typeOption(ty)));
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    } else {
      const button = new ButtonBuilder().setCustomId(buildCustomId('ticket', 'panel', panel.id)).setLabel(t('tickets.panel.open_button')).setEmoji('🎫').setStyle(ButtonStyle.Primary);
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
    }
    return { embeds: [embed], components };
  }

  defaultPanelEmbed(t: Translator): EmbedSpec {
    return { title: t('tickets.defaults.panel_title'), description: t('tickets.defaults.panel_description'), footer: { text: t('tickets.defaults.panel_footer') } };
  }

  private typeOption(type: TicketType): StringSelectMenuOptionBuilder {
    const opt = new StringSelectMenuOptionBuilder().setLabel(type.label.slice(0, 100)).setValue(String(type.id));
    if (type.description) opt.setDescription(type.description.slice(0, 100));
    if (type.emoji) {
      try {
        opt.setEmoji(type.emoji);
      } catch {
        /* emoji invalide : ignoré */
      }
    }
    return opt;
  }

  /** Menu « Quel est le sujet ? » (réponse éphémère quand le panneau a plusieurs types). */
  buildTypePicker(panelId: number, types: TicketType[], t: Translator): ActionRowBuilder<StringSelectMenuBuilder> {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId('ticket', 'pick', panelId))
      .setPlaceholder(t('tickets.panel.select_placeholder'))
      .addOptions(types.slice(0, 25).map((ty) => this.typeOption(ty)));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  async createPanel(opts: { guild: Guild; channel: TextChannel | NewsChannel; style: PanelStyle; typeIds: number[]; embed?: EmbedSpec | null; lang: string; brandColor: number }): Promise<TicketPanel> {
    const { guild, channel, style, typeIds, lang, brandColor } = opts;
    const t = translationService.bind(lang, guild.id);
    const embed = opts.embed ?? this.defaultPanelEmbed(t);
    let panel = await prisma.ticketPanel.create({
      data: { guildId: guild.id, channelId: channel.id, embed: embed as Prisma.InputJsonValue, typeIds: typeIds as Prisma.InputJsonValue, style },
    });
    const types = await this.getPanelTypes(panel);
    const message = await channel.send(this.buildPanelMessage(panel, types, guild, lang, brandColor));
    panel = await prisma.ticketPanel.update({ where: { id: panel.id }, data: { messageId: message.id } });
    return panel;
  }

  /** Republie un panneau existant dans son salon (après recréation du salon) et mémorise le nouveau message. */
  async republishPanel(panelId: number): Promise<TicketPanel | null> {
    const panel = await prisma.ticketPanel.findUnique({ where: { id: panelId } });
    if (!panel || !this.client) return null;
    const channel = await this.client.channels.fetch(panel.channelId).catch(() => null);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return null;
    const config = await guildConfigService.get(panel.guildId);
    const types = await this.getPanelTypes(panel);
    const message = await channel.send(this.buildPanelMessage(panel, types, channel.guild, config?.defaultLanguage ?? 'fr', config?.brandColor ?? BRAND.colors.primary));
    return prisma.ticketPanel.update({ where: { id: panel.id }, data: { messageId: message.id } });
  }

  async deletePanel(guildId: string, id: number): Promise<TicketPanel> {
    const panel = await prisma.ticketPanel.findUnique({ where: { id } });
    if (!panel || panel.guildId !== guildId) throw new TicketError('panel_not_found');
    if (panel.messageId && this.client) {
      const channel = await this.client.channels.fetch(panel.channelId).catch(() => null);
      if (channel?.type === ChannelType.GuildText) await channel.messages.delete(panel.messageId).catch(() => null);
    }
    await prisma.ticketPanel.delete({ where: { id } });
    return panel;
  }

  // ───── Permissions ─────

  /** Staff = niveau interne staff (rôles staff/admin, ModerateMembers, ManageGuild…) ou rôle staff du type. */
  isStaff(member: GuildMember | null, config: ResolvedGuildConfig | null, type?: TicketType | null): boolean {
    if (!member) return false;
    if (hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: 'staff' })) return true;
    const roles = asStringArray(type?.staffRoleIds);
    return roles.some((r) => member.roles.cache.has(r));
  }

  actor(member: GuildMember | null, config: ResolvedGuildConfig | null, type?: TicketType | null): TicketActor {
    return { userId: member?.id ?? '', staff: this.isStaff(member, config, type) };
  }

  private staffRoleIds(type: TicketType | null, config: ResolvedGuildConfig | null, guild: Guild): string[] {
    const ids = new Set<string>([...asStringArray(type?.staffRoleIds), ...(config?.staffRoleIds ?? []), ...(config?.adminRoleIds ?? [])]);
    return [...ids].filter((id) => guild.roles.cache.has(id));
  }

  private buildOverwrites(guild: Guild, type: TicketType | null, config: ResolvedGuildConfig | null, userIds: string[]): OverwriteResolvable[] {
    const overwrites: OverwriteResolvable[] = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
    if (guild.members.me) overwrites.push({ id: guild.members.me.id, allow: BOT_PERMS });
    for (const id of new Set(userIds)) overwrites.push({ id, allow: USER_PERMS });
    for (const roleId of this.staffRoleIds(type, config, guild)) overwrites.push({ id: roleId, allow: STAFF_PERMS });
    return overwrites;
  }

  // ───── Ouverture ─────

  /** Vérifie maxPerUser : lance `TicketError('max_per_user')` si la limite est atteinte. */
  async assertCanOpen(guildId: string, userId: string, type: Pick<TicketType, 'id' | 'maxPerUser' | 'enabled'>): Promise<void> {
    if (!type.enabled) throw new TicketError('type_disabled');
    const count = await prisma.ticket.count({ where: { guildId, userId, typeId: type.id, status: { in: OPEN_STATUSES } } });
    if (count >= type.maxPerUser) throw new TicketError('max_per_user', { count, max: type.maxPerUser });
  }

  /**
   * Réserve un numéro séquentiel (TicketCounter, atomique) et crée la ligne Ticket dans la même transaction.
   * Le salon n'existant pas encore, `channelId` reçoit un placeholder remplacé juste après.
   */
  async reserveTicket(input: { guildId: string; typeId: number | null; userId: string; formAnswers: FormAnswer[]; language?: string | null }): Promise<Ticket> {
    return prisma.$transaction(async (tx) => {
      const counter = await tx.ticketCounter.upsert({
        where: { guildId: input.guildId },
        create: { guildId: input.guildId, value: 1 },
        update: { value: { increment: 1 } },
      });
      return tx.ticket.create({
        data: {
          guildId: input.guildId,
          number: counter.value,
          channelId: `pending-${counter.value}`,
          typeId: input.typeId,
          userId: input.userId,
          status: TicketStatus.OPEN,
          formAnswers: input.formAnswers as unknown as Prisma.InputJsonValue,
          participants: [] as unknown as Prisma.InputJsonValue,
          language: input.language ?? null,
        },
      });
    });
  }

  buildChannelName(type: Pick<TicketType, 'nameFormat' | 'key'>, number: number, username: string): string {
    const raw = renderTemplate(type.nameFormat || 'ticket-{number}', { extra: { number, username, type: type.key } });
    return sanitizeChannelName(raw);
  }

  private resolveCategory(guild: Guild, categoryId: string | null | undefined): string | undefined {
    if (!categoryId) return undefined;
    const cat = guild.channels.cache.get(categoryId);
    if (!cat || cat.type !== ChannelType.GuildCategory) return undefined;
    if (cat.children.cache.size >= 50) return undefined;
    return cat.id;
  }

  /** Ouvre un ticket complet : numéro, salon, permissions, embed, mention staff, logs, bus. */
  async openTicket(opts: { guild: Guild; member: GuildMember; type: TicketType; answers: FormAnswer[]; lang: string; config: ResolvedGuildConfig | null }): Promise<{ ticket: Ticket; channel: TextChannel }> {
    const { guild, member, type, answers, config } = opts;
    const lang = type.language ?? opts.lang;
    const t = translationService.bind(lang, guild.id);
    await this.assertCanOpen(guild.id, member.id, type);
    const reserved = await this.reserveTicket({ guildId: guild.id, typeId: type.id, userId: member.id, formAnswers: answers, language: lang });

    let channel: TextChannel;
    try {
      const name = this.buildChannelName(type, reserved.number, member.user.username);
      const create = (parent: string | undefined) =>
        guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent,
          topic: `🎫 #${reserved.number} • ${type.label} • <@${member.id}>`,
          permissionOverwrites: this.buildOverwrites(guild, type, config, [member.id]),
          reason: `Ticket #${reserved.number} (${member.user.tag})`,
        });
      const parent = this.resolveCategory(guild, type.categoryId);
      try {
        channel = await create(parent);
      } catch (err) {
        if (!parent) throw err;
        log.warn({ err, guild: guild.id, parent }, 'Création dans la catégorie échouée, nouvelle tentative sans catégorie');
        channel = await create(undefined);
      }
    } catch (err) {
      log.error({ err, guild: guild.id, ticket: reserved.id }, 'Création du salon ticket échouée');
      await prisma.ticket.delete({ where: { id: reserved.id } }).catch(() => null);
      throw new TicketError('channel_create_failed');
    }

    const ticket = await prisma.ticket.update({ where: { id: reserved.id }, data: { channelId: channel.id } });
    this.openChannels.set(channel.id, ticket.id);

    const roleMentions = this.staffRoleIds(type, config, guild).map((r) => `<@&${r}>`).join(' ');
    const welcome = type.welcomeMessage ? renderTemplate(type.welcomeMessage, { member, guild, language: lang, extra: { number: ticket.number, type: type.label } }) : '';
    const content = [roleMentions ? t('tickets.open.staff_ping', { roles: roleMentions, user: `<@${member.id}>` }) : `<@${member.id}>`, welcome].filter(Boolean).join('\n\n').slice(0, 2000);
    const embed = this.buildTicketEmbed(ticket, type, guild, member.user, lang, config?.brandColor);
    const message = await channel.send({ content, embeds: [embed], components: this.buildControls(ticket, t) }).catch((err) => {
      log.error({ err, ticket: ticket.id }, 'Envoi du message d’ouverture échoué');
      return null;
    });
    if (message) await message.pin().catch(() => null);

    void loggingService.log({
      guildId: guild.id,
      category: LogCategory.TICKET,
      action: 'ticket.open',
      title: t('tickets.log.open', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_user'), value: `<@${member.id}> (${member.id})`, inline: true },
        { name: t('tickets.log.field_type'), value: `${type.emoji ?? ''} ${type.label}`.trim(), inline: true },
        { name: t('tickets.log.field_channel'), value: `<#${channel.id}>`, inline: true },
      ],
      actorId: member.id,
      targetId: member.id,
      color: BRAND.colors.primary,
      data: { ticketId: ticket.id, number: ticket.number, typeId: type.id, channelId: channel.id },
    });
    this.emit('ticket:open', guild.id, ticket.id);
    return { ticket, channel };
  }

  // ───── Embeds & contrôles ─────

  buildTicketEmbed(ticket: Ticket, type: TicketType | null, guild: Guild, user: User | null, lang: string, brandColor: number = BRAND.colors.primary): EmbedBuilder {
    const t = translationService.bind(lang, guild.id);
    const spec = parseEmbedSpec(type?.embed);
    const extra = { number: ticket.number, type: type?.label ?? '—', emoji: type?.emoji ?? '🎫' };
    const embed = spec
      ? buildEmbed(spec, { user, guild, language: lang, extra }, brandColor)
      : buildEmbed({ title: t('tickets.open.title', extra), description: t('tickets.open.description', { user: user ? `<@${user.id}>` : `<@${ticket.userId}>` }) }, { user, guild, language: lang, extra }, brandColor).setFooter({
          text: `${BRAND.footer} • Ticket #${ticket.number}`,
        });
    if (user) embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
    embed.setTimestamp(ticket.createdAt);
    embed.addFields(
      { name: t('tickets.open.field_user'), value: `<@${ticket.userId}>`, inline: true },
      { name: t('tickets.open.field_type'), value: `${type?.emoji ?? ''} ${type?.label ?? '—'}`.trim(), inline: true },
      { name: t('tickets.open.field_status'), value: t(`tickets.status.${ticket.status}`), inline: true },
    );
    if (ticket.claimedById) embed.addFields({ name: t('tickets.open.field_claimed'), value: `<@${ticket.claimedById}>`, inline: true });
    if (ticket.closedById) embed.addFields({ name: t('tickets.open.field_closed_by'), value: `<@${ticket.closedById}>`, inline: true });
    if (ticket.closedAt) embed.addFields({ name: t('tickets.open.field_closed'), value: discordTimestamp(ticket.closedAt, 'f'), inline: true });
    if (ticket.closeReason) embed.addFields({ name: t('tickets.open.field_reason'), value: ticket.closeReason.slice(0, 1024) });
    const answers = asFormAnswers(ticket.formAnswers);
    const budget = 25 - (embed.data.fields?.length ?? 0);
    for (const a of answers.slice(0, Math.max(0, budget))) {
      embed.addFields({ name: a.question.slice(0, 256), value: (a.answer.trim() || t('tickets.open.no_answer')).slice(0, 1024) });
    }
    return embed;
  }

  buildControls(ticket: Pick<Ticket, 'id' | 'status' | 'claimedById'> & { remindersMuted?: boolean }, t: Translator): ActionRowBuilder<ButtonBuilder>[] {
    const id = ticket.id;
    const btn = (action: string, label: string, emoji: string, style: ButtonStyle, disabled = false) =>
      new ButtonBuilder().setCustomId(buildCustomId('ticket', action, id)).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);
    if (OPEN_STATUSES.includes(ticket.status)) {
      return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn('close', t('tickets.buttons.close'), '🔒', ButtonStyle.Danger),
          btn('claim', ticket.claimedById ? t('tickets.buttons.claimed') : t('tickets.buttons.claim'), '👤', ButtonStyle.Primary, !!ticket.claimedById),
          btn('transcript', t('tickets.buttons.transcript'), '📋', ButtonStyle.Secondary),
          btn('add', t('tickets.buttons.add'), '👥', ButtonStyle.Secondary),
          btn('remove', t('tickets.buttons.remove'), '🚫', ButtonStyle.Secondary),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn('transfer', t('tickets.buttons.transfer'), '🔄', ButtonStyle.Secondary),
          ticket.remindersMuted
            ? btn('mute', t('ticket_reminders.btn_muted_control'), '🔕', ButtonStyle.Success)
            : btn('mute', t('ticket_reminders.btn_unmuted_control'), '📌', ButtonStyle.Secondary),
          btn('delete', t('tickets.buttons.delete'), '🗑️', ButtonStyle.Danger),
        ),
      ];
    }
    if (ticket.status === TicketStatus.DELETED) return [];
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        btn('reopen', t('tickets.buttons.reopen'), '🔓', ButtonStyle.Success),
        btn('transcript', t('tickets.buttons.transcript'), '📋', ButtonStyle.Secondary),
        btn('delete', t('tickets.buttons.delete'), '🗑️', ButtonStyle.Danger),
      ),
    ];
  }

  /** Retrouve le message de contrôle (épinglé ou parmi les premiers messages du salon). */
  async findControlMessage(channel: TextChannel): Promise<Message | null> {
    const me = channel.client.user?.id;
    const isControl = (m: Message) =>
      m.author.id === me &&
      m.components.some((row) => row.type === ComponentType.ActionRow && row.components.some((c) => 'customId' in c && typeof c.customId === 'string' && c.customId.startsWith('ticket:')));
    const pinned = await channel.messages.fetchPinned().catch(() => null);
    const fromPinned = pinned?.find(isControl);
    if (fromPinned) return fromPinned;
    const first = await channel.messages.fetch({ after: channel.id, limit: 10 }).catch(() => null);
    return first?.find(isControl) ?? null;
  }

  /** Met à jour embed + boutons du message de contrôle. */
  async refreshControlMessage(ticket: Ticket, channel: TextChannel | null, message?: Message | null): Promise<void> {
    if (!channel) return;
    const target = message ?? (await this.findControlMessage(channel));
    if (!target) return;
    const type = ticket.typeId ? await prisma.ticketType.findUnique({ where: { id: ticket.typeId } }) : null;
    const config = await guildConfigService.get(ticket.guildId);
    const lang = ticket.language ?? config?.defaultLanguage ?? 'fr';
    const t = translationService.bind(lang, ticket.guildId);
    const user = await channel.client.users.fetch(ticket.userId).catch(() => null);
    const embed = this.buildTicketEmbed(ticket, type, channel.guild, user, lang, config?.brandColor);
    await target.edit({ embeds: [embed], components: this.buildControls(ticket, t) }).catch((err) => log.warn({ err, ticket: ticket.id }, 'Mise à jour du message de contrôle échouée'));
  }

  /** Republie le message de contrôle (embed + boutons, épinglé) d'un ticket ouvert : salon recréé par /clear. */
  async republishControls(ticketId: number): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket || !OPEN_STATUSES.includes(ticket.status)) return;
    const channel = await this.fetchChannel(ticket.channelId);
    if (!channel) return;
    const config = await guildConfigService.get(ticket.guildId);
    const lang = ticket.language ?? config?.defaultLanguage ?? 'fr';
    const t = translationService.bind(lang, ticket.guildId);
    const user = await channel.client.users.fetch(ticket.userId).catch(() => null);
    const message = await channel.send({ embeds: [this.buildTicketEmbed(ticket, ticket.type, channel.guild, user, lang, config?.brandColor)], components: this.buildControls(ticket, t) });
    await message.pin().catch(() => null);
  }

  // ───── Lecture ─────

  async getTicket(id: number): Promise<TicketFull | null> {
    return prisma.ticket.findUnique({ where: { id }, include: { type: true, transcript: true } });
  }

  async getTicketByChannel(channelId: string): Promise<TicketFull | null> {
    return prisma.ticket.findFirst({ where: { channelId, status: { not: TicketStatus.DELETED } }, orderBy: { id: 'desc' }, include: { type: true, transcript: true } });
  }

  async getTicketByNumber(guildId: string, number: number): Promise<TicketFull | null> {
    return prisma.ticket.findUnique({ where: { guildId_number: { guildId, number } }, include: { type: true, transcript: true } });
  }

  async listTickets(guildId: string, filters: TicketListFilters = {}, page = 1, pageSize = 10): Promise<TicketListResult> {
    const where: Prisma.TicketWhereInput = { guildId };
    if (filters.status === 'open') where.status = { in: OPEN_STATUSES };
    else if (filters.status === 'closed') where.status = { in: CLOSED_STATUSES };
    else if (Array.isArray(filters.status)) where.status = { in: filters.status };
    else if (filters.status) where.status = filters.status;
    if (filters.userId) where.userId = filters.userId;
    if (filters.typeId) where.typeId = filters.typeId;
    if (filters.claimedById) where.claimedById = filters.claimedById;
    if (filters.search) {
      const n = Number(filters.search);
      where.OR = [...(Number.isInteger(n) ? [{ number: n }] : []), { userId: filters.search }, { closeReason: { contains: filters.search } }];
    }
    const size = Math.min(Math.max(1, pageSize), 50);
    const current = Math.max(1, page);
    const [total, items] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({ where, include: { type: true }, orderBy: { createdAt: 'desc' }, skip: (current - 1) * size, take: size }),
    ]);
    return { items, total, page: current, pages: Math.max(1, Math.ceil(total / size)), pageSize: size };
  }

  async getStats(guildId: string): Promise<TicketStats> {
    const [open, claimed, closed, deleted, total, agg, grouped, types] = await Promise.all([
      prisma.ticket.count({ where: { guildId, status: TicketStatus.OPEN } }),
      prisma.ticket.count({ where: { guildId, status: TicketStatus.CLAIMED } }),
      prisma.ticket.count({ where: { guildId, status: { in: CLOSED_STATUSES } } }),
      prisma.ticket.count({ where: { guildId, status: TicketStatus.DELETED } }),
      prisma.ticket.count({ where: { guildId } }),
      prisma.ticketTranscript.aggregate({ where: { ticket: { guildId } }, _avg: { durationSeconds: true, messageCount: true } }),
      prisma.ticket.groupBy({ by: ['typeId'], where: { guildId }, _count: { _all: true } }),
      this.listTypes(guildId),
    ]);
    const byType = (grouped ?? []).map((g) => ({ typeId: g.typeId, label: types.find((t) => t.id === g.typeId)?.label ?? '—', count: g._count._all }));
    return {
      open,
      claimed,
      closed,
      deleted,
      total,
      avgDurationSeconds: Math.round(agg?._avg?.durationSeconds ?? 0),
      avgMessages: Math.round(agg?._avg?.messageCount ?? 0),
      byType,
    };
  }

  private async fetchChannel(channelId: string): Promise<TextChannel | null> {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    return channel?.type === ChannelType.GuildText ? channel : null;
  }

  private async loadTicket(ticketId: number): Promise<TicketFull> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new TicketError('not_found');
    if (ticket.status === TicketStatus.DELETED) throw new TicketError('deleted');
    return ticket;
  }

  // ───── Transcript ─────

  /** Historique du salon (fallback quand aucun message n'a été collecté) ; persiste les lignes récupérées. */
  async fetchHistory(channel: TextChannel, ticketId: number, max = HISTORY_LIMIT): Promise<Prisma.TicketMessageCreateManyInput[]> {
    const rows: Prisma.TicketMessageCreateManyInput[] = [];
    let before: string | undefined;
    const me = channel.client.user?.id;
    while (rows.length < max) {
      const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
      if (!batch || batch.size === 0) break;
      for (const m of batch.values()) {
        if (m.system || m.author.id === me) continue;
        rows.push({
          ticketId,
          messageId: m.id,
          authorId: m.author.id,
          authorTag: m.author.tag,
          authorAvatar: m.author.displayAvatarURL({ extension: 'png', size: 128 }),
          content: m.content ?? '',
          attachments: m.attachments.map((a) => ({ name: a.name, url: a.url, size: a.size })) as Prisma.InputJsonValue,
          embeds: m.embeds.map((e) => ({ title: e.title, description: e.description })) as Prisma.InputJsonValue,
          createdAt: m.createdAt,
        });
      }
      before = batch.last()?.id;
      if (batch.size < 100) break;
    }
    rows.sort((a, b) => new Date(a.createdAt as Date).getTime() - new Date(b.createdAt as Date).getTime());
    if (rows.length) await prisma.ticketMessage.createMany({ data: rows, skipDuplicates: true }).catch((err) => log.warn({ err }, 'Persistance de l’historique échouée'));
    return rows;
  }

  private async participant(id: string, guild: Guild | null, config: ResolvedGuildConfig | null, type: TicketType | null, t: Translator, cache: Map<string, TranscriptParticipant>): Promise<TranscriptParticipant> {
    const cached = cache.get(id);
    if (cached) return cached;
    const client = this.client;
    const user = client ? await client.users.fetch(id).catch(() => null) : null;
    const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
    const p: TranscriptParticipant = {
      id,
      tag: user ? (user.discriminator && user.discriminator !== '0' ? user.tag : `@${user.username}`) : t('tickets.transcript.unknown_user'),
      avatar: user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
      staff: this.isStaff(member, config, type),
    };
    cache.set(id, p);
    return p;
  }

  async buildTranscriptData(ticket: TicketFull, opts: { reason?: string | null; closedById?: string | null; closedAt?: Date } = {}): Promise<TranscriptData> {
    await this.flushMessages();
    const config = await guildConfigService.get(ticket.guildId);
    const lang = ticket.language ?? config?.defaultLanguage ?? 'fr';
    const t = translationService.bind(lang, ticket.guildId);
    const guild = this.client?.guilds.cache.get(ticket.guildId) ?? null;
    const channel = await this.fetchChannel(ticket.channelId);

    let rows: { messageId: string; authorId: string; authorTag: string; authorAvatar: string | null; content: string; attachments: unknown; embeds: unknown; createdAt: Date }[] = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length && channel) {
      rows = (await this.fetchHistory(channel, ticket.id)).map((r) => ({
        messageId: r.messageId,
        authorId: r.authorId,
        authorTag: r.authorTag,
        authorAvatar: r.authorAvatar ?? null,
        content: r.content,
        attachments: r.attachments,
        embeds: r.embeds,
        createdAt: new Date(r.createdAt as Date),
      }));
    }

    const messages: TranscriptMessage[] = rows.map((r) => ({
      messageId: r.messageId,
      authorId: r.authorId,
      authorTag: r.authorTag,
      authorAvatar: r.authorAvatar,
      content: r.content,
      attachments: Array.isArray(r.attachments) ? (r.attachments as { name?: string; url?: string; size?: number }[]).map((a) => ({ name: String(a.name ?? 'file'), url: String(a.url ?? ''), size: a.size })) : [],
      embeds: Array.isArray(r.embeds) ? (r.embeds as { title?: string | null; description?: string | null }[]).map((e) => ({ title: e.title ?? null, description: e.description ?? null })) : [],
      createdAt: r.createdAt,
    }));

    const cache = new Map<string, TranscriptParticipant>();
    const creator = await this.participant(ticket.userId, guild, config, ticket.type, t, cache);
    const claimedBy = ticket.claimedById ? await this.participant(ticket.claimedById, guild, config, ticket.type, t, cache) : null;
    const closerId = opts.closedById ?? ticket.closedById;
    const closedBy = closerId ? await this.participant(closerId, guild, config, ticket.type, t, cache) : null;
    const ids = new Set<string>([ticket.userId, ...asStringArray(ticket.participants), ...messages.map((m) => m.authorId)]);
    if (ticket.claimedById) ids.add(ticket.claimedById);
    if (closerId) ids.add(closerId);
    const participants: TranscriptParticipant[] = [];
    for (const id of [...ids].slice(0, 50)) participants.push(await this.participant(id, guild, config, ticket.type, t, cache));

    return {
      guildId: ticket.guildId,
      guildName: guild?.name ?? config?.name ?? ticket.guildId,
      guildIcon: guild?.iconURL({ extension: 'png', size: 128 }) ?? null,
      ticketNumber: ticket.number,
      ticketId: ticket.id,
      typeLabel: ticket.type?.label ?? '—',
      typeEmoji: ticket.type?.emoji ?? null,
      creator,
      claimedBy,
      closedBy,
      closeReason: opts.reason ?? ticket.closeReason,
      openedAt: ticket.createdAt,
      closedAt: opts.closedAt ?? ticket.closedAt ?? new Date(),
      participants,
      formAnswers: asFormAnswers(ticket.formAnswers),
      messages,
      language: lang,
    };
  }

  /** Génère (ou régénère) le transcript d'un ticket et l'enregistre en base. */
  async generateTranscript(ticketId: number, opts: { reason?: string | null; closedById?: string | null; closedAt?: Date } = {}): Promise<{ record: TicketTranscript; files: TranscriptFiles; data: TranscriptData }> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new TicketError('not_found');
    const data = await this.buildTranscriptData(ticket, opts);
    let files: TranscriptFiles;
    try {
      files = await transcriptService.generate(data);
    } catch (err) {
      log.error({ err, ticket: ticketId }, 'Transcript échoué');
      throw new TicketError('transcript_failed');
    }
    const staffIds = data.participants.filter((p) => p.staff).map((p) => p.id);
    const payload = {
      htmlPath: files.htmlPath,
      txtPath: files.txtPath,
      pdfPath: files.pdfPath,
      messageCount: files.messageCount,
      durationSeconds: files.durationSeconds,
      staffIds: staffIds as unknown as Prisma.InputJsonValue,
      closeReason: data.closeReason ?? null,
    };
    const record = await prisma.ticketTranscript.upsert({ where: { ticketId }, create: { ticketId, ...payload }, update: payload });
    return { record, files, data };
  }

  transcriptAttachments(files: Pick<TranscriptFiles, 'htmlPath' | 'txtPath' | 'pdfPath'>, number: number): AttachmentBuilder[] {
    return [
      new AttachmentBuilder(files.htmlPath, { name: `ticket-${number}.html` }),
      new AttachmentBuilder(files.txtPath, { name: `ticket-${number}.txt` }),
      new AttachmentBuilder(files.pdfPath, { name: `ticket-${number}.pdf` }),
    ];
  }

  transcriptEmbed(data: TranscriptData, t: Translator, color: number = BRAND.colors.primary): EmbedBuilder {
    const none = t('tickets.transcript.none');
    return new EmbedBuilder()
      .setColor(color)
      .setTitle(t('tickets.transcript.log_title', { number: data.ticketNumber }))
      .addFields(
        { name: t('tickets.transcript.type'), value: `${data.typeEmoji ?? ''} ${data.typeLabel}`.trim(), inline: true },
        { name: t('tickets.transcript.opened_by'), value: `<@${data.creator.id}>`, inline: true },
        { name: t('tickets.transcript.closed_by'), value: data.closedBy ? `<@${data.closedBy.id}>` : none, inline: true },
        { name: t('tickets.transcript.duration'), value: formatDuration(transcriptService.durationSeconds(data), data.language), inline: true },
        { name: t('tickets.transcript.messages'), value: String(data.messages.length), inline: true },
        { name: t('tickets.transcript.reason'), value: (data.closeReason?.trim() || none).slice(0, 1024), inline: false },
      )
      .setFooter({ text: BRAND.footer })
      .setTimestamp(data.closedAt);
  }

  /** Envoie le transcript : fichiers dans le ticket, dans le salon de logs TICKET, et en DM au créateur. */
  async sendTranscript(ticket: TicketFull, result: { files: TranscriptFiles; data: TranscriptData }, opts: { channel?: TextChannel | null; dm?: boolean; logChannel?: boolean } = {}): Promise<void> {
    const config = await guildConfigService.get(ticket.guildId);
    const lang = ticket.language ?? config?.defaultLanguage ?? 'fr';
    const t = translationService.bind(lang, ticket.guildId);
    const embed = this.transcriptEmbed(result.data, t, config?.brandColor);
    const files = () => this.transcriptAttachments(result.files, ticket.number);
    if (opts.channel) await opts.channel.send({ embeds: [embed], files: files() }).catch((err) => log.warn({ err, ticket: ticket.id }, 'Envoi du transcript dans le ticket échoué'));
    if (opts.logChannel !== false && this.client) {
      const logChannelId = config?.logChannels.TICKET ?? config?.logChannels.SYSTEM;
      if (logChannelId && config?.modules.logs) {
        const ch = await this.client.channels.fetch(logChannelId).catch(() => null);
        if (ch?.type === ChannelType.GuildText) await ch.send({ embeds: [embed], files: files() }).catch((err) => log.warn({ err }, 'Envoi du transcript dans les logs échoué'));
      }
    }
    if (opts.dm !== false && this.client) {
      const user = await this.client.users.fetch(ticket.userId).catch(() => null);
      if (user) await user.send({ content: t('tickets.actions.transcript_dm', { number: ticket.number, server: result.data.guildName }), embeds: [embed], files: files() }).catch(() => null);
    }
  }

  // ───── Actions ─────

  /** Ferme un ticket : permissions retirées, archivage, transcript, logs, bus. Utilisable depuis le dashboard. */
  async closeTicket(input: { ticketId: number; closedById: string; reason?: string | null }): Promise<{ ticket: TicketFull; transcript: TicketTranscript | null }> {
    const current = await this.loadTicket(input.ticketId);
    if (!OPEN_STATUSES.includes(current.status)) throw new TicketError('already_closed');
    const reason = input.reason?.trim() || null;
    const closedAt = new Date();
    const config = await guildConfigService.get(current.guildId);
    const lang = current.language ?? config?.defaultLanguage ?? 'fr';
    const t = translationService.bind(lang, current.guildId);

    const channel = await this.fetchChannel(current.channelId);
    const archiveId = current.type?.archiveCategoryId ?? null;
    const archived = !!(channel && archiveId && channel.guild.channels.cache.get(archiveId)?.type === ChannelType.GuildCategory);

    await prisma.ticket.update({
      where: { id: current.id },
      data: { status: archived ? TicketStatus.ARCHIVED : TicketStatus.CLOSED, closedById: input.closedById, closeReason: reason, closedAt },
    });
    this.openChannels.delete(current.channelId);

    if (channel) {
      for (const id of [current.userId, ...asStringArray(current.participants)]) {
        await channel.permissionOverwrites.edit(id, { SendMessages: false, ViewChannel: false }).catch(() => null);
      }
      if (archived && archiveId) await channel.setParent(archiveId, { lockPermissions: false }).catch((err) => log.warn({ err, ticket: current.id }, 'Déplacement en archive échoué'));
      await channel.send({ content: [t('tickets.actions.closed', { user: `<@${input.closedById}>` }), reason ? t('tickets.actions.closed_reason', { reason }) : ''].filter(Boolean).join('\n') }).catch(() => null);
    }

    let transcript: TicketTranscript | null = null;
    try {
      const result = await this.generateTranscript(current.id, { reason, closedById: input.closedById, closedAt });
      transcript = result.record;
      const reloaded = (await this.getTicket(current.id)) ?? current;
      await this.sendTranscript(reloaded, result, { channel });
    } catch (err) {
      log.error({ err, ticket: current.id }, 'Transcript de fermeture échoué');
    }

    const ticket = (await this.getTicket(current.id)) ?? current;
    await this.refreshControlMessage(ticket, channel);

    void loggingService.log({
      guildId: ticket.guildId,
      category: LogCategory.TICKET,
      action: 'ticket.close',
      title: t('tickets.log.close', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_user'), value: `<@${ticket.userId}>`, inline: true },
        { name: t('tickets.log.field_staff'), value: `<@${input.closedById}>`, inline: true },
        { name: t('tickets.log.field_type'), value: ticket.type?.label ?? '—', inline: true },
        { name: t('tickets.log.field_duration'), value: formatDuration(transcript?.durationSeconds ?? Math.floor((closedAt.getTime() - ticket.createdAt.getTime()) / 1000), lang), inline: true },
        { name: t('tickets.log.field_messages'), value: String(transcript?.messageCount ?? 0), inline: true },
        { name: t('tickets.log.field_reason'), value: reason ?? '—', inline: false },
      ],
      actorId: input.closedById,
      targetId: ticket.userId,
      color: BRAND.colors.anthracite,
      data: { ticketId: ticket.id, number: ticket.number, reason, transcriptId: transcript?.id ?? null },
    });
    this.emit('ticket:close', ticket.guildId, ticket.id);
    return { ticket, transcript };
  }

  async reopenTicket(input: { ticketId: number; byId: string }): Promise<TicketFull> {
    const current = await this.loadTicket(input.ticketId);
    if (!CLOSED_STATUSES.includes(current.status)) throw new TicketError('not_closed');
    const config = await guildConfigService.get(current.guildId);
    const lang = current.language ?? config?.defaultLanguage ?? 'fr';
    const t = translationService.bind(lang, current.guildId);
    const channel = await this.fetchChannel(current.channelId);
    if (!channel) throw new TicketError('channel_missing');

    await prisma.ticket.update({
      where: { id: current.id },
      data: { status: current.claimedById ? TicketStatus.CLAIMED : TicketStatus.OPEN, closedById: null, closeReason: null, closedAt: null },
    });
    this.openChannels.set(channel.id, current.id);

    for (const id of [current.userId, ...asStringArray(current.participants)]) {
      await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }).catch(() => null);
    }
    const parent = this.resolveCategory(channel.guild, current.type?.categoryId);
    if (parent && channel.parentId !== parent) await channel.setParent(parent, { lockPermissions: false }).catch(() => null);
    await channel.send({ content: `<@${current.userId}> ${t('tickets.actions.reopened', { user: `<@${input.byId}>` })}` }).catch(() => null);

    const ticket = (await this.getTicket(current.id)) ?? current;
    await this.refreshControlMessage(ticket, channel);
    void loggingService.log({
      guildId: ticket.guildId,
      category: LogCategory.TICKET,
      action: 'ticket.reopen',
      title: t('tickets.log.reopen', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_user'), value: `<@${ticket.userId}>`, inline: true },
        { name: t('tickets.log.field_staff'), value: `<@${input.byId}>`, inline: true },
        { name: t('tickets.log.field_channel'), value: `<#${channel.id}>`, inline: true },
      ],
      actorId: input.byId,
      targetId: ticket.userId,
      color: BRAND.colors.primary,
      data: { ticketId: ticket.id, number: ticket.number },
    });
    this.emit('ticket:update', ticket.guildId, ticket.id, { action: 'reopen' });
    return ticket;
  }

  async claimTicket(input: { ticketId: number; staffId: string; message?: Message | null }): Promise<TicketFull> {
    const current = await this.loadTicket(input.ticketId);
    if (!OPEN_STATUSES.includes(current.status)) throw new TicketError('already_closed');
    if (current.claimedById && current.claimedById !== input.staffId) throw new TicketError('already_claimed', { user: `<@${current.claimedById}>` });
    const config = await guildConfigService.get(current.guildId);
    const lang = current.language ?? config?.defaultLanguage ?? 'fr';
    const t = translationService.bind(lang, current.guildId);

    await prisma.ticket.update({ where: { id: current.id }, data: { status: TicketStatus.CLAIMED, claimedById: input.staffId } });
    const channel = await this.fetchChannel(current.channelId);
    if (channel) {
      await channel.permissionOverwrites.edit(input.staffId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageMessages: true }).catch(() => null);
      await channel.send({ content: t('tickets.actions.claimed', { user: `<@${input.staffId}>` }) }).catch(() => null);
    }
    const ticket = (await this.getTicket(current.id)) ?? current;
    await this.refreshControlMessage(ticket, channel, input.message);
    void loggingService.log({
      guildId: ticket.guildId,
      category: LogCategory.TICKET,
      action: 'ticket.claim',
      title: t('tickets.log.claim', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_user'), value: `<@${ticket.userId}>`, inline: true },
        { name: t('tickets.log.field_staff'), value: `<@${input.staffId}>`, inline: true },
        { name: t('tickets.log.field_channel'), value: `<#${ticket.channelId}>`, inline: true },
      ],
      actorId: input.staffId,
      targetId: ticket.userId,
      color: BRAND.colors.primary,
      data: { ticketId: ticket.id, number: ticket.number },
    });
    this.emit('ticket:update', ticket.guildId, ticket.id, { action: 'claim' });
    return ticket;
  }

  async addMember(input: { ticketId: number; targetId: string; byId: string }): Promise<TicketFull> {
    const current = await this.loadTicket(input.ticketId);
    const channel = await this.fetchChannel(current.channelId);
    if (!channel) throw new TicketError('channel_missing');
    const member = await channel.guild.members.fetch(input.targetId).catch(() => null);
    if (!member) throw new TicketError('member_not_found');
    if (member.user.bot) throw new TicketError('cannot_add_bot');
    const config = await guildConfigService.get(current.guildId);
    const t = translationService.bind(current.language ?? config?.defaultLanguage ?? 'fr', current.guildId);

    const participants = [...new Set([...asStringArray(current.participants), input.targetId])].filter((id) => id !== current.userId);
    await prisma.ticket.update({ where: { id: current.id }, data: { participants: participants as unknown as Prisma.InputJsonValue } });
    await channel.permissionOverwrites.edit(input.targetId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true });
    await channel.send({ content: t('tickets.actions.member_added', { target: `<@${input.targetId}>`, user: `<@${input.byId}>` }) }).catch(() => null);

    const ticket = (await this.getTicket(current.id)) ?? current;
    void loggingService.log({
      guildId: ticket.guildId,
      category: LogCategory.TICKET,
      action: 'ticket.member_add',
      title: t('tickets.log.add', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_target'), value: `<@${input.targetId}>`, inline: true },
        { name: t('tickets.log.field_staff'), value: `<@${input.byId}>`, inline: true },
        { name: t('tickets.log.field_channel'), value: `<#${channel.id}>`, inline: true },
      ],
      actorId: input.byId,
      targetId: input.targetId,
      data: { ticketId: ticket.id, number: ticket.number },
    });
    this.emit('ticket:update', ticket.guildId, ticket.id, { action: 'member_add' });
    return ticket;
  }

  async removeMember(input: { ticketId: number; targetId: string; byId: string }): Promise<TicketFull> {
    const current = await this.loadTicket(input.ticketId);
    if (input.targetId === current.userId) throw new TicketError('cannot_remove_creator');
    const channel = await this.fetchChannel(current.channelId);
    if (!channel) throw new TicketError('channel_missing');
    const config = await guildConfigService.get(current.guildId);
    const t = translationService.bind(current.language ?? config?.defaultLanguage ?? 'fr', current.guildId);

    const participants = asStringArray(current.participants).filter((id) => id !== input.targetId);
    await prisma.ticket.update({ where: { id: current.id }, data: { participants: participants as unknown as Prisma.InputJsonValue } });
    await channel.permissionOverwrites.delete(input.targetId).catch(() => null);
    await channel.send({ content: t('tickets.actions.member_removed', { target: `<@${input.targetId}>`, user: `<@${input.byId}>` }) }).catch(() => null);

    const ticket = (await this.getTicket(current.id)) ?? current;
    void loggingService.log({
      guildId: ticket.guildId,
      category: LogCategory.TICKET,
      action: 'ticket.member_remove',
      title: t('tickets.log.remove', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_target'), value: `<@${input.targetId}>`, inline: true },
        { name: t('tickets.log.field_staff'), value: `<@${input.byId}>`, inline: true },
        { name: t('tickets.log.field_channel'), value: `<#${channel.id}>`, inline: true },
      ],
      actorId: input.byId,
      targetId: input.targetId,
      data: { ticketId: ticket.id, number: ticket.number },
    });
    this.emit('ticket:update', ticket.guildId, ticket.id, { action: 'member_remove' });
    return ticket;
  }

  async transferTicket(input: { ticketId: number; newTypeId: number; byId: string; message?: Message | null }): Promise<TicketFull> {
    const current = await this.loadTicket(input.ticketId);
    if (current.typeId === input.newTypeId) throw new TicketError('same_type');
    const newType = await prisma.ticketType.findUnique({ where: { id: input.newTypeId } });
    if (!newType || newType.guildId !== current.guildId) throw new TicketError('type_not_found');
    const config = await guildConfigService.get(current.guildId);
    const t = translationService.bind(current.language ?? config?.defaultLanguage ?? 'fr', current.guildId);
    const channel = await this.fetchChannel(current.channelId);

    await prisma.ticket.update({ where: { id: current.id }, data: { typeId: newType.id } });
    if (channel) {
      const guild = channel.guild;
      const oldRoles = this.staffRoleIds(current.type, config, guild);
      const newRoles = this.staffRoleIds(newType, config, guild);
      const keep = new Set([...(config?.staffRoleIds ?? []), ...(config?.adminRoleIds ?? []), ...newRoles]);
      for (const r of oldRoles) if (!keep.has(r)) await channel.permissionOverwrites.delete(r).catch(() => null);
      for (const r of newRoles) await channel.permissionOverwrites.edit(r, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageMessages: true, AttachFiles: true, EmbedLinks: true }).catch(() => null);
      const parent = this.resolveCategory(guild, OPEN_STATUSES.includes(current.status) ? newType.categoryId : (newType.archiveCategoryId ?? newType.categoryId));
      if (parent && channel.parentId !== parent) await channel.setParent(parent, { lockPermissions: false }).catch(() => null);
      const ping = newRoles.map((r) => `<@&${r}>`).join(' ');
      await channel.send({ content: [t('tickets.actions.transferred', { type: newType.label, user: `<@${input.byId}>` }), ping].filter(Boolean).join('\n') }).catch(() => null);
    }
    const ticket = (await this.getTicket(current.id)) ?? current;
    await this.refreshControlMessage(ticket, channel, input.message);
    void loggingService.log({
      guildId: ticket.guildId,
      category: LogCategory.TICKET,
      action: 'ticket.transfer',
      title: t('tickets.log.transfer', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_from'), value: current.type?.label ?? '—', inline: true },
        { name: t('tickets.log.field_to'), value: newType.label, inline: true },
        { name: t('tickets.log.field_staff'), value: `<@${input.byId}>`, inline: true },
      ],
      actorId: input.byId,
      targetId: ticket.userId,
      color: BRAND.colors.primary,
      data: { ticketId: ticket.id, number: ticket.number, fromTypeId: current.typeId, toTypeId: newType.id },
    });
    this.emit('ticket:update', ticket.guildId, ticket.id, { action: 'transfer' });
    return ticket;
  }

  async renameTicket(input: { ticketId: number; name: string }): Promise<string> {
    const current = await this.loadTicket(input.ticketId);
    const channel = await this.fetchChannel(current.channelId);
    if (!channel) throw new TicketError('channel_missing');
    const name = sanitizeChannelName(input.name);
    await channel.setName(name);
    this.emit('ticket:update', current.guildId, current.id, { action: 'rename' });
    return name;
  }

  /** Supprime définitivement : transcript garanti, statut DELETED, salon supprimé, log, bus. */
  async deleteTicket(input: { ticketId: number; byId: string }): Promise<TicketFull> {
    const current = await this.loadTicket(input.ticketId);
    const config = await guildConfigService.get(current.guildId);
    const t = translationService.bind(current.language ?? config?.defaultLanguage ?? 'fr', current.guildId);
    const channel = await this.fetchChannel(current.channelId);

    if (!current.transcript) {
      try {
        const result = await this.generateTranscript(current.id, { closedById: current.closedById ?? input.byId, closedAt: current.closedAt ?? new Date() });
        await this.sendTranscript(current, result, { channel: null, dm: OPEN_STATUSES.includes(current.status) });
      } catch (err) {
        log.error({ err, ticket: current.id }, 'Transcript avant suppression échoué');
      }
    }

    await prisma.ticket.update({
      where: { id: current.id },
      data: { status: TicketStatus.DELETED, closedById: current.closedById ?? input.byId, closedAt: current.closedAt ?? new Date() },
    });
    this.openChannels.delete(current.channelId);
    if (channel) await channel.delete(`Ticket #${current.number} supprimé par ${input.byId}`).catch((err) => log.warn({ err, ticket: current.id }, 'Suppression du salon échouée'));

    const ticket = (await this.getTicket(current.id)) ?? current;
    void loggingService.log({
      guildId: ticket.guildId,
      category: LogCategory.TICKET,
      action: 'ticket.delete',
      title: t('tickets.log.delete', { number: ticket.number }),
      fields: [
        { name: t('tickets.log.field_user'), value: `<@${ticket.userId}>`, inline: true },
        { name: t('tickets.log.field_staff'), value: `<@${input.byId}>`, inline: true },
        { name: t('tickets.log.field_type'), value: ticket.type?.label ?? '—', inline: true },
      ],
      actorId: input.byId,
      targetId: ticket.userId,
      color: BRAND.colors.danger,
      data: { ticketId: ticket.id, number: ticket.number },
    });
    this.emit('ticket:update', ticket.guildId, ticket.id, { action: 'delete' });
    return ticket;
  }

  /** Salon supprimé à la main → statut DELETED. */
  async markChannelDeleted(channelId: string, guildId: string): Promise<TicketFull | null> {
    const ticket = await this.getTicketByChannel(channelId);
    this.openChannels.delete(channelId);
    if (!ticket) return null;
    const config = await guildConfigService.get(guildId);
    const t = translationService.bind(ticket.language ?? config?.defaultLanguage ?? 'fr', guildId);
    if (!ticket.transcript && (await prisma.ticketMessage.count({ where: { ticketId: ticket.id } })) > 0) {
      await this.generateTranscript(ticket.id, { closedAt: new Date() }).catch((err) => log.warn({ err, ticket: ticket.id }, 'Transcript après suppression manuelle échoué'));
    }
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.DELETED, closedAt: ticket.closedAt ?? new Date() } });
    void loggingService.log({
      guildId,
      category: LogCategory.TICKET,
      action: 'ticket.delete',
      title: t('tickets.log.delete', { number: ticket.number }),
      description: t('tickets.log.channel_deleted'),
      fields: [{ name: t('tickets.log.field_user'), value: `<@${ticket.userId}>`, inline: true }],
      targetId: ticket.userId,
      color: BRAND.colors.danger,
      data: { ticketId: ticket.id, number: ticket.number, manual: true },
    });
    this.emit('ticket:update', guildId, ticket.id, { action: 'delete' });
    return (await this.getTicket(ticket.id)) ?? ticket;
  }

  /** Embed d'information d'un ticket (/ticket info). */
  infoEmbed(ticket: TicketFull, t: Translator, lang: string, color: number = BRAND.colors.primary): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(t('tickets.info.title', { number: ticket.number }))
      .addFields(
        { name: t('tickets.open.field_user'), value: `<@${ticket.userId}>`, inline: true },
        { name: t('tickets.open.field_type'), value: `${ticket.type?.emoji ?? ''} ${ticket.type?.label ?? '—'}`.trim(), inline: true },
        { name: t('tickets.open.field_status'), value: t(`tickets.status.${ticket.status}`), inline: true },
        { name: t('tickets.info.channel'), value: ticket.status === TicketStatus.DELETED ? '—' : `<#${ticket.channelId}>`, inline: true },
        { name: t('tickets.info.created_at'), value: discordTimestamp(ticket.createdAt, 'f'), inline: true },
      )
      .setFooter({ text: `${BRAND.footer} • ID ${ticket.id}` });
    if (ticket.claimedById) embed.addFields({ name: t('tickets.open.field_claimed'), value: `<@${ticket.claimedById}>`, inline: true });
    if (ticket.closedAt) embed.addFields({ name: t('tickets.info.closed_at'), value: discordTimestamp(ticket.closedAt, 'f'), inline: true });
    if (ticket.closedById) embed.addFields({ name: t('tickets.open.field_closed_by'), value: `<@${ticket.closedById}>`, inline: true });
    const duration = ticket.transcript?.durationSeconds ?? Math.floor(((ticket.closedAt ?? new Date()).getTime() - ticket.createdAt.getTime()) / 1000);
    embed.addFields({ name: t('tickets.info.duration'), value: formatDuration(duration, lang), inline: true });
    if (ticket.transcript) embed.addFields({ name: t('tickets.info.messages'), value: String(ticket.transcript.messageCount), inline: true });
    const participants = asStringArray(ticket.participants);
    if (participants.length) embed.addFields({ name: t('tickets.info.participants'), value: participants.map((p) => `<@${p}>`).join(' ').slice(0, 1024) });
    if (ticket.closeReason) embed.addFields({ name: t('tickets.open.field_reason'), value: ticket.closeReason.slice(0, 1024) });
    const answers = asFormAnswers(ticket.formAnswers);
    if (answers.length) embed.addFields({ name: t('tickets.info.answers'), value: answers.map((a) => `**${a.question}** — ${a.answer || '—'}`).join('\n').slice(0, 1024) });
    return embed;
  }
}

export const ticketService = new TicketService();
