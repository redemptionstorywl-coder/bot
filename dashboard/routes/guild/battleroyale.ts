import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import {
  battleRoyaleService,
  battlePassTierSchema,
  battlePassProgress,
  levelProgress,
  computeKd,
  parseTiers,
  STAT_FIELDS,
  PROFILE_FIELDS,
  type LeaderboardMetric,
  type StatField,
  type ProfileField,
} from '../../../src/services/BattleRoyaleService';
import { fivemIdentifierSchema } from '../../../src/services/fivem/schemas';
import { leaderboardService } from '../../../src/services/LeaderboardService';
import { KD_MIN_MATCHES, LEADERBOARD_SIZES } from '../../../src/services/battleroyale/leaderboard';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema, optionalText, optionalDiscordId } from '../../lib/validate';
import { jsonArray } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserProfiles, requireBotGuild } from '../../lib/names';
import { parseLocalDateTime, toLocalInputValue } from '../../lib/dates';
import { broadcastToGuild } from '../../sockets';

const TABS = ['leaderboard', 'profiles', 'seasons', 'display'] as const;
const METRICS: LeaderboardMetric[] = ['wins', 'kills', 'level', 'kd'];
const TOP = 50;

export const METRIC_LABELS: Record<LeaderboardMetric, string> = { wins: 'Victoires', kills: 'Kills', level: 'Niveau', kd: 'K/D' };
export const STAT_FIELD_LABELS: Record<StatField | ProfileField, string> = {
  wins: 'Victoires',
  kills: 'Kills',
  deaths: 'Morts',
  matches: 'Parties',
  damage: 'Dégâts',
  top10: 'Top 10',
  xp: 'XP (niveau)',
  playtimeMinutes: 'Temps de jeu (min)',
  battlePassXp: 'XP Battle Pass',
  battlePassTier: 'Palier Battle Pass',
  battlePassPremium: 'Battle Pass premium (1 = oui, 0 = non)',
};

const optionalInt = (min: number, max: number) => z.preprocess((v) => (v === '' || v === undefined ? undefined : Number(v)), z.number().int().min(min).max(max).optional());

const pageQuerySchema = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'leaderboard'), z.enum(TABS)),
  metric: z.preprocess((v) => (typeof v === 'string' && (METRICS as string[]).includes(v) ? v : 'wins'), z.enum(['wins', 'kills', 'level', 'kd'])),
  season: optionalInt(1, 10_000),
  user: z.preprocess((v) => (v === '' ? undefined : v), discordIdSchema.optional()),
  identifier: z.preprocess((v) => (v === '' || v === undefined ? undefined : String(v).trim()), z.string().max(128).optional()),
  pass: optionalInt(1, 10_000),
});

const userParams = z.object({ userId: discordIdSchema });
const seasonParams = z.object({ season: z.coerce.number().int().min(1).max(10_000) });

const statBody = z.object({
  field: z.enum([...STAT_FIELDS, ...PROFILE_FIELDS] as [string, ...string[]]),
  value: z.coerce.number().int().min(0).max(1_000_000_000),
  season: optionalInt(1, 10_000),
});
const xpBody = z.object({ amount: z.coerce.number().int().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0, 'montant non nul attendu') });
const linkBody = z.object({ identifier: fivemIdentifierSchema, nickname: optionalText(64) });
/** Onglet « Affichage » : classement en direct + salon /stat (vide = désactivé / partout). */
const displayBody = z.object({
  leaderboardChannelId: optionalDiscordId,
  leaderboardSize: z.coerce.number().int().refine((n) => (LEADERBOARD_SIZES as readonly number[]).includes(n), 'taille : 10 ou 15'),
  statChannelId: optionalDiscordId,
});

/** Palier saisi dans le repeater : récompenses vides → null. */
const tierInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const t = { ...(v as Record<string, unknown>) };
  t.tier = Number(t.tier);
  t.xpRequired = t.xpRequired === '' || t.xpRequired === undefined ? 0 : Number(t.xpRequired);
  if (!t.freeReward) t.freeReward = null;
  if (!t.premiumReward) t.premiumReward = null;
  return t;
}, battlePassTierSchema);

const seasonBody = z.object({
  name: z.string().trim().min(1, 'nom requis').max(100),
  startsAt: optionalText(32),
  endsAt: z.string().trim().min(1, 'date de fin requise').max(32),
  tiersJson: jsonArray(tierInput, 100),
});
const seasonEditBody = seasonBody.omit({ startsAt: true }).extend({ startsAt: z.string().trim().min(1, 'date de début requise').max(32) });

function normalizeTiers(tiers: z.infer<typeof tierInput>[]): z.infer<typeof tierInput>[] {
  const seen = new Set<number>();
  for (const t of tiers) {
    if (seen.has(t.tier)) throw new HttpError(400, `Palier ${t.tier} en double.`);
    seen.add(t.tier);
  }
  return [...tiers].sort((a, b) => a.tier - b.tier);
}

/** Pages Battle Royale : classements, profils (fiche + actions admin), saisons & Battle Pass. */
export function createBattleRoyaleRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/battle-royale`;
  const profileBack = (guildId: string, userId: string) => `${base(guildId)}?tab=profiles&user=${userId}`;

  router.get(
    '/battle-royale',
    validate({ query: pageQuerySchema }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof pageQuerySchema>>(req);
      const [seasons, currentSeason, activePass, profileCount] = await Promise.all([
        battleRoyaleService.listSeasons(guild.id),
        battleRoyaleService.getCurrentSeason(guild.id),
        battleRoyaleService.getActiveBattlePass(guild.id),
        prisma.battleRoyaleProfile.count({ where: { guildId: guild.id } }),
      ]);
      const season = query.season ?? currentSeason;
      const seasonNumbers = [...new Set([currentSeason, ...seasons.map((s) => s.season), season])].sort((a, b) => b - a);
      const rows = await battleRoyaleService.leaderboard(guild.id, query.metric, season, TOP);

      // Profil recherché (par utilisateur ou identifiant FiveM)
      let lookupUserId = query.user ?? null;
      let lookupError: string | null = null;
      if (!lookupUserId && query.identifier) {
        const byIdentifier = await battleRoyaleService.findByIdentifier(guild.id, query.identifier);
        if (byIdentifier) lookupUserId = byIdentifier.userId;
        else lookupError = `Aucun profil lié à l'identifiant « ${query.identifier} ».`;
      }
      const profile = lookupUserId ? await battleRoyaleService.getProfile(guild.id, lookupUserId) : null;
      if (lookupUserId && !profile && !lookupError) lookupError = 'Aucun profil Battle Royale pour cet utilisateur (il sera créé à la première action admin).';

      const people = await resolveUserProfiles(client, guild.id, [...rows.map((r) => r.userId), lookupUserId]);
      const selectedPass = query.pass ? seasons.find((s) => s.season === query.pass) ?? null : null;
      if (query.pass && !selectedPass) throw new HttpError(404, 'Saison introuvable.');

      const top = rows.slice(0, TOP);
      const maxValue = Math.max(1, ...top.map((r) => (query.metric === 'level' ? r.xp : query.metric === 'kd' ? r.kd : r[query.metric])));
      const crumbs = query.tab === 'profiles' ? [{ label: 'Joueurs' }] : query.tab === 'seasons' ? [{ label: 'Saisons & Battle Pass' }] : query.tab === 'display' ? [{ label: 'Affichage' }] : [];
      const display = query.tab === 'display' ? await leaderboardService.getSettings(guild.id) : null;
      render(res, 'battleroyale', {
        title: 'Battle Royale',
        page: 'battleRoyale',
        crumbs,
        tab: query.tab,
        filters: { metric: query.metric, season, user: query.user ?? '', identifier: query.identifier ?? '' },
        metrics: METRICS.map((m) => ({ value: m, label: METRIC_LABELS[m] })),
        seasonNumbers,
        currentSeason,
        activePass,
        profileCount,
        leaderboard: top.map((r, i) => ({ ...r, rank: i + 1, pct: Math.round(((query.metric === 'level' ? r.xp : query.metric === 'kd' ? r.kd : r[query.metric]) / maxValue) * 1000) / 10 })),
        people,
        lookupUserId,
        lookupError,
        profile: profile
          ? {
              ...profile,
              progress: levelProgress(profile.xp),
              stats: profile.stats.map((s) => ({ ...s, kd: computeKd(s.kills, s.deaths) })),
              battlePass: battlePassProgress(profile.battlePassXp, activePass ? parseTiers(activePass.tiers) : []),
            }
          : null,
        statFields: [...STAT_FIELDS, ...PROFILE_FIELDS].map((f) => ({ value: f, label: STAT_FIELD_LABELS[f], perSeason: (STAT_FIELDS as readonly string[]).includes(f) })),
        seasons: seasons.map((s) => ({ ...s, tiers: parseTiers(s.tiers), startsAtInput: toLocalInputValue(s.startsAt, config.timezone), endsAtInput: toLocalInputValue(s.endsAt, config.timezone) })),
        selectedPass: selectedPass ? { ...selectedPass, tiers: parseTiers(selectedPass.tiers), startsAtInput: toLocalInputValue(selectedPass.startsAt, config.timezone), endsAtInput: toLocalInputValue(selectedPass.endsAt, config.timezone) } : null,
        defaultEndsAt: toLocalInputValue(new Date(Date.now() + 90 * 86400_000), config.timezone),
        display,
        leaderboardSizes: LEADERBOARD_SIZES,
        kdMinMatches: KD_MIN_MATCHES,
        moduleEnabled: config.modules.battleRoyale,
      });
    }),
  );

  // ───── Profils : actions admin ─────

  router.post(
    '/battle-royale/profiles/:userId/stat',
    validate({ params: userParams, body: statBody }),
    formAction(
      (req, res) => profileBack(res.locals.guild!.id, String(req.params.userId)),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof statBody>, unknown, z.infer<typeof userParams>>(req);
        const field = body.field as StatField | ProfileField;
        const value = field === 'battlePassPremium' ? body.value > 0 : body.value;
        await battleRoyaleService.adminSetStat(guild.id, params.userId, field, value, body.season, req.session.user!.id);
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, userId: params.userId, action: 'stat' });
        flash(req, 'success', `${STAT_FIELD_LABELS[field]} = ${String(value)}${body.season && (STAT_FIELDS as readonly string[]).includes(field) ? ` (saison ${body.season})` : ''}.`);
      },
    ),
  );

  router.post(
    '/battle-royale/profiles/:userId/xp',
    validate({ params: userParams, body: xpBody }),
    formAction(
      (req, res) => profileBack(res.locals.guild!.id, String(req.params.userId)),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof xpBody>, unknown, z.infer<typeof userParams>>(req);
        const updated = await battleRoyaleService.addXp(guild.id, params.userId, body.amount, req.session.user!.id);
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, userId: params.userId, action: 'xp' });
        flash(req, 'success', `${body.amount > 0 ? '+' : ''}${body.amount} XP → ${updated.xp} XP (niveau ${updated.level}).`);
      },
    ),
  );

  router.post(
    '/battle-royale/profiles/:userId/link',
    validate({ params: userParams, body: linkBody }),
    formAction(
      (req, res) => profileBack(res.locals.guild!.id, String(req.params.userId)),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof linkBody>, unknown, z.infer<typeof userParams>>(req);
        await battleRoyaleService.linkIdentifier(guild.id, params.userId, body.identifier, body.nickname ?? null);
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, userId: params.userId, action: 'link' });
        flash(req, 'success', `Identifiant « ${body.identifier} » lié.`);
      },
    ),
  );

  router.post(
    '/battle-royale/profiles/:userId/unlink',
    validate({ params: userParams }),
    formAction(
      (req, res) => profileBack(res.locals.guild!.id, String(req.params.userId)),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof userParams>>(req);
        const profile = await battleRoyaleService.getProfile(guild.id, params.userId);
        if (!profile) throw new HttpError(404, 'Profil introuvable.');
        // Pas de méthode de service pour délier : mise à jour directe (le service n'a pas de cache de profils).
        await prisma.battleRoyaleProfile.update({ where: { id: profile.id }, data: { identifier: null } });
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, userId: params.userId, action: 'unlink' });
        flash(req, 'success', 'Identifiant délié.');
      },
    ),
  );

  // ───── Affichage : classement en direct, salon /stat ─────

  router.post(
    '/battle-royale/display',
    validate({ body: displayBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=display`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof displayBody>>(req);
        for (const id of [body.leaderboardChannelId, body.statChannelId]) if (id && !guild.textChannels.some((c) => c.id === id)) throw new HttpError(400, 'Salon inconnu.');
        if (body.leaderboardChannelId) requireBotGuild(client, guild.id);
        await leaderboardService.updateSettings(guild.id, body, req.session.user!.id);
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, action: 'display' });
        flash(req, 'success', body.leaderboardChannelId ? 'Affichage enregistré : le classement est publié et se mettra à jour tout seul.' : 'Affichage enregistré (classement en direct désactivé).');
      },
    ),
  );

  router.post(
    '/battle-royale/display/refresh',
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=display`,
      async (req, res) => {
        const guild = res.locals.guild!;
        requireBotGuild(client, guild.id);
        const settings = await leaderboardService.getSettings(guild.id);
        if (!settings.leaderboardChannelId) throw new HttpError(400, 'Choisissez d’abord un salon pour le classement.');
        await leaderboardService.refreshNow(guild.id);
        flash(req, 'success', 'Classement republié / mis à jour.');
      },
    ),
  );

  // ───── Saisons & Battle Pass ─────

  router.post(
    '/battle-royale/seasons',
    validate({ body: seasonBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=seasons`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const config = res.locals.config!;
        const { body } = valid<z.infer<typeof seasonBody>>(req);
        const endsAt = parseLocalDateTime(body.endsAt, config.timezone);
        if (!endsAt) throw new HttpError(400, 'Date de fin invalide.');
        const startsAt = body.startsAt ? parseLocalDateTime(body.startsAt, config.timezone) : null;
        if (body.startsAt && !startsAt) throw new HttpError(400, 'Date de début invalide.');
        const start = startsAt ?? new Date();
        if (endsAt.getTime() <= start.getTime()) throw new HttpError(400, 'La date de fin doit être postérieure au début.');
        const tiers = normalizeTiers(body.tiersJson);
        const durationDays = Math.max(1, Math.ceil((endsAt.getTime() - Date.now()) / 86400_000));
        const pass = await battleRoyaleService.newSeason(guild.id, { name: body.name, durationDays, tiers: tiers.length ? tiers : undefined, actorId: req.session.user!.id });
        // newSeason fixe startsAt = maintenant et endsAt = +N jours : on applique les dates exactes saisies (pas de méthode de service, aucun cache côté service).
        await prisma.battlePass.update({ where: { id: pass.id }, data: { startsAt: start, endsAt } });
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, action: 'season', season: pass.season });
        flash(req, 'success', `Saison ${pass.season} « ${pass.name} » créée et activée (${parseTiers(pass.tiers).length} paliers). La progression Battle Pass des joueurs a été réinitialisée.`);
      },
    ),
  );

  router.post(
    '/battle-royale/seasons/:season(\\d+)/activate',
    validate({ params: seasonParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=seasons`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof seasonParams>>(req);
        const pass = await battleRoyaleService.setSeason(guild.id, params.season, req.session.user!.id);
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, action: 'season', season: pass.season });
        flash(req, 'success', `Saison ${pass.season} « ${pass.name} » définie comme saison courante.`);
      },
    ),
  );

  router.post(
    '/battle-royale/seasons/:season(\\d+)',
    validate({ params: seasonParams, body: seasonEditBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=seasons&pass=${req.params.season}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const config = res.locals.config!;
        const { params, body } = valid<z.infer<typeof seasonEditBody>, unknown, z.infer<typeof seasonParams>>(req);
        const existing = await prisma.battlePass.findUnique({ where: { guildId_season: { guildId: guild.id, season: params.season } } });
        if (!existing) throw new HttpError(404, 'Saison introuvable.');
        const startsAt = parseLocalDateTime(body.startsAt, config.timezone);
        const endsAt = parseLocalDateTime(body.endsAt, config.timezone);
        if (!startsAt || !endsAt) throw new HttpError(400, 'Dates invalides.');
        if (endsAt.getTime() <= startsAt.getTime()) throw new HttpError(400, 'La date de fin doit être postérieure au début.');
        const tiers = normalizeTiers(body.tiersJson);
        // Pas de méthode de service pour éditer un Battle Pass : mise à jour directe (aucun cache côté service).
        const pass = await prisma.battlePass.update({ where: { id: existing.id }, data: { name: body.name, startsAt, endsAt, tiers: tiers as unknown as Prisma.InputJsonValue } });
        battleRoyaleService.notifyChange(guild.id); // nom / fin de saison affichés dans le classement en direct
        broadcastToGuild(guild.id, 'br:update', { guildId: guild.id, action: 'season', season: pass.season });
        flash(req, 'success', `Saison ${pass.season} mise à jour (${tiers.length} paliers).`);
        return `${base(guild.id)}?tab=seasons`;
      },
    ),
  );

  return router;
}
