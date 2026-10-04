import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type ColorResolvable } from 'discord.js';
import { LogCategory, Prisma, ReviewStatus, SchoolRole, type SchoolApplication, type SchoolClass, type SchoolClub, type SchoolClubMember, type SchoolConfig, type SchoolHouse, type SchoolProfile } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { loggingService } from './LoggingService';
import { translationService } from './TranslationService';
import { CHANNELS_REMAPPED_EVENT, guildConfigService } from './GuildConfigService';
import { TTLCache } from '../utils/cache';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('SchoolService');

export type SchoolErrorCode =
  | 'profile_exists'
  | 'profile_not_found'
  | 'class_not_found'
  | 'class_full'
  | 'house_not_found'
  | 'club_not_found'
  | 'club_full'
  | 'already_member'
  | 'not_member'
  | 'application_not_found'
  | 'application_pending'
  | 'already_reviewed'
  | 'name_taken';

export class SchoolError extends Error {
  constructor(readonly code: SchoolErrorCode) {
    super(code);
    this.name = 'SchoolError';
  }
}

export const schoolAnswerSchema = z.object({ question: z.string().max(100), answer: z.string().max(1024) });
export type SchoolAnswer = z.infer<typeof schoolAnswerSchema>;
export function parseAnswers(raw: unknown): SchoolAnswer[] {
  const r = z.array(schoolAnswerSchema).safeParse(raw);
  return r.success ? r.data : [];
}

export interface SchoolSettings {
  guildId: string;
  applicationChannelId: string | null;
  announceChannelId: string | null;
  roles: Record<SchoolRole, string | null>;
}

export type ProfileFull = SchoolProfile & { class: SchoolClass | null; house: SchoolHouse | null; clubs: (SchoolClubMember & { club: SchoolClub })[] };
export type ClassWithCount = SchoolClass & { _count: { students: number } };
export type HouseWithCount = SchoolHouse & { _count: { members: number } };
export type ClubWithCount = SchoolClub & { _count: { members: number } };

/** Classement des maisons (fonction pure) : points desc puis nom. */
export function sortHouses<T extends { points: number; name: string }>(houses: T[]): T[] {
  return [...houses].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

/** Capacité : `null` = illimitée. */
export function hasCapacity(max: number | null, current: number): boolean {
  return max === null || current < max;
}

export class SchoolService {
  private client: Client | null = null;
  private readonly configCache = new TTLCache<SchoolSettings>(5 * 60_000, 1000);

  attach(client: Client): void {
    if (!this.client) guildConfigService.on(CHANNELS_REMAPPED_EVENT, (guildId: string) => this.configCache.delete(guildId));
    this.client = client;
  }

  // ───── Configuration ─────

  async getConfig(guildId: string): Promise<SchoolSettings> {
    return this.configCache.getOrSet(guildId, async () => this.toSettings(guildId, await prisma.schoolConfig.findUnique({ where: { guildId } })));
  }

  private toSettings(guildId: string, row: SchoolConfig | null): SchoolSettings {
    return {
      guildId,
      applicationChannelId: row?.applicationChannelId ?? null,
      announceChannelId: row?.announceChannelId ?? null,
      roles: { STUDENT: row?.studentRoleId ?? null, TEACHER: row?.teacherRoleId ?? null, STAFF: row?.staffRoleId ?? null },
    };
  }

  async updateConfig(guildId: string, patch: Partial<{ applicationChannelId: string | null; announceChannelId: string | null; studentRoleId: string | null; teacherRoleId: string | null; staffRoleId: string | null }>): Promise<SchoolSettings> {
    const row = await prisma.schoolConfig.upsert({ where: { guildId }, create: { guildId, ...patch }, update: patch });
    this.configCache.delete(guildId);
    return this.toSettings(guildId, row);
  }

  // ───── Profils ─────

  getProfile(guildId: string, userId: string): Promise<ProfileFull | null> {
    return prisma.schoolProfile.findUnique({ where: { guildId_userId: { guildId, userId } }, include: { class: true, house: true, clubs: { include: { club: true } } } });
  }

  async requireProfile(guildId: string, userId: string): Promise<ProfileFull> {
    const p = await this.getProfile(guildId, userId);
    if (!p) throw new SchoolError('profile_not_found');
    return p;
  }

  async register(input: { guildId: string; userId: string; firstName: string; lastName: string; role?: SchoolRole; classId?: number | null; houseId?: number | null; bio?: string | null }): Promise<ProfileFull> {
    const existing = await prisma.schoolProfile.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    if (existing) throw new SchoolError('profile_exists');
    if (input.classId) await this.requireClass(input.guildId, input.classId);
    if (input.houseId) await this.requireHouse(input.guildId, input.houseId);
    const profile = await prisma.schoolProfile.create({
      data: { guildId: input.guildId, userId: input.userId, firstName: input.firstName.trim().slice(0, 50), lastName: input.lastName.trim().slice(0, 50), role: input.role ?? SchoolRole.STUDENT, classId: input.classId ?? null, houseId: input.houseId ?? null, bio: input.bio?.trim().slice(0, 500) || null },
      include: { class: true, house: true, clubs: { include: { club: true } } },
    });
    const settings = await this.getConfig(input.guildId);
    await this.setRole(input.guildId, input.userId, settings.roles[profile.role], true);
    if (profile.class?.roleId) await this.setRole(input.guildId, input.userId, profile.class.roleId, true);
    if (profile.house?.roleId) await this.setRole(input.guildId, input.userId, profile.house.roleId, true);
    await loggingService.log({ guildId: input.guildId, category: LogCategory.SCHOOL, action: 'school.register', title: `🎓 Inscription : ${profile.firstName} ${profile.lastName}`, description: `<@${input.userId}>`, actorId: input.userId, targetId: input.userId, data: { profileId: profile.id, role: profile.role } });
    return profile;
  }

  async updateProfile(guildId: string, userId: string, patch: Partial<Pick<SchoolProfile, 'firstName' | 'lastName' | 'role' | 'bio' | 'points'>>): Promise<SchoolProfile> {
    const profile = await this.requireProfile(guildId, userId);
    return prisma.schoolProfile.update({ where: { id: profile.id }, data: patch });
  }

  // ───── Classes ─────

  listClasses(guildId: string): Promise<ClassWithCount[]> {
    return prisma.schoolClass.findMany({ where: { guildId }, orderBy: { name: 'asc' }, include: { _count: { select: { students: true } } } });
  }

  async requireClass(guildId: string, id: number): Promise<ClassWithCount> {
    const c = await prisma.schoolClass.findFirst({ where: { id, guildId }, include: { _count: { select: { students: true } } } });
    if (!c) throw new SchoolError('class_not_found');
    return c;
  }

  async findClassByName(guildId: string, name: string): Promise<SchoolClass | null> {
    return prisma.schoolClass.findFirst({ where: { guildId, name: { equals: name.trim() } } });
  }

  async createClass(guildId: string, input: { name: string; teacherId?: string | null; roleId?: string | null; channelId?: string | null; capacity?: number | null }, actorId?: string): Promise<SchoolClass> {
    if (await this.findClassByName(guildId, input.name)) throw new SchoolError('name_taken');
    const c = await prisma.schoolClass.create({ data: { guildId, name: input.name.trim().slice(0, 60), teacherId: input.teacherId ?? null, roleId: input.roleId ?? null, channelId: input.channelId ?? null, capacity: input.capacity ?? null } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.class.create', title: `🎓 Classe créée : ${c.name}`, actorId: actorId ?? null, data: { classId: c.id } });
    return c;
  }

  async deleteClass(guildId: string, id: number, actorId?: string): Promise<SchoolClass> {
    const c = await this.requireClass(guildId, id);
    await prisma.schoolClass.delete({ where: { id } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.class.delete', title: `🎓 Classe supprimée : ${c.name}`, actorId: actorId ?? null, data: { classId: id } });
    return c;
  }

  async updateClass(guildId: string, id: number, patch: Partial<{ name: string; teacherId: string | null; roleId: string | null; channelId: string | null; capacity: number | null }>, actorId?: string): Promise<SchoolClass> {
    const c = await this.requireClass(guildId, id);
    if (patch.name !== undefined && patch.name.trim() !== c.name) {
      const taken = await this.findClassByName(guildId, patch.name);
      if (taken && taken.id !== id) throw new SchoolError('name_taken');
    }
    const updated = await prisma.schoolClass.update({ where: { id }, data: { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 60) } : {}) } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.class.update', title: `🎓 Classe modifiée : ${updated.name}`, actorId: actorId ?? null, data: { classId: id, patch }, skipDatabase: true });
    return updated;
  }

  /** Assigne un élève à une classe (retire le rôle de l'ancienne classe, donne le nouveau). */
  async assignClass(guildId: string, userId: string, classId: number | null, actorId?: string): Promise<ProfileFull> {
    const profile = await this.requireProfile(guildId, userId);
    const target = classId ? await this.requireClass(guildId, classId) : null;
    if (target && !hasCapacity(target.capacity, target._count.students) && profile.classId !== target.id) throw new SchoolError('class_full');
    await prisma.schoolProfile.update({ where: { id: profile.id }, data: { classId: target?.id ?? null } });
    if (profile.class?.roleId && profile.class.id !== target?.id) await this.setRole(guildId, userId, profile.class.roleId, false);
    if (target?.roleId) await this.setRole(guildId, userId, target.roleId, true);
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.class.assign', title: `🎓 ${profile.firstName} ${profile.lastName} → ${target?.name ?? '—'}`, description: `<@${userId}>`, actorId: actorId ?? null, targetId: userId, data: { classId } });
    return this.requireProfile(guildId, userId);
  }

  // ───── Maisons ─────

  listHouses(guildId: string): Promise<HouseWithCount[]> {
    return prisma.schoolHouse.findMany({ where: { guildId }, orderBy: [{ points: 'desc' }, { name: 'asc' }], include: { _count: { select: { members: true } } } });
  }

  async requireHouse(guildId: string, id: number): Promise<SchoolHouse> {
    const h = await prisma.schoolHouse.findFirst({ where: { id, guildId } });
    if (!h) throw new SchoolError('house_not_found');
    return h;
  }

  async findHouseByName(guildId: string, name: string): Promise<SchoolHouse | null> {
    return prisma.schoolHouse.findFirst({ where: { guildId, name: { equals: name.trim() } } });
  }

  async createHouse(guildId: string, input: { name: string; emoji?: string | null; color?: string | null; roleId?: string | null }, actorId?: string): Promise<SchoolHouse> {
    if (await this.findHouseByName(guildId, input.name)) throw new SchoolError('name_taken');
    const h = await prisma.schoolHouse.create({ data: { guildId, name: input.name.trim().slice(0, 60), emoji: input.emoji ?? null, color: input.color ?? null, roleId: input.roleId ?? null } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.house.create', title: `🎓 Maison créée : ${h.name}`, actorId: actorId ?? null, data: { houseId: h.id } });
    return h;
  }

  async deleteHouse(guildId: string, id: number, actorId?: string): Promise<SchoolHouse> {
    const h = await this.requireHouse(guildId, id);
    await prisma.schoolHouse.delete({ where: { id } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.house.delete', title: `🎓 Maison supprimée : ${h.name}`, actorId: actorId ?? null, data: { houseId: id } });
    return h;
  }

  async updateHouse(guildId: string, id: number, patch: Partial<{ name: string; emoji: string | null; color: string | null; roleId: string | null }>, actorId?: string): Promise<SchoolHouse> {
    const h = await this.requireHouse(guildId, id);
    if (patch.name !== undefined && patch.name.trim() !== h.name) {
      const taken = await this.findHouseByName(guildId, patch.name);
      if (taken && taken.id !== id) throw new SchoolError('name_taken');
    }
    const updated = await prisma.schoolHouse.update({ where: { id }, data: { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 60) } : {}) } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.house.update', title: `🎓 Maison modifiée : ${updated.name}`, actorId: actorId ?? null, data: { houseId: id, patch }, skipDatabase: true });
    return updated;
  }

  async assignHouse(guildId: string, userId: string, houseId: number | null, actorId?: string): Promise<ProfileFull> {
    const profile = await this.requireProfile(guildId, userId);
    const target = houseId ? await this.requireHouse(guildId, houseId) : null;
    await prisma.schoolProfile.update({ where: { id: profile.id }, data: { houseId: target?.id ?? null } });
    if (profile.house?.roleId && profile.house.id !== target?.id) await this.setRole(guildId, userId, profile.house.roleId, false);
    if (target?.roleId) await this.setRole(guildId, userId, target.roleId, true);
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.house.assign', title: `🎓 ${profile.firstName} ${profile.lastName} → ${target?.name ?? '—'}`, description: `<@${userId}>`, actorId: actorId ?? null, targetId: userId, data: { houseId } });
    return this.requireProfile(guildId, userId);
  }

  /** Ajoute (ou retire si négatif) des points à une maison. Si `userId` fourni, crédite aussi le profil. */
  async addHousePoints(guildId: string, houseId: number, delta: number, actorId: string, reason?: string | null, userId?: string | null): Promise<SchoolHouse> {
    const house = await this.requireHouse(guildId, houseId);
    const points = Math.max(0, house.points + delta);
    const updated = await prisma.schoolHouse.update({ where: { id: house.id }, data: { points } });
    if (userId) await prisma.schoolProfile.updateMany({ where: { guildId, userId }, data: { points: { increment: delta } } });
    await loggingService.log({
      guildId,
      category: LogCategory.SCHOOL,
      action: delta >= 0 ? 'school.house.points.add' : 'school.house.points.remove',
      title: `🎓 ${house.emoji ?? ''} ${house.name} ${delta >= 0 ? '+' : ''}${delta} pts → ${points}`,
      description: reason ?? undefined,
      actorId,
      targetId: userId ?? null,
      data: { houseId, delta, points, reason },
    });
    return updated;
  }

  // ───── Clubs ─────

  listClubs(guildId: string): Promise<ClubWithCount[]> {
    return prisma.schoolClub.findMany({ where: { guildId }, orderBy: { name: 'asc' }, include: { _count: { select: { members: true } } } });
  }

  async requireClub(guildId: string, id: number): Promise<ClubWithCount> {
    const c = await prisma.schoolClub.findFirst({ where: { id, guildId }, include: { _count: { select: { members: true } } } });
    if (!c) throw new SchoolError('club_not_found');
    return c;
  }

  async findClubByName(guildId: string, name: string): Promise<SchoolClub | null> {
    return prisma.schoolClub.findFirst({ where: { guildId, name: { equals: name.trim() } } });
  }

  async createClub(guildId: string, input: { name: string; description?: string | null; leaderId?: string | null; roleId?: string | null; maxMembers?: number | null }, actorId?: string): Promise<SchoolClub> {
    if (await this.findClubByName(guildId, input.name)) throw new SchoolError('name_taken');
    const c = await prisma.schoolClub.create({ data: { guildId, name: input.name.trim().slice(0, 60), description: input.description ?? null, leaderId: input.leaderId ?? null, roleId: input.roleId ?? null, maxMembers: input.maxMembers ?? null } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.club.create', title: `🎓 Club créé : ${c.name}`, actorId: actorId ?? null, data: { clubId: c.id } });
    return c;
  }

  async deleteClub(guildId: string, id: number, actorId?: string): Promise<SchoolClub> {
    const c = await this.requireClub(guildId, id);
    await prisma.schoolClub.delete({ where: { id } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.club.delete', title: `🎓 Club supprimé : ${c.name}`, actorId: actorId ?? null, data: { clubId: id } });
    return c;
  }

  async updateClub(guildId: string, id: number, patch: Partial<{ name: string; description: string | null; leaderId: string | null; roleId: string | null; maxMembers: number | null }>, actorId?: string): Promise<SchoolClub> {
    const c = await this.requireClub(guildId, id);
    if (patch.name !== undefined && patch.name.trim() !== c.name) {
      const taken = await this.findClubByName(guildId, patch.name);
      if (taken && taken.id !== id) throw new SchoolError('name_taken');
    }
    const updated = await prisma.schoolClub.update({ where: { id }, data: { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 60) } : {}) } });
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.club.update', title: `🎓 Club modifié : ${updated.name}`, actorId: actorId ?? null, data: { clubId: id, patch }, skipDatabase: true });
    return updated;
  }

  async joinClub(guildId: string, userId: string, clubId: number): Promise<SchoolClub> {
    const profile = await this.requireProfile(guildId, userId);
    const club = await this.requireClub(guildId, clubId);
    if (profile.clubs.some((m) => m.clubId === club.id)) throw new SchoolError('already_member');
    if (!hasCapacity(club.maxMembers, club._count.members)) throw new SchoolError('club_full');
    await prisma.schoolClubMember.create({ data: { clubId: club.id, profileId: profile.id } });
    if (club.roleId) await this.setRole(guildId, userId, club.roleId, true);
    await loggingService.log({ guildId, category: LogCategory.SCHOOL, action: 'school.club.join', title: `🎓 ${profile.firstName} ${profile.lastName} rejoint ${club.name}`, actorId: userId, targetId: userId, data: { clubId }, skipDatabase: true });
    return club;
  }

  async leaveClub(guildId: string, userId: string, clubId: number): Promise<SchoolClub> {
    const profile = await this.requireProfile(guildId, userId);
    const club = await this.requireClub(guildId, clubId);
    if (!profile.clubs.some((m) => m.clubId === club.id)) throw new SchoolError('not_member');
    await prisma.schoolClubMember.delete({ where: { clubId_profileId: { clubId: club.id, profileId: profile.id } } });
    if (club.roleId) await this.setRole(guildId, userId, club.roleId, false);
    return club;
  }

  // ───── Candidatures ─────

  async apply(input: { guildId: string; userId: string; role: SchoolRole; answers: SchoolAnswer[] }): Promise<SchoolApplication> {
    const pending = await prisma.schoolApplication.findFirst({ where: { guildId: input.guildId, userId: input.userId, status: ReviewStatus.PENDING } });
    if (pending) throw new SchoolError('application_pending');
    const app = await prisma.schoolApplication.create({ data: { guildId: input.guildId, userId: input.userId, role: input.role, answers: input.answers as Prisma.InputJsonValue } });
    await this.postApplication(app).catch((err) => log.warn({ err, id: app.id }, 'Candidature non postée'));
    await loggingService.log({ guildId: input.guildId, category: LogCategory.SCHOOL, action: 'school.apply', title: `🎓 Candidature #${app.id} (${app.role})`, description: `<@${input.userId}>`, actorId: input.userId, targetId: input.userId, data: { applicationId: app.id, role: app.role } });
    return app;
  }

  async getApplication(guildId: string, id: number): Promise<SchoolApplication | null> {
    const a = await prisma.schoolApplication.findUnique({ where: { id } });
    return a && a.guildId === guildId ? a : null;
  }

  listApplications(guildId: string, status?: ReviewStatus, take = 100): Promise<SchoolApplication[]> {
    return prisma.schoolApplication.findMany({ where: { guildId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take });
  }

  /** Accepte / refuse une candidature. Acceptation → rôle Discord du SchoolRole + mise à jour du rôle du profil s'il existe. */
  async reviewApplication(input: { guildId: string; id: number; reviewerId: string; decision: 'ACCEPTED' | 'REJECTED'; note?: string | null }): Promise<SchoolApplication> {
    const app = await this.getApplication(input.guildId, input.id);
    if (!app) throw new SchoolError('application_not_found');
    if (app.status !== ReviewStatus.PENDING) throw new SchoolError('already_reviewed');
    const updated = await prisma.schoolApplication.update({ where: { id: app.id }, data: { status: input.decision, reviewedById: input.reviewerId, reviewedAt: new Date(), note: input.note?.trim() || null } });
    if (updated.status === ReviewStatus.ACCEPTED) {
      const settings = await this.getConfig(input.guildId);
      await this.setRole(input.guildId, app.userId, settings.roles[app.role], true);
      await prisma.schoolProfile.updateMany({ where: { guildId: input.guildId, userId: app.userId }, data: { role: app.role } });
    }
    await this.sendDecisionDm(updated).catch(() => null);
    const accepted = updated.status === ReviewStatus.ACCEPTED;
    await loggingService.log({
      guildId: input.guildId,
      category: LogCategory.SCHOOL,
      action: accepted ? 'school.application.accept' : 'school.application.reject',
      title: `${accepted ? '✅' : '⛔'} Candidature #${app.id} (${app.role}) ${accepted ? 'acceptée' : 'refusée'}`,
      description: `<@${app.userId}>${updated.note ? `\n> ${updated.note}` : ''}`,
      color: accepted ? BRAND.colors.primary : BRAND.colors.danger,
      actorId: input.reviewerId,
      targetId: app.userId,
      data: { applicationId: app.id, status: updated.status },
    });
    return updated;
  }

  buildApplicationEmbed(app: SchoolApplication, lang: string): EmbedBuilder {
    const t = translationService.bind(lang, app.guildId);
    const color: number = app.status === ReviewStatus.REJECTED ? BRAND.colors.danger : app.status === ReviewStatus.ACCEPTED ? BRAND.colors.primary : BRAND.colors.anthracite;
    const embed = new EmbedBuilder()
      .setColor(color as ColorResolvable)
      .setTitle(t('school.application.title', { id: app.id }))
      .setDescription(`${t('school.application.applicant')} : <@${app.userId}>\n${t('school.application.role')} : **${t(`school.roles.${app.role.toLowerCase()}`)}**\n${t('school.application.status')} : **${t(`school.status.${app.status.toLowerCase()}`)}**\n${t('school.application.submitted')} : ${discordTimestamp(app.createdAt, 'R')}`)
      .setFooter({ text: `${BRAND.footer} • #${app.id}` });
    for (const a of parseAnswers(app.answers).slice(0, 20)) embed.addFields({ name: a.question.slice(0, 256), value: (a.answer || '—').slice(0, 1024) });
    if (app.reviewedById) embed.addFields({ name: t('school.application.reviewed_by'), value: `<@${app.reviewedById}>${app.note ? `\n> ${app.note.slice(0, 900)}` : ''}` });
    return embed;
  }

  buildApplicationButtons(app: SchoolApplication, lang: string, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
    const t = translationService.bind(lang, app.guildId);
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId('school', 'accept', app.id)).setLabel(t('school.application.accept')).setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(buildCustomId('school', 'reject', app.id)).setLabel(t('school.application.reject')).setEmoji('⛔').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      ),
    ];
  }

  private async postApplication(app: SchoolApplication): Promise<void> {
    const settings = await this.getConfig(app.guildId);
    if (!this.client || !settings.applicationChannelId) return;
    const channel = await this.client.channels.fetch(settings.applicationChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return;
    const lang = (await guildConfigService.get(app.guildId))?.defaultLanguage ?? 'fr';
    await channel.send({ embeds: [this.buildApplicationEmbed(app, lang)], components: this.buildApplicationButtons(app, lang) });
  }

  private async sendDecisionDm(app: SchoolApplication): Promise<void> {
    if (!this.client) return;
    const lang = translationService.resolveLanguage((await guildConfigService.get(app.guildId))?.defaultLanguage);
    const t = translationService.bind(lang, app.guildId);
    const accepted = app.status === ReviewStatus.ACCEPTED;
    const guild = this.client.guilds.cache.get(app.guildId);
    const embed = new EmbedBuilder()
      .setColor((accepted ? BRAND.colors.primary : BRAND.colors.danger) as ColorResolvable)
      .setTitle(t(accepted ? 'school.dm.accepted_title' : 'school.dm.rejected_title'))
      .setDescription(t(accepted ? 'school.dm.accepted' : 'school.dm.rejected', { server: guild?.name ?? '', role: t(`school.roles.${app.role.toLowerCase()}`) }) + (app.note ? `\n\n> ${app.note.slice(0, 1500)}` : ''))
      .setFooter({ text: BRAND.footer });
    const user = await this.client.users.fetch(app.userId).catch(() => null);
    await user?.send({ embeds: [embed] });
  }

  // ───── Annonces ─────

  async announce(input: { guildId: string; channelId: string; title: string; content: string; authorId: string; imageUrl?: string | null }): Promise<string | null> {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(input.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return null;
    const cfg = await guildConfigService.get(input.guildId);
    const embed = new EmbedBuilder().setColor((cfg?.brandColor ?? BRAND.colors.primary) as ColorResolvable).setTitle(input.title.slice(0, 256)).setDescription(input.content.slice(0, 4000)).setTimestamp().setFooter({ text: cfg?.footerText ?? BRAND.footer, iconURL: cfg?.footerIconUrl ?? undefined });
    if (input.imageUrl) embed.setImage(input.imageUrl);
    const msg = await channel.send({ embeds: [embed] });
    await loggingService.log({ guildId: input.guildId, category: LogCategory.SCHOOL, action: 'school.announce', title: `🎓 Annonce : ${input.title}`, description: `<#${input.channelId}>`, actorId: input.authorId, data: { messageId: msg.id, channelId: input.channelId } });
    return msg.id;
  }

  // ───── Discord ─────

  private async setRole(guildId: string, userId: string, roleId: string | null, add: boolean): Promise<void> {
    if (!this.client || !roleId) return;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    try {
      if (add) await member.roles.add(roleId, 'School RP');
      else if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'School RP');
    } catch (err) {
      log.warn({ err, guildId, roleId }, 'Rôle School non appliqué');
    }
  }
}

export const schoolService = new SchoolService();
