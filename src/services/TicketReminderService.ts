import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Message, type TextChannel } from 'discord.js';
import { TicketStatus, type TicketSettings } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { guildConfigService } from './GuildConfigService';
import { scheduler } from './SchedulerService';
import { translationService } from './TranslationService';
import { asStringArray, ticketService } from './TicketService';
import { buildCustomId } from '../utils/customId';
import { TTLCache } from '../utils/cache';
import { discordTimestamp, formatDuration } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('TicketReminders');

export const REMINDER_PING_MODES = ['claimer', 'staff', 'none'] as const;
export type ReminderPingMode = (typeof REMINDER_PING_MODES)[number];

export const ticketSettingsSchema = z.object({
  remindersEnabled: z.boolean().optional(),
  reminderHours: z.number().int().min(1).max(168).optional(),
  reminderPing: z.enum(REMINDER_PING_MODES).optional(),
});
export type TicketSettingsPatch = z.infer<typeof ticketSettingsSchema>;

export const DEFAULT_TICKET_SETTINGS = { remindersEnabled: true, reminderHours: 24, reminderPing: 'claimer' as ReminderPingMode };

export interface ReminderState {
  createdAt: Date;
  lastStaffReplyAt: Date | null;
  lastMemberMessageAt: Date | null;
  lastReminderAt: Date | null;
  remindersMuted: boolean;
}

/**
 * Décision pure : faut-il relancer le staff ?
 *  - jamais si le ticket est « permanent » (relances coupées) ;
 *  - jamais si le staff a parlé en dernier (le ticket attend le membre) ;
 *  - sinon, si aucune réponse du staff ni relance depuis `hours` heures (référence = création, dernière réponse staff ou dernière relance).
 */
export function isReminderDue(state: ReminderState, now: Date, hours: number): boolean {
  if (state.remindersMuted) return false;
  const staffSpokeLast = !!state.lastStaffReplyAt && (!state.lastMemberMessageAt || state.lastStaffReplyAt >= state.lastMemberMessageAt);
  if (staffSpokeLast) return false;
  const reference = Math.max(state.createdAt.getTime(), state.lastStaffReplyAt?.getTime() ?? 0, state.lastReminderAt?.getTime() ?? 0);
  return now.getTime() - reference >= hours * 3_600_000;
}

/** Depuis quand le ticket attend une réponse du staff (pour l'affichage). */
export function waitingSince(state: ReminderState): Date {
  const afterStaff = state.lastStaffReplyAt && state.lastMemberMessageAt && state.lastMemberMessageAt > state.lastStaffReplyAt ? state.lastMemberMessageAt : null;
  return afterStaff ?? (state.lastStaffReplyAt && !state.lastMemberMessageAt ? state.lastStaffReplyAt : state.createdAt);
}

interface TicketMeta {
  userId: string;
  participants: string[];
  typeStaffRoleIds: string[];
}

/**
 * Relances automatiques des tickets sans réponse du staff.
 * - Suit l'activité (dernier message staff / membre) en mémoire, écrite en base toutes les 30 s.
 * - Toutes les 10 min, relance les tickets dus : mention du staff (ou du claimer) + boutons « Je m'en occupe » / « Ne plus relancer ».
 * - Un ticket peut être marqué « permanent » (relances coupées) depuis ses boutons.
 */
export class TicketReminderService {
  private client: Client | null = null;
  private readonly pending = new Map<number, { staffAt?: Date; memberAt?: Date }>();
  private readonly meta = new TTLCache<TicketMeta>(5 * 60_000, 5000);
  private readonly settings = new TTLCache<TicketSettings>(5 * 60_000, 2000);
  private tasksRegistered = false;

  attach(client: Client): void {
    this.client = client;
    if (this.tasksRegistered) return;
    this.tasksRegistered = true;
    scheduler.register({ name: 'tickets:activity-flush', intervalMs: 30_000, run: () => this.flushActivity() });
    scheduler.register({ name: 'tickets:reminders', intervalMs: 10 * 60_000, run: async () => { await this.tick(); } });
  }

  // ───── Réglages ─────

  async getSettings(guildId: string): Promise<TicketSettings> {
    const cached = this.settings.get(guildId);
    if (cached) return cached;
    const row = (await prisma.ticketSettings.findUnique({ where: { guildId } })) ?? { guildId, ...DEFAULT_TICKET_SETTINGS, updatedAt: new Date(0) };
    this.settings.set(guildId, row);
    return row;
  }

  async updateSettings(guildId: string, patch: TicketSettingsPatch): Promise<TicketSettings> {
    const data = ticketSettingsSchema.parse(patch);
    const row = await prisma.ticketSettings.upsert({ where: { guildId }, create: { guildId, ...DEFAULT_TICKET_SETTINGS, ...data }, update: data });
    this.settings.set(guildId, row);
    return row;
  }

  // ───── Suivi de l'activité ─────

  /** Appelé pour chaque message posté dans un salon de ticket ouvert (aucune requête SQL hors cache). */
  async trackMessage(message: Message<true>): Promise<void> {
    if (message.author.bot || message.system) return;
    const ticketId = ticketService.getTicketIdByChannel(message.channelId);
    if (!ticketId) return;
    const meta = await this.loadMeta(ticketId);
    if (!meta) return;
    let isStaff = false;
    if (message.author.id !== meta.userId) {
      const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
      const config = await guildConfigService.get(message.guildId);
      isStaff = ticketService.isStaff(member, config, null) || (!!member && meta.typeStaffRoleIds.some((r) => member.roles.cache.has(r)));
    }
    const entry = this.pending.get(ticketId) ?? {};
    if (isStaff) entry.staffAt = message.createdAt;
    else entry.memberAt = message.createdAt;
    this.pending.set(ticketId, entry);
  }

  private async loadMeta(ticketId: number): Promise<TicketMeta | null> {
    const key = String(ticketId);
    const cached = this.meta.get(key);
    if (cached) return cached;
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { type: true } });
    if (!ticket) return null;
    const meta: TicketMeta = { userId: ticket.userId, participants: asStringArray(ticket.participants), typeStaffRoleIds: asStringArray(ticket.type?.staffRoleIds) };
    this.meta.set(key, meta);
    return meta;
  }

  async flushActivity(): Promise<void> {
    if (!this.pending.size) return;
    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, a] of batch) {
      const data: { lastStaffReplyAt?: Date; lastMemberMessageAt?: Date } = {};
      if (a.staffAt) data.lastStaffReplyAt = a.staffAt;
      if (a.memberAt) data.lastMemberMessageAt = a.memberAt;
      await prisma.ticket.update({ where: { id }, data }).catch((err) => log.warn({ err, ticketId: id }, 'Activité du ticket non enregistrée'));
    }
  }

  // ───── Relances ─────

  async setMuted(ticketId: number, muted: boolean): Promise<void> {
    await prisma.ticket.update({ where: { id: ticketId }, data: { remindersMuted: muted, ...(muted ? {} : { lastReminderAt: new Date() }) } });
  }

  async tick(now = new Date()): Promise<number> {
    if (!this.client) return 0;
    await this.flushActivity();
    const tickets = await prisma.ticket.findMany({
      where: { status: { in: [TicketStatus.OPEN, TicketStatus.CLAIMED] }, remindersMuted: false },
      include: { type: true },
      take: 500,
    });
    let sent = 0;
    for (const ticket of tickets) {
      try {
        const settings = await this.getSettings(ticket.guildId);
        if (!settings.remindersEnabled) continue;
        const config = await guildConfigService.get(ticket.guildId);
        if (config && !config.modules.tickets) continue;
        if (!isReminderDue(ticket, now, settings.reminderHours)) continue;
        const channel = (await this.client.channels.fetch(ticket.channelId).catch(() => null)) as TextChannel | null;
        if (!channel || !channel.isTextBased() || !('send' in channel)) continue;
        const lang = ticket.language ?? config?.defaultLanguage ?? 'fr';
        const t = translationService.bind(lang, ticket.guildId);
        const roles = asStringArray(ticket.type?.staffRoleIds).length ? asStringArray(ticket.type?.staffRoleIds) : (config?.staffRoleIds ?? []);
        const mode = settings.reminderPing as ReminderPingMode;
        const pingUsers = mode === 'claimer' && ticket.claimedById ? [ticket.claimedById] : [];
        const pingRoles = mode === 'none' || pingUsers.length ? [] : roles;
        const since = waitingSince(ticket);
        const waitedSeconds = Math.floor((now.getTime() - since.getTime()) / 1000);
        const embed = new EmbedBuilder()
          .setColor(BRAND.colors.warning)
          .setTitle(t('ticket_reminders.title'))
          .setDescription(t('ticket_reminders.description', { duration: formatDuration(waitedSeconds, lang), since: discordTimestamp(since, 'R'), hours: settings.reminderHours }))
          .setFooter({ text: t('ticket_reminders.footer', { hours: settings.reminderHours }) });
        const row = new ActionRowBuilder<ButtonBuilder>();
        if (!ticket.claimedById) row.addComponents(new ButtonBuilder().setCustomId(buildCustomId('ticket', 'claim', ticket.id)).setLabel(t('ticket_reminders.btn_claim')).setEmoji('🙋').setStyle(ButtonStyle.Primary));
        row.addComponents(new ButtonBuilder().setCustomId(buildCustomId('ticket', 'mute', ticket.id)).setLabel(t('ticket_reminders.btn_mute')).setEmoji('🔕').setStyle(ButtonStyle.Secondary));
        const mentions = [...pingUsers.map((u) => `<@${u}>`), ...pingRoles.map((r) => `<@&${r}>`)].join(' ');
        await channel.send({ content: mentions || undefined, embeds: [embed], components: [row], allowedMentions: { users: pingUsers, roles: pingRoles } });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { lastReminderAt: now } });
        sent++;
      } catch (err) {
        log.warn({ err, ticketId: ticket.id }, 'Relance de ticket impossible');
      }
    }
    if (sent) log.info({ sent }, 'Relances de tickets envoyées');
    return sent;
  }
}

export const ticketReminderService = new TicketReminderService();
