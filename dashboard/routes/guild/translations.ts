import { Router } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import { translationService } from '../../../src/services/TranslationService';
import { loggingService } from '../../../src/services/LoggingService';
import { LANGUAGES, LANGUAGE_CODES } from '../../../src/config/constants';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { validate, valid, pageQuery } from '../../lib/validate';
import { wantsJson } from '../../lib/rateLimit';

const PAGE_SIZE = 100;
const languageCode = z.enum(LANGUAGE_CODES as [string, ...string[]]);
const listQuery = z.object({
  lang: languageCode.optional(),
  q: z.string().trim().max(100).optional().default(''),
  only: z.enum(['all', 'overrides']).optional().default('all'),
  page: pageQuery,
});
const upsertBody = z.object({
  lang: languageCode,
  key: z.string().trim().min(1).max(191).regex(/^[\w.-]+$/, 'clé invalide'),
  value: z.string().max(4000),
  _action: z.enum(['save', 'delete']).optional().default('save'),
});

export interface TranslationRow {
  key: string;
  defaultValue: string;
  globalOverride: string | null;
  override: string | null;
}

/** Fusionne catalogue + overrides et filtre (fonction pure, testable). */
export function buildTranslationRows(catalog: Record<string, string>, globalOverrides: Record<string, string>, overrides: Record<string, string>, q: string, only: 'all' | 'overrides'): TranslationRow[] {
  const keys = new Set([...Object.keys(catalog), ...Object.keys(overrides), ...Object.keys(globalOverrides)]);
  const needle = q.toLowerCase();
  const rows: TranslationRow[] = [];
  for (const key of [...keys].sort()) {
    const row: TranslationRow = { key, defaultValue: catalog[key] ?? '', globalOverride: globalOverrides[key] ?? null, override: overrides[key] ?? null };
    if (only === 'overrides' && row.override === null) continue;
    if (needle && !key.toLowerCase().includes(needle) && !row.defaultValue.toLowerCase().includes(needle) && !(row.override ?? '').toLowerCase().includes(needle)) continue;
    rows.push(row);
  }
  return rows;
}

/** GET/POST /guilds/:guildId/translations (+ /translations/export). */
export function createTranslationsRouter(_client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/translations',
    validate({ query: listQuery }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof listQuery>>(req);
      const lang = query.lang ?? config.defaultLanguage;
      const [overrides, globalOverrides] = await Promise.all([translationService.loadOverrides(guild.id, lang), translationService.loadOverrides(null, lang)]);
      const catalog = translationService.getCatalog(lang);
      const all = buildTranslationRows(catalog, globalOverrides, overrides, query.q, query.only);
      const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      const page = Math.min(query.page, pages);
      const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      render(res, 'translations', {
        title: 'Traductions',
        page: 'translations',
        lang,
        languages: LANGUAGES,
        enabledLanguages: config.enabledLanguages,
        q: query.q,
        only: query.only,
        rows,
        totalKeys: Object.keys(catalog).length,
        overrideCount: Object.keys(overrides).length,
        pagination: { page, pages, total: all.length, pageSize: PAGE_SIZE },
        baseQuery: new URLSearchParams({ lang, ...(query.q ? { q: query.q } : {}), ...(query.only !== 'all' ? { only: query.only } : {}) }).toString(),
      });
    }),
  );

  router.post(
    '/translations',
    validate({ body: upsertBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof upsertBody>>(req);
      const catalogHasKey = body.key in translationService.getCatalog(body.lang) || body.key in translationService.getCatalog('en');
      if (body._action === 'delete') {
        await translationService.deleteOverride(guild.id, body.lang, body.key);
      } else {
        if (!catalogHasKey) {
          const msg = `La clé « ${body.key} » n'existe pas dans le catalogue.`;
          if (wantsJson(req)) return res.status(400).json({ error: msg });
          flash(req, 'error', msg);
          return res.redirect(`/guilds/${guild.id}/translations?lang=${body.lang}`);
        }
        await translationService.setOverride(guild.id, body.lang, body.key, body.value);
      }
      translationService.invalidateGuild(guild.id);
      void loggingService.log({ guildId: guild.id, category: 'SYSTEM', action: body._action === 'delete' ? 'translation.delete' : 'translation.set', title: `Traduction ${body._action === 'delete' ? 'réinitialisée' : 'personnalisée'} : ${body.key}`, actorId: req.session.user?.id ?? null, data: { lang: body.lang, key: body.key } });
      if (wantsJson(req)) return res.json({ ok: true, key: body.key, lang: body.lang, value: body._action === 'delete' ? null : body.value, defaultValue: translationService.getCatalog(body.lang)[body.key] ?? '' });
      flash(req, 'success', body._action === 'delete' ? `Override supprimé pour « ${body.key} ».` : `Traduction enregistrée pour « ${body.key} ».`);
      const back = typeof req.body.returnTo === 'string' && req.body.returnTo.startsWith(`/guilds/${guild.id}/translations`) ? req.body.returnTo : `/guilds/${guild.id}/translations?lang=${body.lang}`;
      res.redirect(back);
    }),
  );

  router.get(
    '/translations/export',
    validate({ query: z.object({ lang: languageCode.optional(), scope: z.enum(['merged', 'overrides']).optional().default('merged') }) }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, { lang?: string; scope: 'merged' | 'overrides' }>(req);
      const lang = query.lang ?? config.defaultLanguage;
      const overrides = await translationService.loadOverrides(guild.id, lang);
      const payload = query.scope === 'overrides' ? overrides : { ...translationService.getCatalog(lang), ...(await translationService.loadOverrides(null, lang)), ...overrides };
      res.setHeader('Content-Disposition', `attachment; filename="translations-${guild.id}-${lang}-${query.scope}.json"`);
      res.type('application/json').send(JSON.stringify(payload, null, 2));
    }),
  );

  return router;
}
