import { Router } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import { autoTranslateService } from '../../../src/services/AutoTranslateService';
import { translationService } from '../../../src/services/TranslationService';
import { embedSpecSchema, type EmbedSpec } from '../../../src/services/EmbedService';
import { bilingualLabel, bilingualOption, DISCORD_LIMITS, TRANSLATE_LAYOUTS } from '../../../src/services/autotranslate/bilingual';
import { wrap } from '../../lib/async';
import { createRateLimiter } from '../../lib/rateLimit';
import { validate, valid } from '../../lib/validate';

/** Embed saisi dans un éditeur : lu s'il est valide, ignoré sinon (aperçu indicatif, jamais d'erreur bloquante). */
const looseEmbed = z.preprocess((v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = embedSpecSchema.safeParse(v);
  return r.success && Object.keys(r.data).length ? r.data : undefined;
}, embedSpecSchema.optional());

const previewBody = z.object({
  content: z.string().max(2000).optional().default(''),
  embed: looseEmbed,
  layout: z.enum(TRANSLATE_LAYOUTS).optional(),
  /** Raisons d'un panneau de tickets (libellés « FR / EN » des menus) */
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(100), description: z.string().max(100).nullish() }))
    .max(25)
    .optional(),
});

export type TranslatePreviewBody = z.infer<typeof previewBody>;

/**
 * POST /guilds/:guildId/translate/preview (JSON, CSRF, limité à 20 requêtes / minute) : version bilingue d'un
 * message en cours d'édition, pour les aperçus live (annonces, embeds, bienvenue, panneaux de tickets).
 * Rien n'est enregistré ; les traductions alimentent le cache (l'envoi réel ne coûte alors plus rien).
 */
export function createTranslateRouter(_client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const limiter = createRateLimiter({ windowMs: 60_000, max: 20, keyGenerator: (req) => `translate:${req.session?.user?.id ?? req.ip ?? 'unknown'}` });

  router.post(
    '/translate/preview',
    limiter,
    validate({ body: previewBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { body } = valid<TranslatePreviewBody>(req);
      const embeds: EmbedSpec[] = body.embed ? [body.embed] : [];
      const localized = await autoTranslateService.localizeMessage(guild.id, { content: body.content || undefined, embeds }, { enabled: true, layout: body.layout });
      const response: Record<string, unknown> = {
        ok: true,
        translated: localized.translated,
        failed: localized.failed,
        layout: localized.layout,
        provider: autoTranslateService.describeProvider().label,
        message: { content: localized.content ?? '', embeds: localized.embeds },
      };
      if (body.options) {
        const labels = await autoTranslateService.translateLabels(body.options.flatMap((o) => [o.label, o.description ?? '']));
        const t = translationService.bind(config.defaultLanguage, guild.id);
        const en = translationService.bind('en', guild.id);
        const own = config.defaultLanguage === 'en';
        response.options = body.options.map((o, i) => bilingualOption({ label: o.label, description: o.description }, { label: labels[i * 2], description: labels[i * 2 + 1] }));
        response.panel = {
          open: own ? t('tickets.panel.open_button') : bilingualLabel(t('tickets.panel.open_button'), en('tickets.panel.open_button'), DISCORD_LIMITS.buttonLabel),
          placeholder: own ? t('tickets.panel.select_placeholder') : bilingualLabel(t('tickets.panel.select_placeholder'), en('tickets.panel.select_placeholder'), DISCORD_LIMITS.placeholder),
        };
      }
      res.json(response);
    }),
  );

  return router;
}
