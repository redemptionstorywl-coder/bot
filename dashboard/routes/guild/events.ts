import { Router } from 'express';
import { z } from 'zod';
import { EventStatus, PollType } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { eventService, DEFAULT_REMINDER_OFFSETS, type EventCreateData } from '../../../src/services/EventService';
import { pollService, parsePollOptions, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS } from '../../../src/services/PollService';
import { LANGUAGES, LANGUAGE_CODES } from '../../../src/config/constants';
import { parseDuration } from '../../../src/utils/time';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema, optionalDiscordId, optionalText, checkbox } from '../../lib/validate';
import { jsonArray } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserNames, requireBotGuild } from '../../lib/names';
import { parseLocalDateTime, toLocalInputValue } from '../../lib/dates';
import { broadcastToGuild } from '../../sockets';

const TABS = ['events', 'polls'] as const;
const listQuery = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'events'), z.enum(TABS)),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(EventStatus).optional()),
});
const eventParams = z.object({ eventId: z.coerce.number().int().positive() });
const pollParams = z.object({ pollId: z.coerce.number().int().positive() });

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = { SCHEDULED: 'Programmé', ONGOING: 'En cours', ENDED: 'Terminé', CANCELLED: 'Annulé' };

const reminderOffsets = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(/[\s,;]+/).filter(Boolean).map(Number) : Array.isArray(v) ? v : []),
  z.array(z.number().int().min(1).max(10_080)).max(10),
);

const eventBody = z.object({
  name: z.string().trim().min(1, 'nom requis').max(190),
  description: z.string().trim().min(1, 'description requise').max(4000),
  startsAt: z.string().trim().min(1, 'date de début requise'),
  endsAt: optionalText(32),
  location: optionalText(200),
  imageUrl: z.preprocess((v) => (typeof v !== 'string' || v.trim() === '' ? null : v.trim()), z.string().url('URL invalide').max(500).nullable()),
  mentionRoleId: optionalDiscordId,
  maxParticipants: z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int().min(1).max(10_000).nullable()),
  channelId: discordIdSchema,
  language: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.enum(LANGUAGE_CODES as [string, ...string[]]).nullable()),
  reminderOffsets,
});

const pollOption = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  return { label: typeof o.label === 'string' ? o.label.trim() : o.label, ...(typeof o.emoji === 'string' && o.emoji.trim() ? { emoji: o.emoji.trim() } : {}) };
}, z.object({ label: z.string().min(1).max(100), emoji: z.string().max(64).optional() }));

const pollBody = z.object({
  question: z.string().trim().min(1, 'question requise').max(1000),
  type: z.nativeEnum(PollType).default(PollType.MULTIPLE),
  optionsJson: jsonArray(pollOption, POLL_MAX_OPTIONS),
  anonymous: checkbox,
  multiSelect: checkbox,
  duration: optionalText(32),
  channelId: discordIdSchema,
});

function eventDates(body: z.infer<typeof eventBody>, timezone: string): { startsAt: Date; endsAt: Date | null } {
  const startsAt = parseLocalDateTime(body.startsAt, timezone);
  if (!startsAt) throw new HttpError(400, 'Date de début invalide.');
  const endsAt = body.endsAt ? parseLocalDateTime(body.endsAt, timezone) : null;
  if (body.endsAt && !endsAt) throw new HttpError(400, 'Date de fin invalide.');
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) throw new HttpError(400, 'La fin doit être postérieure au début.');
  return { startsAt, endsAt };
}

/** Pages Événements (création / édition / participants / rappels) et Sondages (création / fin / résultats). */
export function createEventsRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/events`;

  async function loadEvent(guildId: string, id: number) {
    const event = await eventService.get(id);
    if (!event || event.guildId !== guildId) throw new HttpError(404, 'Événement introuvable.');
    return event;
  }
  async function loadPoll(guildId: string, id: number) {
    const poll = await pollService.get(id);
    if (!poll || poll.guildId !== guildId) throw new HttpError(404, 'Sondage introuvable.');
    return poll;
  }

  router.get(
    '/events',
    validate({ query: listQuery }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof listQuery>>(req);
      const [events, polls] = await Promise.all([eventService.list(guild.id, query.status), pollService.list(guild.id)]);
      const sorted = [...events].sort((a, b) => {
        const rank = (s: EventStatus) => (s === EventStatus.ONGOING ? 0 : s === EventStatus.SCHEDULED ? 1 : 2);
        return rank(a.status) - rank(b.status) || (rank(a.status) === 2 ? b.startsAt.getTime() - a.startsAt.getTime() : a.startsAt.getTime() - b.startsAt.getTime());
      });
      const names = await resolveUserNames(client, guild.id, [...events.map((e) => e.createdById), ...polls.map((p) => p.createdById)]);
      render(res, 'events', {
        title: 'Événements',
        page: 'events',
        tab: query.tab,
        filters: query,
        events: sorted,
        statusLabels: EVENT_STATUS_LABELS,
        polls: polls.map((p) => ({ ...p, optionList: parsePollOptions(p.options), voters: new Set(p.votes.map((v) => v.userId)).size })),
        names,
        channelName: (id: string) => guild.textChannels.find((c) => c.id === id)?.name ?? id,
        languages: LANGUAGES.filter((l) => config.enabledLanguages.includes(l.code)),
        pollTypes: [{ value: 'MULTIPLE', label: 'Choix multiples (options personnalisées)' }, { value: 'YES_NO', label: 'Oui / Non' }],
        modules: { events: config.modules.events, polls: config.modules.polls },
      });
    }),
  );

  // ───── Événements ─────

  function eventFormData(res: Parameters<typeof render>[0], event: Awaited<ReturnType<typeof eventService.get>> | null) {
    const config = res.locals.config!;
    const offsets = Array.isArray(event?.reminderOffsets) ? (event!.reminderOffsets as number[]) : DEFAULT_REMINDER_OFFSETS;
    return {
      page: 'events',
      event,
      startsAtValue: toLocalInputValue(event?.startsAt ?? new Date(Date.now() + 86_400_000), config.timezone),
      endsAtValue: toLocalInputValue(event?.endsAt ?? null, config.timezone),
      reminderValue: offsets.join(', '),
      remindersSent: Array.isArray(event?.remindersSent) ? (event!.remindersSent as number[]) : [],
      languages: LANGUAGES.filter((l) => config.enabledLanguages.includes(l.code)),
      timezone: config.timezone,
      statusLabels: EVENT_STATUS_LABELS,
    };
  }

  router.get(
    '/events/new',
    wrap(async (_req, res) => {
      render(res, 'event-form', { title: 'Nouvel événement', ...eventFormData(res, null), names: {} });
    }),
  );

  router.get(
    '/events/:eventId(\\d+)',
    validate({ params: eventParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof eventParams>>(req);
      const event = await loadEvent(guild.id, params.eventId);
      const names = await resolveUserNames(client, guild.id, [event.createdById, ...event.participants.map((p) => p.userId)]);
      render(res, 'event-form', { title: `Événement · ${event.name}`, ...eventFormData(res, event), names, channelName: guild.textChannels.find((c) => c.id === event.channelId)?.name ?? event.channelId });
    }),
  );

  router.post(
    '/events',
    validate({ body: eventBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/new`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const config = res.locals.config!;
        const { body } = valid<z.infer<typeof eventBody>>(req);
        if (!guild.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        if (body.mentionRoleId && !guild.roles.some((r) => r.id === body.mentionRoleId)) throw new HttpError(400, 'Rôle inconnu.');
        const { startsAt, endsAt } = eventDates(body, config.timezone);
        if (startsAt.getTime() <= Date.now()) throw new HttpError(400, 'La date de début doit être dans le futur.');
        requireBotGuild(client, guild.id);
        const data: EventCreateData = { name: body.name, description: body.description, startsAt, endsAt, location: body.location ?? null, imageUrl: body.imageUrl, mentionRoleId: body.mentionRoleId, maxParticipants: body.maxParticipants, channelId: body.channelId, language: body.language, reminderOffsets: [...new Set(body.reminderOffsets)].sort((a, b) => b - a) };
        const event = await eventService.create(guild.id, data, req.session.user!.id);
        broadcastToGuild(guild.id, 'event:update', { guildId: guild.id, eventId: event.id, action: 'create' });
        flash(req, 'success', `Événement « ${event.name} » publié dans #${guild.textChannels.find((c) => c.id === body.channelId)?.name}.`);
        return `${base(guild.id)}/${event.id}`;
      },
    ),
  );

  router.post(
    '/events/:eventId(\\d+)',
    validate({ params: eventParams, body: eventBody.omit({ channelId: true }) }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.eventId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const config = res.locals.config!;
        const { params, body } = valid<z.infer<typeof eventBody>, unknown, z.infer<typeof eventParams>>(req);
        const existing = await loadEvent(guild.id, params.eventId);
        if (existing.status === EventStatus.CANCELLED || existing.status === EventStatus.ENDED) throw new HttpError(400, 'Un événement terminé ou annulé ne peut plus être modifié.');
        if (body.mentionRoleId && !guild.roles.some((r) => r.id === body.mentionRoleId)) throw new HttpError(400, 'Rôle inconnu.');
        const { startsAt, endsAt } = eventDates(body, config.timezone);
        const event = await eventService.update(existing.id, { name: body.name, description: body.description, startsAt, endsAt, location: body.location ?? null, imageUrl: body.imageUrl, mentionRoleId: body.mentionRoleId, maxParticipants: body.maxParticipants, language: body.language, reminderOffsets: [...new Set(body.reminderOffsets)].sort((a, b) => b - a) }, req.session.user!.id);
        broadcastToGuild(guild.id, 'event:update', { guildId: guild.id, eventId: existing.id, action: 'update' });
        flash(req, 'success', `Événement « ${event?.name ?? body.name} » mis à jour.`);
      },
    ),
  );

  router.post(
    '/events/:eventId(\\d+)/cancel',
    validate({ params: eventParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.eventId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof eventParams>>(req);
        const existing = await loadEvent(guild.id, params.eventId);
        if (existing.status === EventStatus.CANCELLED) throw new HttpError(400, 'Cet événement est déjà annulé.');
        await eventService.cancel(existing.id, req.session.user!.id);
        broadcastToGuild(guild.id, 'event:update', { guildId: guild.id, eventId: existing.id, action: 'cancel' });
        flash(req, 'success', `Événement « ${existing.name} » annulé (participants prévenus en DM).`);
      },
    ),
  );

  router.post(
    '/events/:eventId(\\d+)/remind',
    validate({ params: eventParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.eventId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof eventParams>>(req);
        const existing = await loadEvent(guild.id, params.eventId);
        requireBotGuild(client, guild.id);
        const ok = await eventService.remind(existing.id);
        if (!ok) throw new HttpError(400, 'Impossible d’envoyer un rappel pour un événement terminé ou annulé.');
        flash(req, 'success', `Rappel envoyé pour « ${existing.name} » (salon + DM des participants).`);
      },
    ),
  );

  // ───── Sondages ─────

  router.get(
    '/events/polls/:pollId(\\d+)',
    validate({ params: pollParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof pollParams>>(req);
      await loadPoll(guild.id, params.pollId);
      const result = await pollService.results(params.pollId);
      if (!result) throw new HttpError(404, 'Sondage introuvable.');
      const names = await resolveUserNames(client, guild.id, [result.poll.createdById, ...(result.voters ?? []).flat()]);
      render(res, 'poll', {
        title: 'Sondage',
        page: 'events',
        poll: result.poll,
        options: result.options,
        results: result.results,
        voters: result.voters,
        names,
        channelName: guild.textChannels.find((c) => c.id === result.poll.channelId)?.name ?? result.poll.channelId,
      });
    }),
  );

  router.post(
    '/events/polls',
    validate({ body: pollBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=polls`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof pollBody>>(req);
        if (!guild.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        if (body.type === PollType.MULTIPLE && body.optionsJson.length < POLL_MIN_OPTIONS) throw new HttpError(400, `Un sondage à choix multiples requiert au moins ${POLL_MIN_OPTIONS} options.`);
        let endsAt: Date | null = null;
        if (body.duration) {
          const seconds = parseDuration(body.duration);
          if (!seconds || seconds < 60) throw new HttpError(400, 'Durée invalide : utilisez par ex. « 30m », « 2h », « 1j ».');
          endsAt = new Date(Date.now() + seconds * 1000);
        }
        requireBotGuild(client, guild.id);
        const poll = await pollService.create(guild.id, { question: body.question, channelId: body.channelId, options: body.optionsJson, type: body.type, anonymous: body.anonymous, multiSelect: body.multiSelect, endsAt }, req.session.user!.id);
        broadcastToGuild(guild.id, 'event:update', { guildId: guild.id, pollId: poll.id, action: 'poll' });
        flash(req, 'success', `Sondage publié dans #${guild.textChannels.find((c) => c.id === body.channelId)?.name}.`);
        return `${base(guild.id)}/polls/${poll.id}`;
      },
    ),
  );

  router.post(
    '/events/polls/:pollId(\\d+)/end',
    validate({ params: pollParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/polls/${req.params.pollId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof pollParams>>(req);
        const existing = await loadPoll(guild.id, params.pollId);
        if (existing.ended) throw new HttpError(400, 'Ce sondage est déjà terminé.');
        await pollService.end(existing.id, req.session.user!.id);
        broadcastToGuild(guild.id, 'event:update', { guildId: guild.id, pollId: existing.id, action: 'poll-end' });
        flash(req, 'success', 'Sondage terminé : résultats figés et publiés.');
      },
    ),
  );

  return router;
}
