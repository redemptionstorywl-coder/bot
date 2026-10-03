import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { ChannelType, type NewsChannel, type TextChannel } from 'discord.js';
import { PanelStyle, TicketStatus } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { ticketService, ticketQuestionSchema, parseQuestions, asFormAnswers, asStringArray, type TicketTypeInput } from '../../../src/services/TicketService';
import { transcriptService } from '../../../src/services/TranscriptService';
import { LANGUAGES, LANGUAGE_CODES } from '../../../src/config/constants';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdArray, optionalDiscordId, optionalText, checkbox, pageQuery, discordIdSchema } from '../../lib/validate';
import { jsonArray, embedJsonSchema, safeEmbedSpec } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserNames, requireBotGuild } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const PAGE_SIZE = 20;
const TABS = ['tickets', 'types', 'panels', 'stats'] as const;

export const TICKET_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Ouvert',
  CLAIMED: 'Pris en charge',
  CLOSED: 'Fermé',
  ARCHIVED: 'Archivé',
  DELETED: 'Supprimé',
};

const listQuery = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'tickets'), z.enum(TABS)),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.union([z.literal('open'), z.literal('closed'), z.nativeEnum(TicketStatus)]).optional()),
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
  if (q.placeholder === '' || q.placeholder === undefined) delete q.placeholder;
  if (q.maxLength === '' || q.maxLength === undefined || q.maxLength === null) delete q.maxLength;
  else q.maxLength = Number(q.maxLength);
  q.required = q.required === true || q.required === 'true' || q.required === 'on';
  if (!q.style) q.style = 'short';
  return q;
}, ticketQuestionSchema);

const typeBody = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,32}$/, 'clé : lettres minuscules, chiffres et tirets (2 à 32 caractères)'),
  label: z.string().trim().min(1, 'libellé requis').max(80),
  emoji: optionalText(64),
  description: optionalText(100),
  categoryId: optionalDiscordId,
  archiveCategoryId: optionalDiscordId,
  staffRoleIds: discordIdArray.pipe(z.array(discordIdSchema).max(25)),
  questionsJson: jsonArray(questionInput, 5),
  embedJson: embedJsonSchema,
  welcomeMessage: optionalText(2000),
  language: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.enum(LANGUAGE_CODES as [string, ...string[]]).nullable()),
  nameFormat: z.string().trim().min(1).max(60).default('ticket-{number}'),
  maxPerUser: z.coerce.number().int().min(1).max(25).default(1),
  enabled: checkbox,
  order: z.coerce.number().int().min(-1000).max(1000).default(0),
});

const panelBody = z.object({
  channelId: discordIdSchema,
  style: z.nativeEnum(PanelStyle),
  typeIds: z.preprocess((v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int().positive()).max(25)),
  embedJson: embedJsonSchema,
});

const closeBody = z.object({ reason: optionalText(500) });

const transcriptParams = idParams.extend({ format: z.enum(['html', 'txt', 'pdf']) });

function typeInputFromBody(body: z.infer<typeof typeBody>): TicketTypeInput {
  return {
    key: body.key,
    label: body.label,
    emoji: body.emoji ?? null,
    description: body.description ?? null,
    categoryId: body.categoryId,
    archiveCategoryId: body.archiveCategoryId,
    staffRoleIds: [...new Set(body.staffRoleIds)],
    questions: body.questionsJson,
    embed: body.embedJson,
    welcomeMessage: body.welcomeMessage ?? null,
    language: body.language,
    nameFormat: body.nameFormat,
    maxPerUser: body.maxPerUser,
    enabled: body.enabled,
    order: body.order,
  };
}

/** Pages Tickets : liste / fiche / types / panneaux / statistiques + transcripts protégés. */
export function createTicketsRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/tickets`;

  router.get(
    '/tickets',
    validate({ query: listQuery }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof listQuery>>(req);
      const [types, panels, list, stats] = await Promise.all([
        ticketService.listTypes(guild.id),
        ticketService.listPanels(guild.id),
        ticketService.listTickets(guild.id, { status: query.status, typeId: query.type, userId: query.user, search: query.q || undefined }, query.page, PAGE_SIZE),
        ticketService.getStats(guild.id),
      ]);
      const names = await resolveUserNames(client, guild.id, list.items.flatMap((t) => [t.userId, t.claimedById]));
      const baseQuery = new URLSearchParams({ tab: 'tickets', ...(query.status ? { status: query.status } : {}), ...(query.type ? { type: String(query.type) } : {}), ...(query.user ? { user: query.user } : {}), ...(query.q ? { q: query.q } : {}) }).toString();
      render(res, 'tickets', {
        title: 'Tickets',
        page: 'tickets',
        tab: query.tab,
        filters: query,
        types,
        panels: panels.map((p) => ({ ...p, typeLabels: (Array.isArray(p.typeIds) ? (p.typeIds as number[]) : []).map((id) => types.find((t) => t.id === id)?.label ?? `#${id}`) })),
        tickets: list.items,
        names,
        pagination: { page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize },
        baseQuery,
        stats,
        statusLabels: TICKET_STATUS_LABELS,
        languages: LANGUAGES,
        moduleEnabled: config.modules.tickets,
      });
    }),
  );

  // ───── Types ─────

  router.get(
    '/tickets/types/new',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const existing = await ticketService.listTypes(guild.id);
      render(res, 'ticket-type', { title: 'Nouveau type de ticket', page: 'tickets', type: null, questions: [], embed: null, nextOrder: existing.length, languages: LANGUAGES });
    }),
  );

  router.get(
    '/tickets/types/:typeId(\\d+)',
    validate({ params: typeParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof typeParams>>(req);
      const type = await ticketService.getType(guild.id, params.typeId);
      if (!type) throw new HttpError(404, 'Type de ticket introuvable.');
      render(res, 'ticket-type', { title: `Type · ${type.label}`, page: 'tickets', type, questions: parseQuestions(type.questions), embed: type.embed ? safeEmbedSpec(type.embed) : null, nextOrder: type.order, languages: LANGUAGES });
    }),
  );

  router.post(
    '/tickets/types/defaults',
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=types`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const created = await ticketService.ensureDefaultTypes(guild.id, res.locals.config!.defaultLanguage);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'types' });
        flash(req, created ? 'success' : 'info', created ? `${created} types de tickets par défaut créés.` : 'Des types existent déjà : aucun type ajouté.');
      },
    ),
  );

  router.post(
    '/tickets/types',
    validate({ body: typeBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/types/new`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof typeBody>>(req);
        if (await ticketService.getType(guild.id, body.key)) throw new HttpError(409, `Un type avec la clé « ${body.key} » existe déjà.`);
        const type = await ticketService.upsertType(guild.id, typeInputFromBody(body));
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'type', typeId: type.id });
        flash(req, 'success', `Type « ${type.label} » créé.`);
        return `${base(guild.id)}?tab=types`;
      },
    ),
  );

  router.post(
    '/tickets/types/:typeId(\\d+)',
    validate({ body: typeBody, params: typeParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/types/${req.params.typeId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body, params } = valid<z.infer<typeof typeBody>, unknown, z.infer<typeof typeParams>>(req);
        const existing = await ticketService.getType(guild.id, params.typeId);
        if (!existing) throw new HttpError(404, 'Type de ticket introuvable.');
        if (body.key !== existing.key) {
          const dup = await ticketService.getType(guild.id, body.key);
          if (dup && dup.id !== existing.id) throw new HttpError(409, `Un type avec la clé « ${body.key} » existe déjà.`);
        }
        const { key: _key, ...patch } = typeInputFromBody(body);
        const type = await ticketService.updateType(guild.id, params.typeId, patch);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'type', typeId: type.id });
        flash(req, 'success', `Type « ${type.label} » mis à jour.`);
        return `${base(guild.id)}?tab=types`;
      },
    ),
  );

  router.post(
    '/tickets/types/:typeId(\\d+)/delete',
    validate({ params: typeParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=types`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof typeParams>>(req);
        const type = await ticketService.deleteType(guild.id, params.typeId);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'type', typeId: type.id });
        flash(req, 'success', `Type « ${type.label} » supprimé. Les tickets existants sont conservés.`);
      },
    ),
  );

  // ───── Panneaux ─────

  router.post(
    '/tickets/panels',
    validate({ body: panelBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=panels`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const config = res.locals.config!;
        const { body } = valid<z.infer<typeof panelBody>>(req);
        const guild = requireBotGuild(client, guildView.id);
        const channel = guild.channels.cache.get(body.channelId);
        if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) throw new HttpError(400, 'Salon invalide : choisissez un salon texte ou d’annonces.');
        const types = await ticketService.listTypes(guildView.id, { enabledOnly: true });
        if (!types.length) throw new HttpError(400, 'Créez au moins un type de ticket activé avant de publier un panneau.');
        const typeIds = body.typeIds.filter((id) => types.some((t) => t.id === id));
        const panel = await ticketService.createPanel({ guild, channel: channel as TextChannel | NewsChannel, style: body.style, typeIds, embed: body.embedJson, lang: config.defaultLanguage, brandColor: config.brandColor });
        broadcastToGuild(guildView.id, 'ticket:update', { guildId: guildView.id, action: 'panel', panelId: panel.id });
        flash(req, 'success', `Panneau publié dans #${channel.name}.`);
      },
    ),
  );

  router.post(
    '/tickets/panels/:panelId(\\d+)/delete',
    validate({ params: panelParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=panels`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof panelParams>>(req);
        await ticketService.deletePanel(guild.id, params.panelId);
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, action: 'panel', panelId: params.panelId });
        flash(req, 'success', 'Panneau supprimé (message Discord retiré si possible).');
      },
    ),
  );

  // ───── Fiche ticket ─────

  router.get(
    '/tickets/:ticketId(\\d+)',
    validate({ params: idParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const ticket = await ticketService.getTicket(params.ticketId);
      if (!ticket || ticket.guildId !== guild.id) throw new HttpError(404, 'Ticket introuvable.');
      const participants = asStringArray(ticket.participants);
      const names = await resolveUserNames(client, guild.id, [ticket.userId, ticket.claimedById, ticket.closedById, ...participants]);
      const transcript = ticket.transcript;
      const formats = transcript ? (['html', 'txt', 'pdf'] as const).filter((f) => Boolean(transcript[`${f}Path`])) : [];
      const channelExists = client.isReady() ? Boolean(client.guilds.cache.get(guild.id)?.channels.cache.has(ticket.channelId)) : false;
      render(res, 'ticket', {
        title: `Ticket #${ticket.number}`,
        page: 'tickets',
        ticket,
        answers: asFormAnswers(ticket.formAnswers),
        participants,
        names,
        formats,
        channelExists,
        isOpen: ticket.status === TicketStatus.OPEN || ticket.status === TicketStatus.CLAIMED,
        statusLabels: TICKET_STATUS_LABELS,
      });
    }),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/close',
    validate({ params: idParams, body: closeBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.ticketId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof closeBody>, unknown, z.infer<typeof idParams>>(req);
        const existing = await ticketService.getTicket(params.ticketId);
        if (!existing || existing.guildId !== guild.id) throw new HttpError(404, 'Ticket introuvable.');
        await ticketService.closeTicket({ ticketId: params.ticketId, closedById: req.session.user!.id, reason: body.reason ?? null });
        flash(req, 'success', `Ticket #${existing.number} fermé.`);
      },
    ),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/claim',
    validate({ params: idParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.ticketId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const existing = await ticketService.getTicket(params.ticketId);
        if (!existing || existing.guildId !== guild.id) throw new HttpError(404, 'Ticket introuvable.');
        await ticketService.claimTicket({ ticketId: params.ticketId, staffId: req.session.user!.id });
        flash(req, 'success', `Ticket #${existing.number} pris en charge.`);
      },
    ),
  );

  router.post(
    '/tickets/:ticketId(\\d+)/delete',
    validate({ params: idParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=tickets`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const existing = await ticketService.getTicket(params.ticketId);
        if (!existing || existing.guildId !== guild.id) throw new HttpError(404, 'Ticket introuvable.');
        await ticketService.deleteTicket({ ticketId: params.ticketId, byId: req.session.user!.id });
        broadcastToGuild(guild.id, 'ticket:update', { guildId: guild.id, ticketId: params.ticketId, action: 'delete' });
        flash(req, 'success', `Ticket #${existing.number} supprimé (transcript conservé).`);
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
      const ticket = await ticketService.getTicket(params.ticketId);
      if (!ticket || ticket.guildId !== guild.id) throw new HttpError(404, 'Ticket introuvable.');
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
      // Le transcript HTML embarque ses propres styles : CSP dédiée (aucun script).
      if (params.format === 'html') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:");
      res.setHeader('X-Robots-Tag', 'noindex');
      await new Promise<void>((resolve, reject) => {
        res.sendFile(absolute, (err) => (err ? reject(err) : resolve()));
      });
    }),
  );

  return router;
}
