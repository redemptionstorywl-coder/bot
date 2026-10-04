import { Router } from 'express';
import { z } from 'zod';
import { EventStatus, PollType } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { eventService, DEFAULT_REMINDER_OFFSETS, type EventCreateData, type EventWithParticipants } from '../../../src/services/EventService';
import { pollService, parsePollOptions, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, type PollOption, type PollWithVotes } from '../../../src/services/PollService';
import { giveawayService } from '../../../src/services/GiveawayService';
import { translationService, type Translator } from '../../../src/services/TranslationService';
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
import { serviceMessagePreview, renderPreviewHtml } from '../../lib/servicePreview';

const TABS = ['events', 'polls'] as const;
const listQuery = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'events'), z.enum(TABS)),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(EventStatus).optional()),
});
const eventParams = z.object({ eventId: z.coerce.number().int().positive() });
const pollParams = z.object({ pollId: z.coerce.number().int().positive() });

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = { SCHEDULED: 'Programmé', ONGOING: 'En cours', ENDED: 'Terminé', CANCELLED: 'Annulé' };

const reminderOffsets = z.preprocess(
  // Texte « 60, 10 » ou cases à cocher multiples (+ champ libre) : tout est aplati en nombres.
  (v) => (typeof v === 'string' || Array.isArray(v) ? ([] as unknown[]).concat(v).flatMap((x) => String(x).split(/[\s,;]+/)).filter(Boolean).map(Number) : []),
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

/** Compteurs des onglets Événements / Sondages / Giveaways (éléments actifs). */
export async function eventTabCounts(guildId: string): Promise<{ events: number; polls: number; giveaways: number }> {
  const [events, polls, giveaways] = await Promise.all([
    eventService.list(guildId, [EventStatus.SCHEDULED, EventStatus.ONGOING]),
    pollService.list(guildId, { ended: false }),
    giveawayService.list(guildId, { ended: false }),
  ]);
  return { events: events.length, polls: polls.length, giveaways: giveaways.length };
}

// ───── Aperçus (mêmes constructeurs que le bot, entité fictive pour les brouillons) ─────

/** Corps toléré par les aperçus : champs de formulaire bruts, jamais persistés. */
const loose = (max: number) => z.preprocess((v) => (v === undefined || v === null ? '' : String(v)), z.string().max(max));
const eventPreviewBody = z.object({
  eventId: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.coerce.number().int().positive().optional()),
  name: loose(190),
  description: loose(4000),
  startsAt: loose(32),
  endsAt: loose(32),
  location: loose(200),
  imageUrl: loose(500),
  mentionRoleId: loose(25),
  maxParticipants: loose(8),
  language: loose(8),
});
const pollPreviewBody = z.object({
  question: loose(1000),
  type: loose(16),
  optionsJson: loose(8000),
  anonymous: z.unknown().optional(),
  multiSelect: z.unknown().optional(),
  duration: loose(32),
});
const fmtQuestion = (q: string) => (q.length > 48 ? `${q.slice(0, 47)}…` : q);
const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === '1';
const PENDING_ID = '…' as unknown as number;

function languageOr(code: string | null | undefined, fallback: string): string {
  return code && (LANGUAGE_CODES as string[]).includes(code) ? code : fallback;
}

export function eventPreviewMessage(event: EventWithParticipants, t: Translator, color: number) {
  return serviceMessagePreview({
    content: event.mentionRoleId ? `<@&${event.mentionRoleId}>` : '',
    embeds: [eventService.buildEmbed(event, t, color)],
    components: eventService.buildComponents(event, t),
  });
}

export function pollPreviewMessage(poll: PollWithVotes, t: Translator, color: number) {
  return serviceMessagePreview({ embeds: [pollService.buildEmbed(poll, t, color)], components: pollService.buildComponents(poll, t) });
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
      const [all, polls, activeGiveaways] = await Promise.all([eventService.list(guild.id), pollService.list(guild.id), giveawayService.list(guild.id, { ended: false })]);
      const events = query.status ? all.filter((e) => e.status === query.status) : all;
      const sorted = [...events].sort((a, b) => {
        const rank = (s: EventStatus) => (s === EventStatus.ONGOING ? 0 : s === EventStatus.SCHEDULED ? 1 : 2);
        return rank(a.status) - rank(b.status) || (rank(a.status) === 2 ? b.startsAt.getTime() - a.startsAt.getTime() : a.startsAt.getTime() - b.startsAt.getTime());
      });
      const names = await resolveUserNames(client, guild.id, [...events.map((e) => e.createdById), ...polls.map((p) => p.createdById)]);
      const statusCounts = Object.fromEntries(Object.values(EventStatus).map((s) => [s, all.filter((e) => e.status === s).length]));
      render(res, 'events', {
        title: query.tab === 'polls' ? 'Sondages' : 'Événements',
        page: 'events',
        crumbs: query.tab === 'polls' ? [{ label: 'Sondages' }] : [],
        tab: query.tab,
        filters: query,
        events: sorted,
        statusCounts,
        statusLabels: EVENT_STATUS_LABELS,
        polls: polls.map((p) => ({ ...p, optionList: parsePollOptions(p.options), voters: new Set(p.votes.map((v) => v.userId)).size })),
        counts: { events: all.filter((e) => e.status === EventStatus.SCHEDULED || e.status === EventStatus.ONGOING).length, polls: polls.filter((p) => !p.ended).length, giveaways: activeGiveaways.length },
        names,
        channelName: (id: string) => guild.textChannels.find((c) => c.id === id)?.name ?? id,
        modules: { events: config.modules.events, polls: config.modules.polls, giveaways: config.modules.giveaways },
      });
    }),
  );

  // ───── Événements ─────

  function eventFormData(res: Parameters<typeof render>[0], event: Awaited<ReturnType<typeof eventService.get>> | null) {
    const config = res.locals.config!;
    const offsets = Array.isArray(event?.reminderOffsets) ? (event!.reminderOffsets as number[]) : DEFAULT_REMINDER_OFFSETS;
    return {
      page: 'events',
      layout: 'wide',
      scripts: ['live-preview'],
      event,
      startsAtValue: toLocalInputValue(event?.startsAt ?? new Date(Date.now() + 86_400_000), config.timezone),
      endsAtValue: toLocalInputValue(event?.endsAt ?? null, config.timezone),
      reminderOffsets: offsets,
      reminderValue: offsets.join(', '),
      remindersSent: Array.isArray(event?.remindersSent) ? (event!.remindersSent as number[]) : [],
      languages: LANGUAGES,
      timezone: config.timezone,
      statusLabels: EVENT_STATUS_LABELS,
    };
  }

  /** Construit l'entité fictive d'un aperçu d'événement à partir du formulaire (fusionnée avec l'événement existant). */
  function eventFromForm(res: Parameters<typeof render>[0], body: z.infer<typeof eventPreviewBody>, existing: EventWithParticipants | null): EventWithParticipants {
    const config = res.locals.config!;
    const startsAt = parseLocalDateTime(body.startsAt, config.timezone) ?? existing?.startsAt ?? new Date(Date.now() + 86_400_000);
    const endsAt = body.endsAt ? parseLocalDateTime(body.endsAt, config.timezone) : null;
    const max = Number.parseInt(body.maxParticipants, 10);
    return {
      ...(existing ?? ({} as EventWithParticipants)),
      id: existing?.id ?? PENDING_ID,
      guildId: res.locals.guild!.id,
      name: body.name.trim() || "Nom de l'événement",
      description: body.description.trim() || 'Description de l’événement…',
      startsAt,
      endsAt: endsAt && endsAt.getTime() > startsAt.getTime() ? endsAt : null,
      location: body.location.trim() || null,
      imageUrl: /^https?:\/\//i.test(body.imageUrl.trim()) ? body.imageUrl.trim() : null,
      mentionRoleId: /^\d{15,22}$/.test(body.mentionRoleId) ? body.mentionRoleId : null,
      maxParticipants: Number.isFinite(max) && max > 0 ? max : null,
      language: body.language || null,
      status: existing?.status ?? EventStatus.SCHEDULED,
      participants: existing?.participants ?? [],
    };
  }

  function eventTranslator(res: Parameters<typeof render>[0], language: string | null | undefined): Translator {
    const config = res.locals.config!;
    return translationService.bind(languageOr(language, config.defaultLanguage), res.locals.guild!.id);
  }

  router.get(
    '/events/new',
    wrap(async (_req, res) => {
      const config = res.locals.config!;
      const draft = eventFromForm(res, eventPreviewBody.parse({}), null);
      render(res, 'event-form', {
        title: 'Nouvel événement',
        crumbs: [{ label: 'Nouvel événement' }],
        ...eventFormData(res, null),
        names: {},
        previewHtml: renderPreviewHtml(res, eventPreviewMessage(draft, eventTranslator(res, null), config.brandColor)),
      });
    }),
  );

  router.get(
    '/events/:eventId(\\d+)',
    validate({ params: eventParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { params } = valid<unknown, unknown, z.infer<typeof eventParams>>(req);
      const event = await loadEvent(guild.id, params.eventId);
      const names = await resolveUserNames(client, guild.id, [event.createdById, ...event.participants.map((p) => p.userId)]);
      render(res, 'event-form', {
        title: `Événement · ${event.name}`,
        crumbs: [{ label: event.name }],
        ...eventFormData(res, event),
        names,
        channelName: guild.textChannels.find((c) => c.id === event.channelId)?.name ?? event.channelId,
        previewHtml: renderPreviewHtml(res, eventPreviewMessage(event, eventTranslator(res, event.language), config.brandColor), names),
      });
    }),
  );

  router.post(
    '/events/preview',
    validate({ body: eventPreviewBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { body } = valid<z.infer<typeof eventPreviewBody>>(req);
      const existing = body.eventId ? await loadEvent(guild.id, body.eventId) : null;
      const event = eventFromForm(res, body, existing);
      const names = existing ? await resolveUserNames(client, guild.id, existing.participants.map((p) => p.userId)) : {};
      res.json({ ok: true, html: renderPreviewHtml(res, eventPreviewMessage(event, eventTranslator(res, event.language), config.brandColor), names) });
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

  function pollFromForm(res: Parameters<typeof render>[0], body: z.infer<typeof pollPreviewBody>, t: Translator): PollWithVotes {
    const type = body.type === PollType.YES_NO ? PollType.YES_NO : PollType.MULTIPLE;
    let options: PollOption[];
    if (type === PollType.YES_NO) {
      options = [
        { label: t('polls.yes'), emoji: '✅' },
        { label: t('polls.no'), emoji: '❌' },
      ];
    } else {
      let raw: unknown = [];
      try {
        raw = JSON.parse(body.optionsJson || '[]');
      } catch {
        raw = [];
      }
      options = (Array.isArray(raw) ? raw : [])
        .filter((o): o is { label: unknown; emoji?: unknown } => Boolean(o) && typeof o === 'object')
        .map((o) => ({ label: typeof o.label === 'string' ? o.label.trim().slice(0, 100) : '', ...(typeof o.emoji === 'string' && o.emoji.trim() ? { emoji: o.emoji.trim().slice(0, 64) } : {}) }))
        .filter((o) => o.label)
        .slice(0, POLL_MAX_OPTIONS);
      if (!options.length) options = [{ label: 'Option 1' }, { label: 'Option 2' }];
    }
    const seconds = body.duration ? parseDuration(body.duration) : null;
    return {
      id: PENDING_ID,
      guildId: res.locals.guild!.id,
      channelId: '',
      messageId: null,
      question: body.question.trim() || 'Votre question…',
      options: options as unknown as PollWithVotes['options'],
      type,
      anonymous: truthy(body.anonymous),
      multiSelect: type === PollType.YES_NO ? false : truthy(body.multiSelect),
      endsAt: seconds && seconds >= 60 ? new Date(Date.now() + seconds * 1000) : null,
      ended: false,
      createdById: '',
      createdAt: new Date(),
      votes: [],
    } as unknown as PollWithVotes;
  }

  router.get(
    '/events/polls/new',
    wrap(async (_req, res) => {
      const config = res.locals.config!;
      const t = translationService.bind(config.defaultLanguage, res.locals.guild!.id);
      const draft = pollFromForm(res, pollPreviewBody.parse({ optionsJson: '[]' }), t);
      render(res, 'poll-form', {
        title: 'Nouveau sondage',
        page: 'events',
        layout: 'wide',
        scripts: ['live-preview'],
        crumbs: [{ label: 'Sondages', href: `${base(res.locals.guild!.id)}?tab=polls` }, { label: 'Nouveau sondage' }],
        previewHtml: renderPreviewHtml(res, pollPreviewMessage(draft, t, config.brandColor)),
      });
    }),
  );

  router.post(
    '/events/polls/preview',
    validate({ body: pollPreviewBody }),
    wrap(async (req, res) => {
      const config = res.locals.config!;
      const { body } = valid<z.infer<typeof pollPreviewBody>>(req);
      const t = translationService.bind(config.defaultLanguage, res.locals.guild!.id);
      res.json({ ok: true, html: renderPreviewHtml(res, pollPreviewMessage(pollFromForm(res, body, t), t, config.brandColor)) });
    }),
  );

  router.get(
    '/events/polls/:pollId(\\d+)',
    validate({ params: pollParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { params } = valid<unknown, unknown, z.infer<typeof pollParams>>(req);
      const full = await loadPoll(guild.id, params.pollId);
      const result = await pollService.results(params.pollId);
      if (!result) throw new HttpError(404, 'Sondage introuvable.');
      const names = await resolveUserNames(client, guild.id, [result.poll.createdById, ...(result.voters ?? []).flat()]);
      const t = translationService.bind(config.defaultLanguage, guild.id);
      render(res, 'poll', {
        title: 'Sondage',
        page: 'events',
        crumbs: [{ label: 'Sondages', href: `${base(guild.id)}?tab=polls` }, { label: fmtQuestion(result.poll.question) }],
        poll: result.poll,
        options: result.options,
        results: result.results,
        voters: result.voters,
        names,
        channelName: guild.textChannels.find((c) => c.id === result.poll.channelId)?.name ?? result.poll.channelId,
        previewHtml: renderPreviewHtml(res, pollPreviewMessage(full, t, config.brandColor), names),
      });
    }),
  );

  router.post(
    '/events/polls',
    validate({ body: pollBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/polls/new`,
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
