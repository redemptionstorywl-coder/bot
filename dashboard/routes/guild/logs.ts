import { Router } from 'express';
import { z } from 'zod';
import { LogCategory, type Prisma } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { guildConfigService } from '../../../src/services/GuildConfigService';
import { LOG_CATEGORY_LABELS } from '../../../src/config/constants';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { validate, valid, pageQuery } from '../../lib/validate';

const PAGE_SIZE = 25;
const CATEGORIES = Object.values(LogCategory) as LogCategory[];

const logsQuery = z.object({
  category: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(LogCategory).optional()),
  q: z.string().trim().max(100).optional().default(''),
  from: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ').optional()),
  to: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ').optional()),
  page: pageQuery,
});

const channelsBody = z.object({
  channels: z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.record(z.nativeEnum(LogCategory), z.string().regex(/^(\d{15,22})?$/, 'salon invalide'))),
});

/** GET /guilds/:guildId/logs (consultation + mapping) — POST /guilds/:guildId/logs/channels. */
export function createLogsRouter(_client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/logs',
    validate({ query: logsQuery }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof logsQuery>>(req);
      const where: Prisma.LogWhereInput = { guildId: guild.id };
      if (query.category) where.category = query.category;
      if (query.from || query.to) {
        where.createdAt = {};
        if (query.from) where.createdAt.gte = new Date(`${query.from}T00:00:00`);
        if (query.to) where.createdAt.lte = new Date(`${query.to}T23:59:59.999`);
      }
      if (query.q) {
        const isId = /^\d{15,22}$/.test(query.q);
        where.OR = isId ? [{ actorId: query.q }, { targetId: query.q }] : [{ action: { contains: query.q } }];
      }
      const [total, rows] = await Promise.all([prisma.log.count({ where }), prisma.log.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE })]);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const names = new Map<string, string>();
      if (_client.isReady()) {
        const g = _client.guilds.cache.get(guild.id);
        for (const row of rows) {
          for (const id of [row.actorId, row.targetId]) {
            if (!id || names.has(id)) continue;
            const member = g?.members.cache.get(id);
            const user = member?.user ?? _client.users.cache.get(id);
            if (user) names.set(id, member?.displayName ?? user.username);
          }
        }
      }
      render(res, 'logs', {
        title: 'Logs',
        page: 'logs',
        categories: CATEGORIES.map((c) => ({ value: c, label: LOG_CATEGORY_LABELS[c] ?? c, channelId: config.logChannels[c] ?? '' })),
        filters: query,
        logs: rows,
        names: Object.fromEntries(names),
        pagination: { page: query.page, pages, total, pageSize: PAGE_SIZE },
        baseQuery: new URLSearchParams({ ...(query.category ? { category: query.category } : {}), ...(query.q ? { q: query.q } : {}), ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) }).toString(),
      });
    }),
  );

  router.post(
    '/logs/channels',
    validate({ body: channelsBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof channelsBody>>(req);
      const validChannels = new Set(res.locals.guild!.textChannels.map((c) => c.id));
      for (const category of CATEGORIES) {
        const channelId = body.channels[category];
        if (channelId === undefined) continue;
        if (channelId && !validChannels.has(channelId)) {
          flash(req, 'error', `Salon inconnu pour la catégorie ${LOG_CATEGORY_LABELS[category] ?? category}.`);
          continue;
        }
        await guildConfigService.setLogChannel(guild.id, category, channelId || null);
      }
      flash(req, 'success', 'Salons de logs enregistrés.');
      res.redirect(`/guilds/${guild.id}/logs`);
    }),
  );

  return router;
}
