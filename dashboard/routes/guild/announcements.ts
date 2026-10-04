import { Router } from 'express';
import { z } from 'zod';
import { AnnouncementStatus } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { announcementService, type AnnouncementInput } from '../../../src/services/AnnouncementService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, optionalText, discordIdArray, optionalDiscordId, checkbox } from '../../lib/validate';
import { embedFormSchema, buttonsJsonSchema, toEmbedSpec } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { parseLocalDateTime, toLocalInputValue } from '../../lib/dates';
import { broadcastToGuild } from '../../sockets';

const idParams = z.object({ announcementId: z.coerce.number().int().positive() });

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  DRAFT: 'Brouillons',
  SCHEDULED: 'Programmées',
  PUBLISHED: 'Publiées',
  ARCHIVED: 'Archivées',
};

const announcementBody = z.object({
  title: z.string().trim().min(1, 'titre requis').max(190),
  content: optionalText(2000),
  channelId: optionalDiscordId,
  mentionRoleIds: discordIdArray,
  mentionEveryone: checkbox,
  embed: embedFormSchema,
  buttonsJson: buttonsJsonSchema,
});

const scheduleBody = z.object({ scheduledAt: z.string().trim().min(1, 'date requise') });

function inputFromBody(body: z.infer<typeof announcementBody>): AnnouncementInput {
  return {
    title: body.title,
    content: body.content ?? null,
    spec: toEmbedSpec(body.embed) ?? {},
    channelId: body.channelId,
    mentionRoleIds: [...new Set(body.mentionRoleIds)],
    mentionEveryone: body.mentionEveryone,
    buttons: body.buttonsJson,
  };
}

/** Pages Annonces : brouillons / programmées / publiées / archivées, éditeur, publication et programmation. */
export function createAnnouncementsRouter(_client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/announcements`;

  async function load(guildId: string, id: number) {
    const ann = await announcementService.get(id);
    if (!ann || ann.guildId !== guildId) throw new HttpError(404, 'Annonce introuvable.');
    return ann;
  }

  router.get(
    '/announcements',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const statuses = Object.values(AnnouncementStatus);
      const lists = await Promise.all(statuses.map((status) => announcementService.list(guild.id, status, { pageSize: 50 })));
      const scheduled = lists[statuses.indexOf(AnnouncementStatus.SCHEDULED)]!.items;
      const schedules = await Promise.all(scheduled.map((a) => announcementService.getPendingSchedule(a.id)));
      const scheduleMap = Object.fromEntries(scheduled.map((a, i) => [a.id, schedules[i]?.scheduledAt ?? null]));
      render(res, 'announcements', {
        title: 'Annonces',
        page: 'announcements',
        columns: statuses.map((status, i) => ({ status, label: ANNOUNCEMENT_STATUS_LABELS[status], items: lists[i]!.items, total: lists[i]!.total })),
        scheduleMap,
        channelName: (id: string | null) => (id ? (guild.textChannels.find((c) => c.id === id)?.name ?? id) : null),
        moduleEnabled: config.modules.announcements,
      });
    }),
  );

  function formData(res: Parameters<typeof render>[0], ann: Awaited<ReturnType<typeof announcementService.get>> | null) {
    const config = res.locals.config!;
    return {
      page: 'announcements',
      announcement: ann,
      spec: ann?.spec ?? {},
      buttons: ann?.buttons ?? [],
      timezone: config.timezone,
      minSchedule: toLocalInputValue(new Date(Date.now() + 5 * 60_000), config.timezone),
    };
  }

  router.get(
    '/announcements/new',
    wrap(async (_req, res) => {
      render(res, 'announcement-form', { title: 'Nouvelle annonce', ...formData(res, null), pendingSchedule: null });
    }),
  );

  router.get(
    '/announcements/:announcementId(\\d+)',
    validate({ params: idParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const ann = await load(guild.id, params.announcementId);
      const pendingSchedule = ann.status === AnnouncementStatus.SCHEDULED ? await announcementService.getPendingSchedule(ann.id) : null;
      render(res, 'announcement-form', { title: `Annonce · ${ann.title}`, ...formData(res, ann), pendingSchedule, statusLabel: ANNOUNCEMENT_STATUS_LABELS[ann.status] });
    }),
  );

  router.get(
    '/announcements/:announcementId(\\d+)/preview',
    validate({ params: idParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const ann = await load(guild.id, params.announcementId);
      const preview = await announcementService.preview(ann.id);
      render(res, 'announcement-preview', { title: `Aperçu · ${ann.title}`, page: 'announcements', announcement: ann, preview });
    }),
  );

  router.post(
    '/announcements',
    validate({ body: announcementBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/new`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof announcementBody>>(req);
        const ann = await announcementService.create(guild.id, inputFromBody(body), req.session.user!.id);
        broadcastToGuild(guild.id, 'announcement:update', { guildId: guild.id, announcementId: ann.id });
        flash(req, 'success', `Annonce « ${ann.title} » enregistrée en brouillon.`);
        return `${base(guild.id)}/${ann.id}`;
      },
    ),
  );

  router.post(
    '/announcements/:announcementId(\\d+)',
    validate({ params: idParams, body: announcementBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.announcementId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof announcementBody>, unknown, z.infer<typeof idParams>>(req);
        const existing = await load(guild.id, params.announcementId);
        const ann = await announcementService.update(existing.id, inputFromBody(body), { actorId: req.session.user!.id });
        broadcastToGuild(guild.id, 'announcement:update', { guildId: guild.id, announcementId: ann.id });
        flash(req, 'success', existing.status === AnnouncementStatus.PUBLISHED ? 'Annonce mise à jour et messages Discord synchronisés.' : 'Annonce enregistrée.');
      },
    ),
  );

  const simpleAction = (action: string, run: (id: number, actorId: string, req: Parameters<typeof flash>[0]) => Promise<string | void>) =>
    router.post(
      `/announcements/:announcementId(\\d+)/${action}`,
      validate({ params: idParams }),
      formAction(
        (req, res) => `${base(res.locals.guild!.id)}/${req.params.announcementId}`,
        async (req, res) => {
          const guild = res.locals.guild!;
          const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
          await load(guild.id, params.announcementId);
          const target = await run(params.announcementId, req.session.user!.id, req);
          broadcastToGuild(guild.id, 'announcement:update', { guildId: guild.id, announcementId: params.announcementId, action });
          return target ?? undefined;
        },
      ),
    );

  simpleAction('publish', async (id, actorId, req) => {
    const ann = await announcementService.publish(id, { actorId });
    flash(req, 'success', `Annonce « ${ann.title} » publiée.`);
  });
  simpleAction('cancel-schedule', async (id, _actorId, req) => {
    const count = await announcementService.cancelSchedule(id);
    flash(req, count ? 'success' : 'info', count ? 'Programmation annulée : l’annonce repasse en brouillon.' : 'Aucune programmation en attente.');
  });
  simpleAction('duplicate', async (id, actorId, req) => {
    const copy = await announcementService.duplicate(id, actorId);
    flash(req, 'success', `Copie créée : « ${copy.title} ».`);
    return `/guilds/${copy.guildId}/announcements/${copy.id}`;
  });
  simpleAction('archive', async (id, actorId, req) => {
    const ann = await announcementService.archive(id, actorId);
    flash(req, 'success', `Annonce « ${ann.title} » archivée.`);
  });
  simpleAction('delete', async (id, actorId, req) => {
    const ann = await announcementService.get(id);
    await announcementService.delete(id, actorId);
    flash(req, 'success', `Annonce « ${ann?.title ?? id} » supprimée (messages Discord retirés).`);
    return `/guilds/${ann?.guildId}/announcements`;
  });

  router.post(
    '/announcements/:announcementId(\\d+)/schedule',
    validate({ params: idParams, body: scheduleBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.announcementId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof scheduleBody>, unknown, z.infer<typeof idParams>>(req);
        await load(guild.id, params.announcementId);
        const date = parseLocalDateTime(body.scheduledAt, res.locals.config!.timezone);
        if (!date) throw new HttpError(400, 'Date de programmation invalide.');
        const schedule = await announcementService.schedule(params.announcementId, date, req.session.user!.id);
        broadcastToGuild(guild.id, 'announcement:scheduled', { guildId: guild.id, announcementId: params.announcementId, scheduledAt: schedule.scheduledAt });
        flash(req, 'success', `Annonce programmée pour le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: res.locals.config!.timezone }).format(schedule.scheduledAt)}.`);
      },
    ),
  );

  return router;
}
