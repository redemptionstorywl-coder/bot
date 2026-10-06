import fs from 'node:fs';
import path from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { ChannelType, type NewsChannel, type TextChannel } from 'discord.js';
import { PanelStyle, TicketStatus, type TicketType } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { ticketService, ticketQuestionSchema, parseQuestions, parseEmbedSpec, asFormAnswers, asStringArray, isTicketOpen, DEFAULT_TICKET_TYPES } from '../../../src/services/TicketService';
import { ticketReminderService, normalizeReminderPing, REMINDER_PING_MODES } from '../../../src/services/TicketReminderService';
import { DEFAULT_CLOSED_CATEGORY_ID } from '../../../src/services/tickets/closeFlow';
import { MAX_TYPE_QUESTIONS, TICKET_MESSAGE_MAX, TICKET_TITLE_MAX, planOpenModal } from '../../../src/services/tickets/title';
import { transcriptService } from '../../../src/services/TranscriptService';
import { translationService, type Translator } from '../../../src/services/TranslationService';
import { uniqueKey } from '../../../src/commands/tickets/_configPanel';
import { BRAND } from '../../../src/config/constants';
import { render } from '../../lib/render';
import { lineChart } from '../../lib/charts';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdArray, optionalDiscordId, optionalText, checkbox, pageQuery, discordIdSchema } from '../../lib/validate';
import { jsonArray, embedFormOptional, toEmbedSpec } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserProfiles, requireBotGuild } from '../../lib/names';
import { wantsJson } from '../../lib/rateLimit';
import { firstResponseStats, dailyActivity, topClosers } from '../../lib/ticketStats';
import { broadcastToGuild } from '../../sockets';

const PAGE_SIZE = 20;

export const TICKET_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Ouvert',
  CLOSED: 'Fermé',
  ARCHIVED: 'Archivé',
  DELETED: 'Supprimé',
};

export const REMINDER_PING_LABELS: Record<(typeof REMINDER_PING_MODES)[number], { label: string; description: string }> = {
  staff: { label: 'Les rôles d’accès', description: 'Mentionne les rôles d’accès de la raison (sinon les rôles staff du serveur).' },
  none: { label: 'Personne', description: 'Relance sans mention (simple message dans le ticket).' },
};

// ───── Schémas ─────

const listQuery = z.object({
  status: z.preprocess((v) => (v === '' || v === 'all' ? undefined : v), z.union([z.literal('open'), z.literal('closed'), z.nativeEnum(TicketStatus)]).optional()),
  type: z.preprocess((v) => (v === '' || v === undefined ? undefined : Number(v)), z.number().int().positive().optional()),
  user: z.preprocess((v) => (v === '' ? undefined : v), discordIdSchema.optional()),
  q: z.string().trim().max(100).optional().default(''),
  page: pageQuery,
});

const idParams = z.object({ ticketId: z.coerce.number().int().positive() });
const typeParams = z.object({ typeId: z.coerce.number().int().positive() });
const panelParams = z.object({ panelId: z.coerce.number().int().positive() });

/** Question du formulaire : identifiant généré depuis le libellé s'il manque. */
const questionInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const q = { ...(v as Record<string, unknown>) };
  if (typeof q.label === 'string') q.label = q.label.trim();
  if (typeof q.id !== 'string' || !q.id.trim()) {
    const base = typeof q.label === 'string' ? q.label.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) : '';
    q.id = base || `q${Math.random().toString(36).slice(2, 8)}`;
  }
  if (typeof q.placeholder === 'string') q.placeholder = q.placeholder.trim();
  if (q.placeholder === '' || q.placeholder === undefined) delete q.placeholder;
  if (q.maxLength === '' || q.maxLength === undefined || q.maxLength === null) delete q.maxLength;
  else q.maxLength = Number(q.maxLength);
  q.required = q.required === true || q.required === 'true' || q.required === 'on';
  if (q.style !== 'paragraph') q.style = 'short';
  return q;
}, ticketQuestionSchema);

/** Questions : identifiants rendus uniques (deux libellés identiques → suffixe). */
const questionsField = jsonArray(questionInput, MAX_TYPE_QUESTIONS).transform((list) => {
  const seen = new Set<string>();
  return list.map((q) => {
    let id = q.id;
    for (let i = 2; seen.has(id); i++) id = `${q.id.slice(0, 28)}-${i}`;
    seen.add(id);
    return { ...q, id };
  });
});

const reasonBody = z.object({
  label: z.string().trim().min(1, 'nom requis').max(80),
  emoji: optionalText(64),
  description: optionalText(100),
  enabled: checkbox,
  nameFormat: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().min(1).max(60).default('ticket-{number}')),
  maxPerUser: z.coerce.number().int().min(1).max(25).default(1),
  categoryId: optionalDiscordId,
  archiveCategoryId: optionalDiscordId,
  staffRoleIds: discordIdArray.pipe(z.array(discordIdSchema).max(25)),
  questionsJson: questionsField,
  welcomeMessage: optionalText(2000),
  embedMode: z.enum(['default', 'custom']).default('default'),
  embed: embedFormOptional,
});
type ReasonBody = z.infer<typeof reasonBody>;

const orderBody = z.object({
  order: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.coerce.number().int().positive()).min(1).max(100)),
});

const toggleBody = z.object({ enabled: checkbox });

const panelBody = z.object({
  channelId: discordIdSchema,
  style: z.nativeEnum(PanelStyle),
  typeIds: z.preprocess((v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int().positive()).max(25)),
  embed: embedFormOptional,
  /** « Version anglaise » du panneau (embed + libellés des raisons) */
  english: checkbox,
});

/** Réglages des tickets (table TicketSettings) : relances automatiques + catégorie « Tickets fermés ». */
const remindersBody = z.object({
  remindersEnabled: checkbox,
  reminderHours: z.coerce.number().int().min(1, 'minimum 1 h').max(168, 'maximum 168 h (7 jours)'),
  reminderPing: z.enum(REMINDER_PING_MODES),
  closedCategoryId: optionalDiscordId,
});

const permanentBody = z.object({ enabled: checkbox });
const closeBody = z.object({ reason: optionalText(500) });
const transcriptParams = idParams.extend({ format: z.enum(['html', 'txt', 'pdf']) });

// ───── Aides ─────

function reasonPatch(body: ReasonBody) {
  return {
    label: body.label,
    emoji: body.emoji ?? null,
    description: body.description ?? null,
    enabled: body.enabled,
    nameFormat: body.nameFormat,
    maxPerUser: body.maxPerUser,
    categoryId: body.categoryId,
    archiveCategoryId: body.archiveCategoryId,
    staffRoleIds: [...new Set(body.staffRoleIds)],
    questions: body.questionsJson,
    welcomeMessage: body.welcomeMessage ?? null,
    embed: body.embedMode === 'custom' ? toEmbedSpec(body.embed) : null,
  };
}

/** Textes Discord (langue du bot) utilisés par les aperçus : boutons, panneaux, message d'ouverture, relances. */
function discordTexts(t: Translator) {
  return {
    buttons: {
      close: t('tickets.buttons.close'),
      transcript: t('tickets.buttons.transcript'),
      add: t('tickets.buttons.add'),
      remove: t('tickets.buttons.remove'),
      transfer: t('tickets.buttons.transfer'),
      delete: t('tickets.buttons.delete'),
      permanent: t('ticket_reminders.btn_unmuted_control'),
      permanentOn: t('ticket_reminders.btn_muted_control'),
    },
    closed: {
      title: t('tickets.closed.title', { number: '{number}' }),
      description: t('tickets.closed.description', { user: '{user}' }),
      hint: t('tickets.closed.hint'),
      transcript: t('tickets.closed.btn_transcript'),
      transcriptSent: t('tickets.closed.btn_transcript_sent'),
      reopen: t('tickets.closed.btn_reopen'),
      delete: t('tickets.closed.btn_delete'),
    },
    panel: { open: t('tickets.panel.open_button'), placeholder: t('tickets.panel.select_placeholder'), pick: t('tickets.panel.pick_prompt') },
    open: {
      title: t('tickets.open.title', { emoji: '{emoji}', number: '{number}', type: '{type}' }),
      description: t('tickets.open.description', { user: '{user}' }),
      staffPing: t('tickets.open.staff_ping', { roles: '{roles}', user: '{user}' }),
      fieldUser: t('tickets.open.field_user'),
      fieldType: t('tickets.open.field_type'),
      fieldStatus: t('tickets.open.field_status'),
      statusOpen: t('tickets.status.OPEN'),
      fieldTitle: t('tickets.open.field_title'),
      modalTitle: t('tickets.open.modal_title', { emoji: '{emoji}', type: '{type}' }),
      titleLabel: t('tickets.open.modal_title_label'),
      titlePlaceholder: t('tickets.open.modal_title_placeholder'),
      messageLabel: t('tickets.open.modal_message_label'),
      messagePlaceholder: t('tickets.open.modal_message_placeholder'),
    },
    reminders: {
      title: t('ticket_reminders.title'),
      description: t('ticket_reminders.description', { duration: '{duration}', since: '{since}', hours: '{hours}' }),
      footer: t('ticket_reminders.footer', { hours: '{hours}' }),
      mute: t('ticket_reminders.btn_mute'),
    },
    footer: BRAND.footer,
  };
}

/**
 * Champs de la fenêtre d'ouverture (aperçu) : titre, questions de la raison, message facultatif s'il reste une place —
 * même composition que le bot (`planOpenModal`).
 */
export function openModalFields(questions: unknown[], texts: ReturnType<typeof discordTexts>) {
  const plan = planOpenModal(questions);
  return [
    { label: texts.open.titleLabel, placeholder: texts.open.titlePlaceholder, style: 'short', required: true, maxLength: TICKET_TITLE_MAX },
    ...plan.questions,
    ...(plan.message ? [{ label: texts.open.messageLabel, placeholder: texts.open.messagePlaceholder, style: 'paragraph', required: false, maxLength: TICKET_MESSAGE_MAX }] : []),
  ];
}

function translator(res: Response): Translator {
  return translationService.bind(res.locals.config?.defaultLanguage ?? 'fr', res.locals.guild?.id);
}

async function loadTicket(guildId: string, ticketId: number) {
  const ticket = await ticketService.getTicket(ticketId);
  if (!ticket || ticket.guildId !== guildId) throw new HttpError(404, 'Ticket introuvable.');
  return ticket;
}

async function loadType(guildId: string, typeId: number): Promise<TicketType> {
  const type = await ticketService.getType(guildId, typeId);
  if (!type) throw new HttpError(404, 'Raison de ticket introuvable.');
  return type;
}

/** Tickets permanents (relances coupées) parmi les tickets ouverts — parcours paginé du service. */
async function permanentTickets(guildId: string) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const list = await ticketService.listTickets(guildId, { status: 'open' }, page, 50);
    out.push(...(list?.items ?? []).filter((t) => t.remindersMuted));
    if (!list || page >= list.pages) break;
  }
  return out;
}

/** Compteurs des onglets (raisons, panneaux, tickets ouverts). */
async function tabCounts(guildId: string) {
  const [types, panels, open] = await Promise.all([ticketService.listTypes(guildId), ticketService.listPanels(guildId), ticketService.listTickets(guildId, { status: 'open' }, 1, 1)]);
  return { reasons: (types ?? []).length, panels: (panels ?? []).length, open: open?.total ?? 0, types: types ?? [], panelList: panels ?? [] };
}

/**
 * Tickets : raisons (éditeur avec aperçus Discord), panneaux, relances, liste / fiche des tickets, statistiques.
 * Toutes les opérations passent par ticketService / ticketReminderService / transcriptService.
 */
export function createTicketsRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/tickets`;
  const ticketBack = (req: { params: Record<string, string> }, res: Response) => `${base(res.locals.guild!.id)}/${req.params.ticketId}`;

  // ───── Raisons ─────

  router.get(
    '/tickets',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const [counts, stats] = await Promise.all([tabCounts(guild.id), ticketService.getStats(guild.id)]);
      const byType = new Map((stats?.byType ?? []).map((b) => [b.typeId, b.count]));
      render(res, 'tickets-reasons', {
        title: 'Tickets',
        page: 'tickets',
        tab: 'reasons',
        counts,
        reasons: counts.types.map((t) => ({ ...t, staff: asStringArray(t.staffRoleIds), questionCount: parseQuestions(t.questions).length, ticketCount: byType.get(t.id) ?? 0 })),
        moduleEnabled: config.modules.tickets,
        defaultsAvailable: DEFAULT_TICKET_TYPES.length,
      });
    }),
  );

  const renderEditor = async (res: Response, type: TicketType | null) => {
    const guild = res.locals.guild!;
    const config = res.locals.config!;
    const t = translator(res);
    const counts = await tabCounts(guild.id);
    const spec = type ? parseEmbedSpec(type.embed) : null;
    const questions = type ? parseQuestions(type.questions) : [{ id: 'details', label: t('tickets.defaults.question_label').slice(0, 45), placeholder: t('tickets.defaults.question_placeholder').slice(0, 100), style: 'paragraph', required: true, maxLength: 1000 }];
    const texts = discordTexts(t);
    render(res, 'ticket-reason', {
      title: type ? `Raison · ${type.label}` : 'Nouvelle raison',
      page: 'tickets',
      layout: 'wide',
      crumbs: [{ label: 'Raisons', href: base(guild.id) }, { label: type ? type.label : 'Nouvelle raison' }],
      type,
      counts,
      questions,
      maxQuestions: MAX_TYPE_QUESTIONS,
      modalFields: openModalFields(questions, texts),
      embed: spec,
      staffRoleIds: type ? asStringArray(type.staffRoleIds) : [],
      texts,
      globalStaffRoleIds: [...new Set([...config.staffRoleIds, ...config.adminRoleIds])],
      scripts: ['tickets'],
    });
  };

  router.get('/tickets/reasons/new', wrap(async (_req, res) => renderEditor(res, null)));

  router.get(
    '/tickets/reasons/:typeId(\\d+)',
    validate({ params: typeParams }),
    wrap(async (req, res) => {
      const { params } = valid<unknown, unknown, z.infer<typeof typeParams>>(req);
      await renderEditor(res, await loadType(res.locals.guild!.id, params.typeId));
    }),
  );

  router.post(
    '/tickets/reasons/defaults',
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const created = await ticketService.ensureDefaultTypes(guild.id, res.locals.config!.defaultLanguage);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'types' });
        flash(req, created ? 'success' : 'info', created ? `${created} raisons par défaut créées.` : 'Des raisons existent déjà : aucune raison ajoutée.');
      },
    ),
  );

  router.post(
    '/tickets/reasons/order',
    validate({ body: orderBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof orderBody>>(req);
      const types = await ticketService.listTypes(guild.id);
      const known = new Map(types.map((t) => [t.id, t]));
      const ids = body.order.filter((id, i, arr) => known.has(id) && arr.indexOf(id) === i);
      // Raisons absentes de la liste reçue : conservées après, dans leur ordre actuel
      for (const t of types) if (!ids.includes(t.id)) ids.push(t.id);
      let changed = 0;
      for (const [index, id] of ids.entries()) {
        if (known.get(id)!.order === index) continue;
        await ticketService.updateType(guild.id, id, { order: index });
        changed++;
      }
      broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'order' });
      if (wantsJson(req)) return res.json({ ok: true, changed, order: ids });
      flash(req, 'success', 'Ordre des raisons enregistré.');
      res.redirect(base(guild.id));
    }),
  );

  router.post(
    '/tickets/reasons',
    validate({ body: reasonBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/reasons/new`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<ReasonBody>(req);
        const existing = await ticketService.listTypes(guild.id);
        const key = uniqueKey(body.label, existing.map((t) => t.key));
        const type = await ticketService.upsertType(guild.id, { key, ...reasonPatch(body), order: existing.length });
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'type', typeId: type.id });
        flash(req, 'success', `Raison « ${type.label} » créée.`);
        return `${base(guild.id)}/reasons/${type.id}`;
      },
    ),
  );

  router.post(
    '/tickets/reasons/:typeId(\\d+)',
    validate({ body: reasonBody, params: typeParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/reasons/${req.params.typeId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body, params } = valid<ReasonBody, unknown, z.infer<typeof typeParams>>(req);
        await loadType(guild.id, params.typeId);
        const type = await ticketService.updateType(guild.id, params.typeId, reasonPatch(body));
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'type', typeId: type.id });
        flash(req, 'success', `Raison « ${type.label} » enregistrée.`);
      },
    ),
  );

  router.post(
    '/tickets/reasons/:typeId(\\d+)/toggle',
    validate({ params: typeParams, body: toggleBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof toggleBody>, unknown, z.infer<typeof typeParams>>(req);
        await loadType(guild.id, params.typeId);
        const type = await ticketService.updateType(guild.id, params.typeId, { enabled: body.enabled });
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'type', typeId: type.id });
        if (wantsJson(req)) {
          res.json({ ok: true, enabled: type.enabled });
          return;
        }
        flash(req, 'success', `Raison « ${type.label} » ${type.enabled ? 'activée' : 'désactivée'}.`);
      },
    ),
  );

  router.post(
    '/tickets/reasons/:typeId(\\d+)/delete',
    validate({ params: typeParams }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof typeParams>>(req);
        const type = await ticketService.deleteType(guild.id, params.typeId);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'type', typeId: type.id });
        flash(req, 'success', `Raison « ${type.label} » supprimée. Les tickets existants sont conservés.`);
        return base(guild.id);
      },
    ),
  );

  // ───── Panneaux ─────

  router.get(
    '/tickets/panels',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const t = translator(res);
      const counts = await tabCounts(guild.id);
      const enabled = counts.types.filter((x) => x.enabled);
      render(res, 'tickets-panels', {
        title: 'Panneaux de tickets',
        page: 'tickets',
        tab: 'panels',
        crumbs: [{ label: 'Panneaux' }],
        counts,
        reasons: enabled.map((x) => ({ id: x.id, label: x.label, emoji: x.emoji, description: x.description })),
        panels: counts.panelList.map((p) => {
          const ids = (Array.isArray(p.typeIds) ? (p.typeIds as unknown[]) : []).map(Number);
          const spec = parseEmbedSpec(p.embed);
          return {
            ...p,
            spec,
            reasons: (ids.length ? ids.map((id) => counts.types.find((x) => x.id === id)).filter((x): x is TicketType => Boolean(x)) : enabled).map((x) => ({ id: x.id, label: x.label, emoji: x.emoji, description: x.description })),
            allReasons: !ids.length,
            channelName: guild.textChannels.find((c) => c.id === p.channelId)?.name ?? null,
          };
        }),
        defaultEmbed: ticketService.defaultPanelEmbed(t),
        texts: discordTexts(t),
        moduleEnabled: config.modules.tickets,
        guildEnglish: config.autoTranslate?.enabled ?? false,
        scripts: ['translate-preview', 'tickets'],
      });
    }),
  );

  router.post(
    '/tickets/panels',
    validate({ body: panelBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/panels`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const config = res.locals.config!;
        const { body } = valid<z.infer<typeof panelBody>>(req);
        const guild = requireBotGuild(client, guildView.id);
        const channel = guild.channels.cache.get(body.channelId);
        if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) throw new HttpError(400, 'Salon invalide : choisissez un salon texte ou d’annonces.');
        const types = await ticketService.listTypes(guildView.id, { enabledOnly: true });
        if (!types.length) throw new HttpError(400, 'Créez au moins une raison activée avant de publier un panneau.');
        const typeIds = body.typeIds.filter((id) => types.some((t) => t.id === id));
        const panel = await ticketService.createPanel({ guild, channel: channel as TextChannel | NewsChannel, style: body.style, typeIds, embed: toEmbedSpec(body.embed), lang: config.defaultLanguage, brandColor: config.brandColor, english: body.english });
        broadcastToGuild(guildView.id, 'ticket:update', { guildId: guildView.id, action: 'panel', panelId: panel.id });
        flash(req, 'success', `Panneau publié dans #${channel.name}.`);
      },
    ),
  );

  router.post(
    '/tickets/panels/:panelId(\\d+)/republish',
    validate({ params: panelParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/panels`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof panelParams>>(req);
        const guild = requireBotGuild(client, guildView.id);
        const panel = await ticketService.getPanel(params.panelId);
        if (!panel || panel.guildId !== guildView.id) throw new HttpError(404, 'Panneau introuvable.');
        // Ancien message retiré (au mieux) avant de republier, pour éviter les doublons dans le salon
        const channel = guild.channels.cache.get(panel.channelId);
        if (panel.messageId && channel && 'messages' in channel) await channel.messages.delete(panel.messageId).catch(() => null);
        const updated = await ticketService.republishPanel(panel.id);
        if (!updated) throw new HttpError(400, 'Salon du panneau introuvable ou inaccessible pour le bot.');
        broadcastToGuild(guildView.id, 'ticket:update', { guildId: guildView.id, action: 'panel', panelId: panel.id });
        flash(req, 'success', 'Panneau republié (message mis à jour avec les raisons actuelles).');
      },
    ),
  );

  router.post(
    '/tickets/panels/:panelId(\\d+)/delete',
    validate({ params: panelParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/panels`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof panelParams>>(req);
        await ticketService.deletePanel(guild.id, params.panelId);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'panel', panelId: params.panelId });
        flash(req, 'success', 'Panneau supprimé (message Discord retiré si possible).');
      },
    ),
  );

  // ───── Relances ─────

  router.get(
    '/tickets/reminders',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const t = translator(res);
      const [counts, settings, permanent] = await Promise.all([tabCounts(guild.id), ticketReminderService.getSettings(guild.id), permanentTickets(guild.id)]);
      const profiles = await resolveUserProfiles(client, guild.id, permanent.map((x) => x.userId));
      const botGuild = client.isReady() ? client.guilds.cache.get(guild.id) : null;
      const defaultClosed = botGuild?.channels.cache.get(DEFAULT_CLOSED_CATEGORY_ID);
      render(res, 'tickets-reminders', {
        title: 'Réglages des tickets',
        page: 'tickets',
        tab: 'reminders',
        crumbs: [{ label: 'Réglages' }],
        counts,
        settings: { ...settings, reminderPing: normalizeReminderPing(settings.reminderPing) },
        defaultClosedCategory: defaultClosed && defaultClosed.type === ChannelType.GuildCategory ? { id: defaultClosed.id, name: defaultClosed.name } : null,
        permanent,
        profiles,
        pingModes: REMINDER_PING_MODES.map((m) => ({ value: m, ...REMINDER_PING_LABELS[m] })),
        texts: discordTexts(t),
        globalStaffRoleIds: [...new Set([...res.locals.config!.staffRoleIds])],
        scripts: ['tickets'],
      });
    }),
  );

  router.post(
    '/tickets/reminders',
    validate({ body: remindersBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/reminders`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof remindersBody>>(req);
        await ticketReminderService.updateSettings(guild.id, body);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'reminders' });
        flash(req, 'success', `${body.remindersEnabled ? `Relances activées : toutes les ${body.reminderHours} h sans réponse du staff.` : 'Relances automatiques désactivées.'} Catégorie des tickets fermés ${body.closedCategoryId ? 'enregistrée' : 'par défaut'}.`);
      },
    ),
  );

  // ───── Liste des tickets ─────

  router.get(
    '/tickets/list',
    validate({ query: listQuery }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { query } = valid<unknown, z.infer<typeof listQuery>>(req);
      const [counts, list] = await Promise.all([tabCounts(guild.id), ticketService.listTickets(guild.id, { status: query.status, typeId: query.type, userId: query.user, search: query.q || undefined }, query.page, PAGE_SIZE)]);
      const profiles = await resolveUserProfiles(client, guild.id, list.items.map((t) => t.userId));
      const baseQuery = new URLSearchParams({ ...(query.status ? { status: query.status } : {}), ...(query.type ? { type: String(query.type) } : {}), ...(query.user ? { user: query.user } : {}), ...(query.q ? { q: query.q } : {}) }).toString();
      render(res, 'tickets-list', {
        title: 'Tickets',
        page: 'tickets',
        tab: 'list',
        crumbs: [{ label: 'Liste' }],
        counts,
        filters: query,
        tickets: list.items,
        profiles,
        pagination: { page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize },
        baseQuery,
        statusLabels: TICKET_STATUS_LABELS,
      });
    }),
  );

  // ───── Statistiques ─────

  router.get(
    '/tickets/stats',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const [counts, stats, response, daily, closers] = await Promise.all([
        tabCounts(guild.id),
        ticketService.getStats(guild.id),
        firstResponseStats(guild.id),
        dailyActivity(guild.id, config.timezone, 14),
        topClosers(guild.id, 5),
      ]);
      const profiles = await resolveUserProfiles(client, guild.id, closers.map((c) => c.userId));
      render(res, 'tickets-stats', {
        title: 'Statistiques des tickets',
        page: 'tickets',
        tab: 'stats',
        crumbs: [{ label: 'Statistiques' }],
        counts,
        stats,
        byType: [...(stats?.byType ?? [])].sort((a, b) => b.count - a.count).map((b) => ({ ...b, emoji: counts.types.find((x) => x.id === b.typeId)?.emoji ?? null })),
        response,
        daily,
        activityChart: lineChart('chart-ticket-activity', { keys: daily.map((d) => d.key), short: daily.map((d) => d.label), long: daily.map((d) => d.label) }, [
          { key: 'opened', label: 'Ouverts', slot: 1, values: daily.map((d) => d.opened) },
          { key: 'closed', label: 'Fermés', slot: 2, values: daily.map((d) => d.closed) },
        ]),
        closers: closers.map((c) => ({ ...c, profile: profiles[c.userId] ?? null })),
      });
    }),
  );

  // ───── Fiche ticket ─────

  router.get(
    '/tickets/:ticketId(\\d+)',
    validate({ params: idParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const ticket = await loadTicket(guild.id, params.ticketId);
      const participants = asStringArray(ticket.participants);
      const staffIds = asStringArray(ticket.transcript?.staffIds);
      const profiles = await resolveUserProfiles(client, guild.id, [ticket.userId, ticket.closedById, ...participants, ...staffIds]);
      const transcript = ticket.transcript;
      const formats = transcript ? (['html', 'txt', 'pdf'] as const).filter((f) => Boolean(transcript[`${f}Path`])) : [];
      const channelExists = client.isReady() ? Boolean(client.guilds.cache.get(guild.id)?.channels.cache.has(ticket.channelId)) : false;
      const isOpen = isTicketOpen(ticket);
      const end = ticket.closedAt ?? new Date();
      render(res, 'ticket', {
        title: `Ticket #${ticket.number}`,
        page: 'tickets',
        crumbs: [{ label: 'Liste', href: `${base(guild.id)}/list` }, { label: `#${ticket.number}` }],
        ticket,
        answers: asFormAnswers(ticket.formAnswers),
        participants,
        staffIds,
        profiles,
        formats,
        channelExists,
        isOpen,
        durationSeconds: transcript?.durationSeconds || Math.max(0, Math.floor((end.getTime() - new Date(ticket.createdAt).getTime()) / 1000)),
        statusLabels: TICKET_STATUS_LABELS,
      });
    }),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/close',
    validate({ params: idParams, body: closeBody }),
    formAction(ticketBack, async (req, res) => {
      const guild = res.locals.guild!;
      const { params, body } = valid<z.infer<typeof closeBody>, unknown, z.infer<typeof idParams>>(req);
      const existing = await loadTicket(guild.id, params.ticketId);
      await ticketService.closeTicket({ ticketId: params.ticketId, closedById: req.session.user!.id, reason: body.reason ?? null });
      flash(req, 'success', `Ticket #${existing.number} fermé : salon conservé, le membre n’y a plus accès.`);
    }),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/reopen',
    validate({ params: idParams }),
    formAction(ticketBack, async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const existing = await loadTicket(guild.id, params.ticketId);
      if (isTicketOpen(existing)) throw new HttpError(400, 'Ce ticket est déjà ouvert.');
      await ticketService.reopenTicket({ ticketId: params.ticketId, byId: req.session.user!.id });
      flash(req, 'success', `Ticket #${existing.number} rouvert : le membre a de nouveau accès au salon.`);
    }),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/transcript',
    validate({ params: idParams }),
    formAction(ticketBack, async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const existing = await loadTicket(guild.id, params.ticketId);
      if (isTicketOpen(existing)) throw new HttpError(400, 'Ce ticket est ouvert : fermez-le d’abord.');
      const { dm } = await ticketService.sendClosedTranscript({ ticketId: params.ticketId, byId: req.session.user!.id });
      flash(req, dm === 'sent' ? 'success' : 'warning', dm === 'sent' ? `Transcript du ticket #${existing.number} enregistré et envoyé en DM au membre.` : `Transcript du ticket #${existing.number} enregistré, mais le DM au membre a échoué (messages privés fermés ou membre parti).`);
    }),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/permanent',
    validate({ params: idParams, body: permanentBody }),
    formAction(
      (req, res) => (typeof req.query.back === 'string' && req.query.back === 'reminders' ? `${base(res.locals.guild!.id)}/reminders` : ticketBack(req as never, res)),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof permanentBody>, unknown, z.infer<typeof idParams>>(req);
        const ticket = await loadTicket(guild.id, params.ticketId);
        if (!isTicketOpen(ticket)) throw new HttpError(400, 'Ce ticket est fermé : les relances ne le concernent plus.');
        await ticketReminderService.setMuted(ticket.id, body.enabled);
        // Mise à jour du bouton 📌 dans Discord + message d'information (au mieux)
        const channel = client.isReady() ? client.channels.cache.get(ticket.channelId) : null;
        if (channel && channel.type === ChannelType.GuildText) {
          await ticketService.refreshControlMessage({ ...ticket, remindersMuted: body.enabled }, channel as TextChannel).catch(() => null);
          const t = translationService.bind(ticket.language ?? res.locals.config!.defaultLanguage, guild.id);
          await (channel as TextChannel).send({ content: t(body.enabled ? 'ticket_reminders.muted_notice' : 'ticket_reminders.unmuted_notice', { user: `<@${req.session.user!.id}>` }), allowedMentions: { parse: [] } }).catch(() => null);
        }
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, ticketId: ticket.id, action: 'permanent' });
        flash(req, 'success', body.enabled ? `Ticket #${ticket.number} marqué permanent : plus de relance automatique.` : `Relances réactivées pour le ticket #${ticket.number}.`);
      },
    ),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/delete',
    validate({ params: idParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/list`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const existing = await loadTicket(guild.id, params.ticketId);
        await ticketService.deleteTicket({ ticketId: params.ticketId, byId: req.session.user!.id });
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, ticketId: params.ticketId, action: 'delete' });
        flash(req, 'success', existing.transcript ? `Ticket #${existing.number} supprimé (transcript conservé).` : `Ticket #${existing.number} supprimé (aucun transcript n’avait été généré).`);
      },
    ),
  );

  // ───── Transcripts (fichiers servis depuis uploads/transcripts/<guildId>/) ─────

  router.get(
    '/tickets/:ticketId(\\d+)/transcript/:format',
    validate({ params: transcriptParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof transcriptParams>>(req);
      const ticket = await loadTicket(guild.id, params.ticketId);
      const stored = ticket.transcript?.[`${params.format}Path`];
      if (!stored) throw new HttpError(404, 'Transcript indisponible pour ce ticket.');
      const allowedDir = path.resolve(transcriptService.directory, guild.id);
      const absolute = path.resolve(stored);
      if (!absolute.startsWith(allowedDir + path.sep)) throw new HttpError(403, 'Chemin de transcript invalide.');
      if (!/^ticket-\d+\.(html|txt|pdf)$/.test(path.basename(absolute)) || !absolute.endsWith(`.${params.format}`)) throw new HttpError(403, 'Chemin de transcript invalide.');
      try {
        await fs.promises.access(absolute, fs.constants.R_OK);
      } catch {
        throw new HttpError(404, 'Le fichier du transcript est introuvable sur le disque.');
      }
      const download = req.query.download === '1';
      const types = { html: 'text/html; charset=utf-8', txt: 'text/plain; charset=utf-8', pdf: 'application/pdf' } as const;
      res.setHeader('Content-Type', types[params.format]);
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="ticket-${ticket.number}.${params.format}"`);
      // Le transcript HTML embarque ses propres styles : CSP dédiée (aucun script) ; intégrable uniquement par le dashboard (iframe sandbox).
      if (params.format === 'html') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; frame-ancestors 'self'");
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      }
      res.setHeader('X-Robots-Tag', 'noindex');
      await new Promise<void>((resolve, reject) => {
        res.sendFile(absolute, (err) => (err ? reject(err) : resolve()));
      });
    }),
  );

  return router;
}
