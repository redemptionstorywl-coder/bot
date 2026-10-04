import { Router } from 'express';
import { z } from 'zod';
import { ReviewStatus } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { whitelistService, whitelistQuestionSchema, parseAnswers, MAX_QUESTIONS } from '../../../src/services/WhitelistService';
import { fivemIdentifierSchema } from '../../../src/services/fivem/schemas';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, optionalDiscordId, optionalText, checkbox } from '../../lib/validate';
import { jsonArray } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserNames } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';
import { translationService } from '../../../src/services/TranslationService';
import { BRAND } from '../../../src/config/constants';
import { serviceMessagePreview, renderPreviewHtml } from '../../lib/servicePreview';

const TABS = ['applications', 'config'] as const;
const LIST_LIMIT = 200;

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = { PENDING: 'En attente', ACCEPTED: 'Acceptée', REJECTED: 'Refusée' };

const pageQuerySchema = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'applications'), z.enum(TABS)),
  status: z.preprocess((v) => (v === '' || v === undefined ? 'PENDING' : v === 'all' ? undefined : v), z.nativeEnum(ReviewStatus).optional()),
  q: z.string().trim().max(100).optional().default(''),
  id: z.preprocess((v) => (v === '' || v === undefined ? undefined : Number(v)), z.number().int().positive().optional()),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });
const reviewBody = z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']), note: optionalText(1000) });
const identifierBody = z.object({ identifier: fivemIdentifierSchema });

/** Question du formulaire : identifiant généré depuis le libellé s'il manque (même logique que les types de tickets). */
const questionInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const q = { ...(v as Record<string, unknown>) };
  if (typeof q.label === 'string') q.label = q.label.trim();
  if (typeof q.id !== 'string' || !q.id.trim()) {
    const base = typeof q.label === 'string' ? q.label.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) : '';
    q.id = base || `q${Math.random().toString(36).slice(2, 8)}`;
  }
  if (q.placeholder === '' || q.placeholder === undefined) delete q.placeholder;
  delete q.maxLength;
  q.required = q.required === true || q.required === 'true' || q.required === 'on';
  if (!q.style) q.style = 'paragraph';
  return q;
}, whitelistQuestionSchema);

const configBody = z.object({
  questionsJson: jsonArray(questionInput, MAX_QUESTIONS),
  reviewChannelId: optionalDiscordId,
  acceptedRoleId: optionalDiscordId,
  pendingRoleId: optionalDiscordId,
  dmOnDecision: checkbox,
  enabled: checkbox,
});

/** Pages Whitelist : dossiers (liste par statut, recherche, fiche, décision, identifiant) + configuration (questions, salon, rôles). */
export function createWhitelistRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/whitelist`;

  router.get(
    '/whitelist',
    validate({ query: pageQuerySchema }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof pageQuerySchema>>(req);
      const [settings, counts, rows, selected] = await Promise.all([
        whitelistService.getConfig(guild.id),
        whitelistService.counts(guild.id),
        whitelistService.list(guild.id, query.status, LIST_LIMIT),
        query.id ? whitelistService.getById(guild.id, query.id) : Promise.resolve(null),
      ]);
      if (query.id && !selected) throw new HttpError(404, 'Dossier introuvable.');
      const names = await resolveUserNames(client, guild.id, [...rows.map((r) => r.userId), selected?.userId, selected?.reviewedById, ...rows.map((r) => r.reviewedById)]);
      const q = query.q.toLowerCase();
      const applications = q
        ? rows.filter((r) => r.userId.includes(q) || String(r.id) === q || (r.identifier ?? '').toLowerCase().includes(q) || (names[r.userId] ?? '').toLowerCase().includes(q) || parseAnswers(r.answers).some((a) => a.answer.toLowerCase().includes(q)))
        : rows;
      const t = translationService.bind(config.defaultLanguage, guild.id);
      const reviewPreview = selected
        ? renderPreviewHtml(res, serviceMessagePreview({ embeds: [whitelistService.buildReviewEmbed(selected, config.defaultLanguage)], components: whitelistService.buildReviewButtons(selected, config.defaultLanguage, selected.status !== ReviewStatus.PENDING) }), names)
        : null;
      const dm = (accepted: boolean) =>
        renderPreviewHtml(res, {
          embed: {
            title: t(accepted ? 'whitelist.dm.accepted_title' : 'whitelist.dm.rejected_title'),
            description: `${t(accepted ? 'whitelist.dm.accepted' : 'whitelist.dm.rejected', { server: guild.name })}\n\n> ${accepted ? 'Bienvenue parmi nous !' : 'Merci de compléter votre candidature.'}`,
            color: `#${(accepted ? BRAND.colors.primary : BRAND.colors.danger).toString(16).padStart(6, '0')}`,
            footer: { text: BRAND.footer },
          },
        });
      render(res, 'whitelist', {
        title: 'Whitelist',
        page: 'whitelist',
        crumbs: query.tab === 'config' ? [{ label: 'Formulaire & réglages' }] : selected ? [{ label: `Dossier #${selected.id}` }] : [],
        scripts: query.tab === 'config' ? ['modal-preview'] : [],
        tab: query.tab,
        reviewPreview,
        dmPreviews: query.tab === 'config' ? { accepted: dm(true), rejected: dm(false) } : null,
        modalTitle: t('whitelist.apply.modal_title'),
        filters: { status: query.status ?? 'all', q: query.q },
        settings,
        counts,
        total: counts.PENDING + counts.ACCEPTED + counts.REJECTED,
        applications,
        selected: selected ? { ...selected, answers: parseAnswers(selected.answers) } : null,
        names,
        statusLabels: REVIEW_STATUS_LABELS,
        effectiveQuestions: whitelistService.resolveQuestions(settings, config.defaultLanguage),
        maxQuestions: MAX_QUESTIONS,
        moduleEnabled: config.modules.whitelist,
      });
    }),
  );

  router.post(
    '/whitelist/config',
    validate({ body: configBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=config`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof configBody>>(req);
        if (body.reviewChannelId && !guild.textChannels.some((c) => c.id === body.reviewChannelId)) throw new HttpError(400, 'Salon de review inconnu.');
        for (const roleId of [body.acceptedRoleId, body.pendingRoleId]) if (roleId && !guild.roles.some((r) => r.id === roleId)) throw new HttpError(400, 'Rôle inconnu.');
        const ids = body.questionsJson.map((q) => q.id);
        if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Les identifiants de questions doivent être uniques.');
        await whitelistService.updateConfig(guild.id, {
          questions: body.questionsJson,
          reviewChannelId: body.reviewChannelId,
          acceptedRoleId: body.acceptedRoleId,
          pendingRoleId: body.pendingRoleId,
          dmOnDecision: body.dmOnDecision,
          enabled: body.enabled,
        });
        broadcastToGuild(guild.id, 'whitelist:update', { guildId: guild.id, action: 'config' });
        flash(req, 'success', `Configuration whitelist enregistrée (${body.questionsJson.length ? `${body.questionsJson.length} question(s)` : 'questions par défaut'}).`);
      },
    ),
  );

  router.post(
    '/whitelist/applications/:id(\\d+)/review',
    validate({ params: idParams, body: reviewBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?id=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof reviewBody>, unknown, z.infer<typeof idParams>>(req);
        const row = await whitelistService.review({ guildId: guild.id, id: params.id, reviewerId: req.session.user!.id, decision: body.decision, note: body.note ?? null });
        broadcastToGuild(guild.id, 'whitelist:update', { guildId: guild.id, action: 'review', id: row.id, status: row.status });
        flash(req, 'success', `Dossier #${row.id} ${row.status === ReviewStatus.ACCEPTED ? 'accepté' : 'refusé'}.`);
        return `${base(guild.id)}?status=${row.status}&id=${row.id}`;
      },
    ),
  );

  router.post(
    '/whitelist/applications/:id(\\d+)/identifier',
    validate({ params: idParams, body: identifierBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?id=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof identifierBody>, unknown, z.infer<typeof idParams>>(req);
        const row = await whitelistService.getById(guild.id, params.id);
        if (!row) throw new HttpError(404, 'Dossier introuvable.');
        await whitelistService.setIdentifier(guild.id, row.userId, body.identifier);
        broadcastToGuild(guild.id, 'whitelist:update', { guildId: guild.id, action: 'identifier', id: row.id });
        flash(req, 'success', `Identifiant « ${body.identifier} » lié aux dossiers de ce membre.`);
        return `${base(guild.id)}?status=${row.status}&id=${row.id}`;
      },
    ),
  );

  return router;
}
