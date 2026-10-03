import { Router } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import { giveawayService, asStringArray } from '../../../src/services/GiveawayService';
import { LANGUAGES, LANGUAGE_CODES } from '../../../src/config/constants';
import { parseDuration } from '../../../src/utils/time';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema, optionalDiscordId, optionalText } from '../../lib/validate';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserNames, requireBotGuild } from '../../lib/names';
import { parseLocalDateTime, toLocalInputValue } from '../../lib/dates';
import { broadcastToGuild } from '../../sockets';

const idParams = z.object({ giveawayId: z.coerce.number().int().positive() });

const createBody = z.object({
  prize: z.string().trim().min(1, 'prix requis').max(190),
  description: optionalText(1000),
  endMode: z.enum(['duration', 'date']).default('duration'),
  duration: optionalText(32),
  endsAt: optionalText(32),
  winnersCount: z.coerce.number().int().min(1).max(50).default(1),
  channelId: discordIdSchema,
  requiredRoleId: optionalDiscordId,
  minMessages: z.coerce.number().int().min(0).max(100_000).default(0),
  language: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.enum(LANGUAGE_CODES as [string, ...string[]]).nullable()),
});

const rerollBody = z.object({ count: z.coerce.number().int().min(1).max(50).default(1) });

const END_REASONS: Record<string, string> = {
  not_found: 'Giveaway introuvable.',
  already_ended: 'Ce giveaway est déjà terminé.',
  not_ended: "Ce giveaway n'est pas encore terminé.",
};

/** Pages Giveaways : actifs / terminés, création, fin anticipée, reroll, annulation, détail participants. */
export function createGiveawaysRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/giveaways`;

  async function load(guildId: string, id: number) {
    const giveaway = await giveawayService.get(id);
    if (!giveaway || giveaway.guildId !== guildId) throw new HttpError(404, 'Giveaway introuvable.');
    return giveaway;
  }

  router.get(
    '/giveaways',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const all = await giveawayService.list(guild.id);
      const active = all.filter((g) => !g.ended);
      const ended = all.filter((g) => g.ended).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime()).slice(0, 50);
      const names = await resolveUserNames(client, guild.id, all.flatMap((g) => [g.hostId, ...asStringArray(g.winners)]));
      render(res, 'giveaways', {
        title: 'Giveaways',
        page: 'giveaways',
        active,
        ended,
        names,
        winnersOf: (g: { winners: unknown }) => asStringArray(g.winners),
        channelName: (id: string) => guild.textChannels.find((c) => c.id === id)?.name ?? id,
        roleName: (id: string | null) => (id ? (guild.roles.find((r) => r.id === id)?.name ?? id) : null),
        languages: LANGUAGES.filter((l) => config.enabledLanguages.includes(l.code)),
        minEnd: toLocalInputValue(new Date(Date.now() + 10 * 60_000), config.timezone),
        timezone: config.timezone,
        moduleEnabled: config.modules.giveaways,
      });
    }),
  );

  router.get(
    '/giveaways/:giveawayId(\\d+)',
    validate({ params: idParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const giveaway = await load(guild.id, params.giveawayId);
      const winners = asStringArray(giveaway.winners);
      const names = await resolveUserNames(client, guild.id, [giveaway.hostId, ...winners, ...giveaway.entries.map((e) => e.userId)]);
      render(res, 'giveaway', {
        title: `Giveaway · ${giveaway.prize}`,
        page: 'giveaways',
        giveaway,
        winners,
        names,
        channelName: guild.textChannels.find((c) => c.id === giveaway.channelId)?.name ?? giveaway.channelId,
        roleName: giveaway.requiredRoleId ? (guild.roles.find((r) => r.id === giveaway.requiredRoleId)?.name ?? giveaway.requiredRoleId) : null,
      });
    }),
  );

  router.post(
    '/giveaways',
    validate({ body: createBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const config = res.locals.config!;
        const { body } = valid<z.infer<typeof createBody>>(req);
        if (!guild.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        if (body.requiredRoleId && !guild.roles.some((r) => r.id === body.requiredRoleId)) throw new HttpError(400, 'Rôle requis inconnu.');
        let endsAt: Date | null = null;
        if (body.endMode === 'duration') {
          const seconds = body.duration ? parseDuration(body.duration) : null;
          if (!seconds || seconds < 60) throw new HttpError(400, 'Durée invalide : utilisez par ex. « 1h30m », « 2j » (minimum 1 minute).');
          endsAt = new Date(Date.now() + seconds * 1000);
        } else {
          endsAt = body.endsAt ? parseLocalDateTime(body.endsAt, config.timezone) : null;
          if (!endsAt) throw new HttpError(400, 'Date de fin invalide.');
          if (endsAt.getTime() <= Date.now() + 60_000) throw new HttpError(400, 'La date de fin doit être dans le futur (au moins 1 minute).');
        }
        requireBotGuild(client, guild.id);
        const giveaway = await giveawayService.create(guild.id, { prize: body.prize, description: body.description ?? null, winnersCount: body.winnersCount, endsAt, channelId: body.channelId, requiredRoleId: body.requiredRoleId, minMessages: body.minMessages, language: body.language }, req.session.user!.id);
        broadcastToGuild(guild.id, 'giveaway:start', { guildId: guild.id, giveawayId: giveaway.id });
        flash(req, 'success', `Giveaway « ${giveaway.prize} » lancé dans #${guild.textChannels.find((c) => c.id === body.channelId)?.name}.`);
        return `${base(guild.id)}/${giveaway.id}`;
      },
    ),
  );

  router.post(
    '/giveaways/:giveawayId(\\d+)/end',
    validate({ params: idParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.giveawayId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        await load(guild.id, params.giveawayId);
        const result = await giveawayService.end(params.giveawayId, { force: true, actorId: req.session.user!.id });
        if (!result.ok) throw new HttpError(400, END_REASONS[result.reason] ?? 'Action impossible.');
        broadcastToGuild(guild.id, 'giveaway:end', { guildId: guild.id, giveawayId: params.giveawayId, winners: result.winners });
        flash(req, 'success', result.winners.length ? `Giveaway terminé : ${result.winners.length} gagnant(s) tiré(s).` : 'Giveaway terminé sans participant valide.');
      },
    ),
  );

  router.post(
    '/giveaways/:giveawayId(\\d+)/reroll',
    validate({ params: idParams, body: rerollBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.giveawayId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof rerollBody>, unknown, z.infer<typeof idParams>>(req);
        await load(guild.id, params.giveawayId);
        const result = await giveawayService.reroll(params.giveawayId, body.count, req.session.user!.id);
        if (!result.ok) throw new HttpError(400, END_REASONS[result.reason] ?? 'Action impossible.');
        broadcastToGuild(guild.id, 'giveaway:end', { guildId: guild.id, giveawayId: params.giveawayId, winners: result.winners, reroll: true });
        flash(req, result.winners.length ? 'success' : 'warning', result.winners.length ? `${result.winners.length} nouveau(x) gagnant(s) tiré(s).` : 'Aucun participant restant pour un nouveau tirage.');
      },
    ),
  );

  router.post(
    '/giveaways/:giveawayId(\\d+)/cancel',
    validate({ params: idParams }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const existing = await load(guild.id, params.giveawayId);
        if (existing.ended) throw new HttpError(400, 'Ce giveaway est déjà terminé.');
        await giveawayService.cancel(params.giveawayId, req.session.user!.id);
        broadcastToGuild(guild.id, 'giveaway:end', { guildId: guild.id, giveawayId: params.giveawayId, cancelled: true });
        flash(req, 'success', `Giveaway « ${existing.prize} » annulé.`);
      },
    ),
  );

  return router;
}
