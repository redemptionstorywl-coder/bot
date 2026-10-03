import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type ColorResolvable } from 'discord.js';
import { LogCategory, Prisma, ReviewStatus, type Whitelist, type WhitelistConfig } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { loggingService } from './LoggingService';
import { translationService } from './TranslationService';
import { guildConfigService } from './GuildConfigService';
import { fivemService } from './FiveMService';
import { TTLCache } from '../utils/cache';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('WhitelistService');

export const MAX_QUESTIONS = 5;

export const whitelistQuestionSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(45),
  placeholder: z.string().max(100).optional(),
  required: z.boolean().default(true),
  style: z.enum(['short', 'paragraph']).default('paragraph'),
});
export type WhitelistQuestion = z.infer<typeof whitelistQuestionSchema>;
export const whitelistQuestionsSchema = z.array(whitelistQuestionSchema).max(MAX_QUESTIONS);

export const whitelistAnswerSchema = z.object({ question: z.string().max(100), answer: z.string().max(1024) });
export type WhitelistAnswer = z.infer<typeof whitelistAnswerSchema>;

export interface WhitelistSettings {
  guildId: string;
  questions: WhitelistQuestion[];
  reviewChannelId: string | null;
  acceptedRoleId: string | null;
  pendingRoleId: string | null;
  dmOnDecision: boolean;
  enabled: boolean;
}

export type WhitelistErrorCode = 'disabled' | 'already_pending' | 'already_accepted' | 'not_found' | 'already_reviewed' | 'no_questions';

export class WhitelistError extends Error {
  constructor(readonly code: WhitelistErrorCode) {
    super(code);
    this.name = 'WhitelistError';
  }
}

/** Questions par défaut (clés de traduction résolues à l'affichage). */
export const DEFAULT_QUESTION_IDS = ['identity', 'experience', 'motivation'] as const;

export function parseQuestions(raw: unknown): WhitelistQuestion[] {
  const r = whitelistQuestionsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

export function parseAnswers(raw: unknown): WhitelistAnswer[] {
  const r = z.array(whitelistAnswerSchema).safeParse(raw);
  return r.success ? r.data : [];
}

/** Transition d'état d'un dossier (fonction pure) : seul PENDING peut être tranché. */
export function canReview(status: ReviewStatus): boolean {
  return status === ReviewStatus.PENDING;
}

export class WhitelistService {
  private client: Client | null = null;
  private readonly configCache = new TTLCache<WhitelistSettings>(5 * 60_000, 1000);

  attach(client: Client): void {
    this.client = client;
  }

  // ───── Configuration ─────

  async getConfig(guildId: string): Promise<WhitelistSettings> {
    return this.configCache.getOrSet(guildId, async () => {
      const row = await prisma.whitelistConfig.findUnique({ where: { guildId } });
      return this.toSettings(guildId, row);
    });
  }

  private toSettings(guildId: string, row: WhitelistConfig | null): WhitelistSettings {
    return {
      guildId,
      questions: parseQuestions(row?.questions ?? []),
      reviewChannelId: row?.reviewChannelId ?? null,
      acceptedRoleId: row?.acceptedRoleId ?? null,
      pendingRoleId: row?.pendingRoleId ?? null,
      dmOnDecision: row?.dmOnDecision ?? true,
      enabled: row?.enabled ?? true,
    };
  }

  async updateConfig(guildId: string, patch: Partial<Omit<WhitelistSettings, 'guildId'>>): Promise<WhitelistSettings> {
    const data: Prisma.WhitelistConfigUncheckedCreateInput = { guildId };
    if (patch.questions !== undefined) data.questions = whitelistQuestionsSchema.parse(patch.questions) as Prisma.InputJsonValue;
    if (patch.reviewChannelId !== undefined) data.reviewChannelId = patch.reviewChannelId;
    if (patch.acceptedRoleId !== undefined) data.acceptedRoleId = patch.acceptedRoleId;
    if (patch.pendingRoleId !== undefined) data.pendingRoleId = patch.pendingRoleId;
    if (patch.dmOnDecision !== undefined) data.dmOnDecision = patch.dmOnDecision;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    const { guildId: _g, ...update } = data;
    const row = await prisma.whitelistConfig.upsert({ where: { guildId }, create: data, update });
    this.configCache.delete(guildId);
    return this.toSettings(guildId, row);
  }

  /** Questions effectives : configurées, sinon les questions par défaut traduites. */
  resolveQuestions(settings: WhitelistSettings, lang: string): WhitelistQuestion[] {
    if (settings.questions.length) return settings.questions;
    const t = translationService.bind(lang, settings.guildId);
    return DEFAULT_QUESTION_IDS.map((id) => ({ id, label: t(`whitelist.default_questions.${id}`).slice(0, 45), required: true, style: id === 'identity' ? 'short' : 'paragraph' }));
  }

  // ───── Dossiers ─────

  async getLatest(guildId: string, userId: string): Promise<Whitelist | null> {
    return prisma.whitelist.findFirst({ where: { guildId, userId }, orderBy: { createdAt: 'desc' } });
  }

  async getById(guildId: string, id: number): Promise<Whitelist | null> {
    const row = await prisma.whitelist.findUnique({ where: { id } });
    return row && row.guildId === guildId ? row : null;
  }

  /** Crée un dossier PENDING. Un seul dossier PENDING par utilisateur ; un dossier ACCEPTED bloque aussi. */
  async apply(input: { guildId: string; userId: string; answers: WhitelistAnswer[]; identifier?: string | null }): Promise<Whitelist> {
    const settings = await this.getConfig(input.guildId);
    if (!settings.enabled) throw new WhitelistError('disabled');
    const existing = await prisma.whitelist.findFirst({ where: { guildId: input.guildId, userId: input.userId, status: { in: [ReviewStatus.PENDING, ReviewStatus.ACCEPTED] } } });
    if (existing?.status === ReviewStatus.PENDING) throw new WhitelistError('already_pending');
    if (existing?.status === ReviewStatus.ACCEPTED) throw new WhitelistError('already_accepted');
    const row = await prisma.whitelist.create({
      data: { guildId: input.guildId, userId: input.userId, identifier: input.identifier ?? null, answers: input.answers as Prisma.InputJsonValue, status: ReviewStatus.PENDING },
    });
    await this.setRole(input.guildId, input.userId, settings.pendingRoleId, true);
    await this.postReview(row, settings).catch((err) => log.warn({ err, id: row.id }, 'Impossible de poster la review'));
    await loggingService.log({
      guildId: input.guildId,
      category: LogCategory.WHITELIST,
      action: 'whitelist.apply',
      title: `📝 Nouvelle candidature #${row.id}`,
      description: `<@${input.userId}>`,
      actorId: input.userId,
      targetId: input.userId,
      data: { id: row.id, answers: input.answers },
    });
    return row;
  }

  /** Tranche un dossier. Effets : rôles, DM, log, socket FiveM. */
  async review(input: { guildId: string; id: number; reviewerId: string; decision: 'ACCEPTED' | 'REJECTED'; note?: string | null }): Promise<Whitelist> {
    const row = await this.getById(input.guildId, input.id);
    if (!row) throw new WhitelistError('not_found');
    if (!canReview(row.status)) throw new WhitelistError('already_reviewed');
    const updated = await prisma.whitelist.update({
      where: { id: row.id },
      data: { status: input.decision, reviewedById: input.reviewerId, reviewedAt: new Date(), note: input.note?.trim() || null },
    });
    await this.applyDecisionEffects(updated).catch((err) => log.warn({ err, id: row.id }, 'Effets de décision partiels'));
    return updated;
  }

  private async applyDecisionEffects(row: Whitelist): Promise<void> {
    const settings = await this.getConfig(row.guildId);
    await this.setRole(row.guildId, row.userId, settings.pendingRoleId, false);
    if (row.status === ReviewStatus.ACCEPTED) await this.setRole(row.guildId, row.userId, settings.acceptedRoleId, true);
    if (settings.dmOnDecision) await this.sendDecisionDm(row).catch(() => null);
    await fivemService.emitToGuild(row.guildId, 'whitelist:updated', { discordId: row.userId, identifier: row.identifier, status: row.status });
    const accepted = row.status === ReviewStatus.ACCEPTED;
    await loggingService.log({
      guildId: row.guildId,
      category: LogCategory.WHITELIST,
      action: accepted ? 'whitelist.accept' : 'whitelist.reject',
      title: `${accepted ? '✅' : '⛔'} Candidature #${row.id} ${accepted ? 'acceptée' : 'refusée'}`,
      description: `<@${row.userId}>${row.note ? `\n> ${row.note}` : ''}`,
      color: accepted ? BRAND.colors.primary : BRAND.colors.danger,
      actorId: row.reviewedById,
      targetId: row.userId,
      data: { id: row.id, status: row.status, note: row.note },
    });
  }

  async setIdentifier(guildId: string, userId: string, identifier: string): Promise<void> {
    await prisma.whitelist.updateMany({ where: { guildId, userId }, data: { identifier } });
  }

  async list(guildId: string, status?: ReviewStatus, take = 100): Promise<Whitelist[]> {
    return prisma.whitelist.findMany({ where: { guildId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take });
  }

  async counts(guildId: string): Promise<Record<ReviewStatus, number>> {
    const rows = await prisma.whitelist.groupBy({ by: ['status'], where: { guildId }, _count: { _all: true } });
    const out: Record<ReviewStatus, number> = { PENDING: 0, ACCEPTED: 0, REJECTED: 0 };
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  }

  // ───── API FiveM ─────

  /** Vérifie si un identifiant FiveM (ou un Discord ID) est whitelisté. */
  async check(guildId: string, identifier: string): Promise<{ whitelisted: boolean; status: ReviewStatus | null; discordId: string | null }> {
    const isDiscord = /^\d{15,22}$/.test(identifier) || identifier.startsWith('discord:');
    const discordId = identifier.replace(/^discord:/, '');
    const row = await prisma.whitelist.findFirst({
      where: isDiscord ? { guildId, userId: discordId } : { guildId, identifier },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    if (!row) return { whitelisted: false, status: null, discordId: null };
    return { whitelisted: row.status === ReviewStatus.ACCEPTED, status: row.status, discordId: row.userId };
  }

  async listAccepted(guildId: string): Promise<{ discordId: string; identifier: string | null; acceptedAt: Date | null }[]> {
    const rows = await prisma.whitelist.findMany({ where: { guildId, status: ReviewStatus.ACCEPTED }, select: { userId: true, identifier: true, reviewedAt: true } });
    return rows.map((r) => ({ discordId: r.userId, identifier: r.identifier, acceptedAt: r.reviewedAt }));
  }

  // ───── Discord ─────

  buildReviewEmbed(row: Whitelist, lang: string): EmbedBuilder {
    const t = translationService.bind(lang, row.guildId);
    const answers = parseAnswers(row.answers);
    const statusKey = row.status.toLowerCase();
    const color: number = row.status === ReviewStatus.REJECTED ? BRAND.colors.danger : row.status === ReviewStatus.ACCEPTED ? BRAND.colors.primary : BRAND.colors.anthracite;
    const embed = new EmbedBuilder()
      .setColor(color as ColorResolvable)
      .setTitle(t('whitelist.review.title', { id: row.id }))
      .setDescription(`${t('whitelist.review.applicant')} : <@${row.userId}> (\`${row.userId}\`)\n${t('whitelist.review.status')} : **${t(`whitelist.status.${statusKey}`)}**\n${t('whitelist.review.submitted')} : ${discordTimestamp(row.createdAt, 'R')}`)
      .setFooter({ text: `${BRAND.footer} • #${row.id}` });
    if (row.identifier) embed.addFields({ name: t('whitelist.review.identifier'), value: `\`${row.identifier}\``, inline: false });
    for (const a of answers.slice(0, 20)) embed.addFields({ name: a.question.slice(0, 256), value: (a.answer || '—').slice(0, 1024) });
    if (row.reviewedById) embed.addFields({ name: t('whitelist.review.reviewed_by'), value: `<@${row.reviewedById}>${row.note ? `\n> ${row.note.slice(0, 900)}` : ''}` });
    return embed;
  }

  buildReviewButtons(row: Whitelist, lang: string, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
    const t = translationService.bind(lang, row.guildId);
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId('whitelist', 'accept', row.id)).setLabel(t('whitelist.review.accept')).setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(buildCustomId('whitelist', 'reject', row.id)).setLabel(t('whitelist.review.reject')).setEmoji('⛔').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      ),
    ];
  }

  private async postReview(row: Whitelist, settings: WhitelistSettings): Promise<void> {
    if (!this.client || !settings.reviewChannelId) return;
    const channel = await this.client.channels.fetch(settings.reviewChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return;
    const cfg = await guildConfigService.get(row.guildId);
    const lang = cfg?.defaultLanguage ?? 'fr';
    await channel.send({ embeds: [this.buildReviewEmbed(row, lang)], components: this.buildReviewButtons(row, lang) });
  }

  private async sendDecisionDm(row: Whitelist): Promise<void> {
    if (!this.client) return;
    const lang = await translationService.resolveLanguage({ guildId: row.guildId, userId: row.userId, guildDefault: (await guildConfigService.get(row.guildId))?.defaultLanguage });
    const t = translationService.bind(lang, row.guildId);
    const guild = this.client.guilds.cache.get(row.guildId);
    const accepted = row.status === ReviewStatus.ACCEPTED;
    const embed = new EmbedBuilder()
      .setColor((accepted ? BRAND.colors.primary : BRAND.colors.danger) as ColorResolvable)
      .setTitle(accepted ? t('whitelist.dm.accepted_title') : t('whitelist.dm.rejected_title'))
      .setDescription(t(accepted ? 'whitelist.dm.accepted' : 'whitelist.dm.rejected', { server: guild?.name ?? '' }) + (row.note ? `\n\n> ${row.note.slice(0, 1500)}` : ''))
      .setFooter({ text: BRAND.footer });
    const user = await this.client.users.fetch(row.userId).catch(() => null);
    await user?.send({ embeds: [embed] });
  }

  private async setRole(guildId: string, userId: string, roleId: string | null, add: boolean): Promise<void> {
    if (!this.client || !roleId) return;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    try {
      if (add) await member.roles.add(roleId, 'Whitelist');
      else if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Whitelist');
    } catch (err) {
      log.warn({ err, guildId, roleId }, 'Rôle whitelist non appliqué');
    }
  }
}

export const whitelistService = new WhitelistService();
