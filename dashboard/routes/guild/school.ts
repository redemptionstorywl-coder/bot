import { Router } from 'express';
import { z } from 'zod';
import { Prisma, ReviewStatus, SchoolRole } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { schoolService, parseAnswers, sortHouses } from '../../../src/services/SchoolService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema, optionalDiscordId, optionalText, pageQuery, hexColorSchema } from '../../lib/validate';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserNames } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const PAGE_SIZE = 25;
const TABS = ['students', 'classes', 'houses', 'clubs', 'applications', 'config'] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = { students: 'Élèves & profils', classes: 'Classes', houses: 'Maisons', clubs: 'Clubs', applications: 'Candidatures', config: 'Configuration' };

export const SCHOOL_ROLE_LABELS: Record<SchoolRole, string> = { STUDENT: 'Élève', TEACHER: 'Professeur', STAFF: 'Staff' };
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = { PENDING: 'En attente', ACCEPTED: 'Acceptée', REJECTED: 'Refusée' };

const optionalId = z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int().positive().nullable());
const optionalIdQuery = z.preprocess((v) => (v === '' || v === undefined ? undefined : Number(v)), z.number().int().positive().optional());
const optionalCapacity = z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int().min(1).max(10_000).nullable());

const pageQuerySchema = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'students'), z.enum(TABS)),
  role: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(SchoolRole).optional()),
  class: optionalIdQuery,
  house: optionalIdQuery,
  q: z.string().trim().max(100).optional().default(''),
  page: pageQuery,
  user: z.preprocess((v) => (v === '' ? undefined : v), discordIdSchema.optional()),
  club: optionalIdQuery,
  status: z.preprocess((v) => (v === '' || v === undefined ? 'PENDING' : v === 'all' ? undefined : v), z.nativeEnum(ReviewStatus).optional()),
  app: optionalIdQuery,
});

const idParams = z.object({ id: z.coerce.number().int().positive() });
const userParams = z.object({ userId: discordIdSchema });
const clubMemberParams = z.object({ id: z.coerce.number().int().positive(), userId: discordIdSchema });

const configBody = z.object({
  applicationChannelId: optionalDiscordId,
  announceChannelId: optionalDiscordId,
  studentRoleId: optionalDiscordId,
  teacherRoleId: optionalDiscordId,
  staffRoleId: optionalDiscordId,
});

const profileFields = {
  firstName: z.string().trim().min(1, 'prénom requis').max(50),
  lastName: z.string().trim().min(1, 'nom requis').max(50),
  role: z.nativeEnum(SchoolRole).default('STUDENT'),
  classId: optionalId,
  houseId: optionalId,
  bio: optionalText(500),
};
const profileCreateBody = z.object({ userId: discordIdSchema, ...profileFields });
const profileEditBody = z.object({ ...profileFields, points: z.coerce.number().int().min(0).max(1_000_000).default(0) });

const classBody = z.object({ name: z.string().trim().min(1, 'nom requis').max(60), teacherId: optionalDiscordId, roleId: optionalDiscordId, channelId: optionalDiscordId, capacity: optionalCapacity });
const houseBody = z.object({ name: z.string().trim().min(1, 'nom requis').max(60), emoji: optionalText(64), color: z.preprocess((v) => (v === '' || v === undefined ? null : v), hexColorSchema.nullable()), roleId: optionalDiscordId });
const pointsBody = z.object({ delta: z.coerce.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'nombre de points non nul attendu'), reason: optionalText(300), userId: optionalDiscordId });
const clubBody = z.object({ name: z.string().trim().min(1, 'nom requis').max(60), description: optionalText(1000), leaderId: optionalDiscordId, roleId: optionalDiscordId, maxMembers: optionalCapacity });
const clubMemberBody = z.object({ userId: discordIdSchema });
const reviewBody = z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']), note: optionalText(1000) });

/** Pages School RP : configuration, élèves & profils, classes, maisons, clubs, candidatures. */
export function createSchoolRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/school`;
  const tabBack = (tab: (typeof TABS)[number]) => (_req: unknown, res: { locals: { guild?: { id: string } } }) => `${base(res.locals.guild!.id)}?tab=${tab}`;

  function checkRole(guild: { roles: { id: string }[] }, roleId: string | null | undefined, label: string): void {
    if (roleId && !guild.roles.some((r) => r.id === roleId)) throw new HttpError(400, `${label} : rôle inconnu.`);
  }
  function checkChannel(guild: { textChannels: { id: string }[] }, channelId: string | null | undefined, label: string): void {
    if (channelId && !guild.textChannels.some((c) => c.id === channelId)) throw new HttpError(400, `${label} : salon inconnu.`);
  }

  router.get(
    '/school',
    validate({ query: pageQuerySchema }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof pageQuerySchema>>(req);

      const where: Prisma.SchoolProfileWhereInput = {
        guildId: guild.id,
        ...(query.role ? { role: query.role } : {}),
        ...(query.class ? { classId: query.class } : {}),
        ...(query.house ? { houseId: query.house } : {}),
        ...(query.q ? { OR: [{ firstName: { contains: query.q } }, { lastName: { contains: query.q } }, { userId: { contains: query.q } }] } : {}),
      };
      const [settings, classes, houses, clubs, applications, students, studentTotal, profileCounts] = await Promise.all([
        schoolService.getConfig(guild.id),
        schoolService.listClasses(guild.id),
        schoolService.listHouses(guild.id),
        schoolService.listClubs(guild.id),
        schoolService.listApplications(guild.id, query.status, 200),
        // Pas de méthode de liste paginée dans SchoolService : lecture directe (aucun cache de profils côté service).
        prisma.schoolProfile.findMany({ where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { class: true, house: true } }),
        prisma.schoolProfile.count({ where }),
        prisma.schoolProfile.groupBy({ by: ['role'], where: { guildId: guild.id }, _count: { _all: true } }),
      ]);
      const [profile, club, clubMembers, application, pendingCount] = await Promise.all([
        query.user ? schoolService.getProfile(guild.id, query.user) : Promise.resolve(null),
        query.club ? schoolService.requireClub(guild.id, query.club) : Promise.resolve(null),
        query.club ? prisma.schoolClubMember.findMany({ where: { clubId: query.club }, orderBy: { joinedAt: 'asc' }, include: { profile: true } }) : Promise.resolve([]),
        query.app ? schoolService.getApplication(guild.id, query.app) : Promise.resolve(null),
        prisma.schoolApplication.count({ where: { guildId: guild.id, status: ReviewStatus.PENDING } }),
      ]);
      if (query.app && !application) throw new HttpError(404, 'Candidature introuvable.');

      const names = await resolveUserNames(client, guild.id, [
        ...students.map((s) => s.userId),
        ...classes.map((c) => c.teacherId),
        ...clubs.map((c) => c.leaderId),
        ...clubMembers.map((m) => m.profile.userId),
        ...applications.map((a) => a.userId),
        ...applications.map((a) => a.reviewedById),
        query.user,
        application?.userId,
        application?.reviewedById,
      ]);
      const counts: Record<SchoolRole, number> = { STUDENT: 0, TEACHER: 0, STAFF: 0 };
      for (const row of profileCounts) counts[row.role] = row._count._all;
      const rankedHouses = sortHouses(houses);
      const maxPoints = Math.max(1, ...rankedHouses.map((h) => h.points));
      const baseQuery = new URLSearchParams({ tab: 'students', ...(query.role ? { role: query.role } : {}), ...(query.class ? { class: String(query.class) } : {}), ...(query.house ? { house: String(query.house) } : {}), ...(query.q ? { q: query.q } : {}) }).toString();
      render(res, 'school', {
        title: 'School RP',
        page: 'school',
        crumbs: query.tab === 'students' ? [] : [{ label: TAB_LABELS[query.tab] }],
        tab: query.tab,
        filters: { role: query.role ?? '', class: query.class ?? '', house: query.house ?? '', q: query.q, user: query.user ?? '', status: query.status ?? 'all' },
        settings,
        counts,
        totalProfiles: counts.STUDENT + counts.TEACHER + counts.STAFF,
        pendingCount,
        students,
        pagination: { page: query.page, pages: Math.max(1, Math.ceil(studentTotal / PAGE_SIZE)), total: studentTotal, pageSize: PAGE_SIZE },
        baseQuery,
        profile,
        profileMissing: Boolean(query.user && !profile),
        classes,
        houses: rankedHouses.map((h) => ({ ...h, pct: Math.round((h.points / maxPoints) * 1000) / 10 })),
        clubs,
        club,
        clubMembers,
        applications,
        application: application ? { ...application, answers: parseAnswers(application.answers) } : null,
        names,
        roleLabels: SCHOOL_ROLE_LABELS,
        roles: Object.values(SchoolRole).map((r) => ({ value: r, label: SCHOOL_ROLE_LABELS[r] })),
        statusLabels: REVIEW_STATUS_LABELS,
        moduleEnabled: config.modules.school,
      });
    }),
  );

  // ───── Configuration ─────

  router.post(
    '/school/config',
    validate({ body: configBody }),
    formAction(tabBack('config'), async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof configBody>>(req);
      checkChannel(guild, body.applicationChannelId, 'Salon des candidatures');
      checkChannel(guild, body.announceChannelId, "Salon d'annonces");
      checkRole(guild, body.studentRoleId, 'Rôle élève');
      checkRole(guild, body.teacherRoleId, 'Rôle professeur');
      checkRole(guild, body.staffRoleId, 'Rôle staff');
      await schoolService.updateConfig(guild.id, body);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'config' });
      flash(req, 'success', 'Configuration School RP enregistrée.');
    }),
  );

  // ───── Profils ─────

  router.post(
    '/school/students',
    validate({ body: profileCreateBody }),
    formAction(tabBack('students'), async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof profileCreateBody>>(req);
      const profile = await schoolService.register({ guildId: guild.id, userId: body.userId, firstName: body.firstName, lastName: body.lastName, role: body.role, classId: body.classId, houseId: body.houseId, bio: body.bio ?? null });
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'profile', userId: body.userId });
      flash(req, 'success', `Profil de ${profile.firstName} ${profile.lastName} créé.`);
      return `${base(guild.id)}?tab=students&user=${body.userId}`;
    }),
  );

  router.post(
    '/school/students/:userId',
    validate({ params: userParams, body: profileEditBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=students&user=${req.params.userId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof profileEditBody>, unknown, z.infer<typeof userParams>>(req);
        const existing = await schoolService.requireProfile(guild.id, params.userId);
        await schoolService.updateProfile(guild.id, params.userId, { firstName: body.firstName, lastName: body.lastName, role: body.role, bio: body.bio ?? null, points: body.points });
        if ((body.classId ?? null) !== (existing.classId ?? null)) await schoolService.assignClass(guild.id, params.userId, body.classId, req.session.user!.id);
        if ((body.houseId ?? null) !== (existing.houseId ?? null)) await schoolService.assignHouse(guild.id, params.userId, body.houseId, req.session.user!.id);
        broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'profile', userId: params.userId });
        flash(req, 'success', `Profil de ${body.firstName} ${body.lastName} mis à jour.`);
      },
    ),
  );

  router.post(
    '/school/students/:userId/delete',
    validate({ params: userParams }),
    formAction(tabBack('students'), async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof userParams>>(req);
      const existing = await schoolService.requireProfile(guild.id, params.userId);
      // Pas de méthode de suppression dans SchoolService : suppression directe (adhésions aux clubs en cascade).
      await prisma.schoolProfile.delete({ where: { id: existing.id } });
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'profile', userId: params.userId });
      flash(req, 'success', `Profil de ${existing.firstName} ${existing.lastName} supprimé.`);
    }),
  );

  // ───── Classes ─────

  router.post(
    '/school/classes',
    validate({ body: classBody }),
    formAction(tabBack('classes'), async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof classBody>>(req);
      checkRole(guild, body.roleId, 'Rôle de classe');
      checkChannel(guild, body.channelId, 'Salon de classe');
      const c = await schoolService.createClass(guild.id, body, req.session.user!.id);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'class', classId: c.id });
      flash(req, 'success', `Classe « ${c.name} » créée.`);
    }),
  );

  router.post(
    '/school/classes/:id(\\d+)',
    validate({ params: idParams, body: classBody }),
    formAction(tabBack('classes'), async (req, res) => {
      const guild = res.locals.guild!;
      const { params, body } = valid<z.infer<typeof classBody>, unknown, z.infer<typeof idParams>>(req);
      const existing = await schoolService.requireClass(guild.id, params.id);
      checkRole(guild, body.roleId, 'Rôle de classe');
      checkChannel(guild, body.channelId, 'Salon de classe');
      if (body.name !== existing.name) {
        const dup = await schoolService.findClassByName(guild.id, body.name);
        if (dup && dup.id !== existing.id) throw new HttpError(409, `Une classe « ${body.name} » existe déjà.`);
      }
      // Pas de méthode d'édition dans SchoolService : mise à jour directe.
      const c = await prisma.schoolClass.update({ where: { id: existing.id }, data: { name: body.name, teacherId: body.teacherId, roleId: body.roleId, channelId: body.channelId, capacity: body.capacity } });
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'class', classId: c.id });
      flash(req, 'success', `Classe « ${c.name} » mise à jour.`);
    }),
  );

  router.post(
    '/school/classes/:id(\\d+)/delete',
    validate({ params: idParams }),
    formAction(tabBack('classes'), async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const c = await schoolService.deleteClass(guild.id, params.id, req.session.user!.id);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'class', classId: c.id });
      flash(req, 'success', `Classe « ${c.name} » supprimée (les élèves sont conservés sans classe).`);
    }),
  );

  // ───── Maisons ─────

  router.post(
    '/school/houses',
    validate({ body: houseBody }),
    formAction(tabBack('houses'), async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof houseBody>>(req);
      checkRole(guild, body.roleId, 'Rôle de maison');
      const h = await schoolService.createHouse(guild.id, { name: body.name, emoji: body.emoji ?? null, color: body.color, roleId: body.roleId }, req.session.user!.id);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'house', houseId: h.id });
      flash(req, 'success', `Maison « ${h.name} » créée.`);
    }),
  );

  router.post(
    '/school/houses/:id(\\d+)',
    validate({ params: idParams, body: houseBody }),
    formAction(tabBack('houses'), async (req, res) => {
      const guild = res.locals.guild!;
      const { params, body } = valid<z.infer<typeof houseBody>, unknown, z.infer<typeof idParams>>(req);
      const existing = await schoolService.requireHouse(guild.id, params.id);
      checkRole(guild, body.roleId, 'Rôle de maison');
      if (body.name !== existing.name) {
        const dup = await schoolService.findHouseByName(guild.id, body.name);
        if (dup && dup.id !== existing.id) throw new HttpError(409, `Une maison « ${body.name} » existe déjà.`);
      }
      // Pas de méthode d'édition dans SchoolService : mise à jour directe.
      const h = await prisma.schoolHouse.update({ where: { id: existing.id }, data: { name: body.name, emoji: body.emoji ?? null, color: body.color, roleId: body.roleId } });
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'house', houseId: h.id });
      flash(req, 'success', `Maison « ${h.name} » mise à jour.`);
    }),
  );

  router.post(
    '/school/houses/:id(\\d+)/points',
    validate({ params: idParams, body: pointsBody }),
    formAction(tabBack('houses'), async (req, res) => {
      const guild = res.locals.guild!;
      const { params, body } = valid<z.infer<typeof pointsBody>, unknown, z.infer<typeof idParams>>(req);
      if (body.userId && !(await schoolService.getProfile(guild.id, body.userId))) throw new HttpError(400, 'Aucun profil School pour cet utilisateur : laissez le champ vide pour créditer la maison seule.');
      const h = await schoolService.addHousePoints(guild.id, params.id, body.delta, req.session.user!.id, body.reason ?? null, body.userId);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'points', houseId: h.id });
      flash(req, 'success', `${h.emoji ? h.emoji + ' ' : ''}${h.name} : ${body.delta > 0 ? '+' : ''}${body.delta} pts → ${h.points} pts.`);
    }),
  );

  router.post(
    '/school/houses/:id(\\d+)/delete',
    validate({ params: idParams }),
    formAction(tabBack('houses'), async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const h = await schoolService.deleteHouse(guild.id, params.id, req.session.user!.id);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'house', houseId: h.id });
      flash(req, 'success', `Maison « ${h.name} » supprimée.`);
    }),
  );

  // ───── Clubs ─────

  router.post(
    '/school/clubs',
    validate({ body: clubBody }),
    formAction(tabBack('clubs'), async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof clubBody>>(req);
      checkRole(guild, body.roleId, 'Rôle de club');
      const c = await schoolService.createClub(guild.id, { name: body.name, description: body.description ?? null, leaderId: body.leaderId, roleId: body.roleId, maxMembers: body.maxMembers }, req.session.user!.id);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'club', clubId: c.id });
      flash(req, 'success', `Club « ${c.name} » créé.`);
    }),
  );

  router.post(
    '/school/clubs/:id(\\d+)',
    validate({ params: idParams, body: clubBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=clubs&club=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof clubBody>, unknown, z.infer<typeof idParams>>(req);
        const existing = await schoolService.requireClub(guild.id, params.id);
        checkRole(guild, body.roleId, 'Rôle de club');
        if (body.name !== existing.name) {
          const dup = await schoolService.findClubByName(guild.id, body.name);
          if (dup && dup.id !== existing.id) throw new HttpError(409, `Un club « ${body.name} » existe déjà.`);
        }
        // Pas de méthode d'édition dans SchoolService : mise à jour directe.
        const c = await prisma.schoolClub.update({ where: { id: existing.id }, data: { name: body.name, description: body.description ?? null, leaderId: body.leaderId, roleId: body.roleId, maxMembers: body.maxMembers } });
        broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'club', clubId: c.id });
        flash(req, 'success', `Club « ${c.name} » mis à jour.`);
      },
    ),
  );

  router.post(
    '/school/clubs/:id(\\d+)/delete',
    validate({ params: idParams }),
    formAction(tabBack('clubs'), async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const c = await schoolService.deleteClub(guild.id, params.id, req.session.user!.id);
      broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'club', clubId: c.id });
      flash(req, 'success', `Club « ${c.name} » supprimé.`);
    }),
  );

  router.post(
    '/school/clubs/:id(\\d+)/members',
    validate({ params: idParams, body: clubMemberBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=clubs&club=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof clubMemberBody>, unknown, z.infer<typeof idParams>>(req);
        const c = await schoolService.joinClub(guild.id, body.userId, params.id);
        broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'club', clubId: c.id });
        flash(req, 'success', `Membre ajouté au club « ${c.name} ».`);
      },
    ),
  );

  router.post(
    '/school/clubs/:id(\\d+)/members/:userId/remove',
    validate({ params: clubMemberParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=clubs&club=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof clubMemberParams>>(req);
        const c = await schoolService.leaveClub(guild.id, params.userId, params.id);
        broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'club', clubId: c.id });
        flash(req, 'success', `Membre retiré du club « ${c.name} ».`);
      },
    ),
  );

  // ───── Candidatures ─────

  router.post(
    '/school/applications/:id(\\d+)/review',
    validate({ params: idParams, body: reviewBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=applications&app=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof reviewBody>, unknown, z.infer<typeof idParams>>(req);
        const app = await schoolService.reviewApplication({ guildId: guild.id, id: params.id, reviewerId: req.session.user!.id, decision: body.decision, note: body.note ?? null });
        broadcastToGuild(guild.id, 'school:update', { guildId: guild.id, action: 'application', id: app.id, status: app.status });
        flash(req, 'success', `Candidature #${app.id} ${app.status === ReviewStatus.ACCEPTED ? 'acceptée' : 'refusée'}.`);
        return `${base(guild.id)}?tab=applications&status=${app.status}&app=${app.id}`;
      },
    ),
  );

  return router;
}
