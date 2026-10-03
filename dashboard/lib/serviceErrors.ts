import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { TicketError } from '../../src/services/TicketService';
import { AnnouncementError } from '../../src/services/AnnouncementService';
import { EmbedTemplateError } from '../../src/services/EmbedTemplateService';
import { ModerationError } from '../../src/services/ModerationService';
import { WhitelistError } from '../../src/services/WhitelistService';
import { SchoolError } from '../../src/services/SchoolService';
import { ShopError } from '../../src/services/ShopService';
import { FiveMError } from '../../src/services/FiveMService';
import { BattleRoyaleError } from '../../src/services/BattleRoyaleService';
import { translationService } from '../../src/services/TranslationService';
import { childLogger } from '../../src/utils/logger';
import { HttpError } from './errors';
import { formatZodIssues } from './validate';
import { flash } from './flash';
import { wantsJson } from './rateLimit';

const log = childLogger('Dashboard');

const ANNOUNCEMENT_MESSAGES: Record<string, string> = {
  not_found: 'Annonce introuvable.',
  already_published: 'Cette annonce est déjà publiée.',
  no_channel: "Aucun salon de publication : définissez un salon sur l'annonce ou des salons par langue dans les paramètres.",
  no_targets: 'Aucune langue cible à publier.',
  send_failed: "L'envoi sur Discord a échoué. Vérifiez les permissions du bot dans le salon.",
  invalid_status: "Cette action n'est pas possible dans l'état actuel de l'annonce.",
  no_client: "Le bot n'est pas connecté : réessayez dans quelques instants.",
  invalid_spec: 'Embed invalide.',
  past_date: 'La date de programmation doit être dans le futur.',
};

const EMBED_TEMPLATE_MESSAGES: Record<string, string> = {
  not_found: 'Template introuvable.',
  duplicate_name: 'Un template portant ce nom existe déjà.',
  invalid_channel: 'Salon invalide ou inaccessible pour le bot.',
  message_not_found: 'Message introuvable.',
  not_bot_message: "Ce message n'a pas été envoyé par le bot.",
  no_embed: 'Ce message ne contient aucun embed.',
  no_client: "Le bot n'est pas connecté : réessayez dans quelques instants.",
  invalid_spec: 'Embed invalide.',
};

export interface DescribedError {
  status: number;
  message: string;
  details?: string[];
}

/**
 * Convertit une erreur quelconque (service métier, Zod, Discord, HttpError) en message lisible en français.
 * Les erreurs inconnues restent des 500 (message générique, détail journalisé).
 */
export function describeError(err: unknown, guildId?: string | null): DescribedError {
  if (err instanceof HttpError) return { status: err.status, message: err.message, details: err.details };
  if (err instanceof z.ZodError) return { status: 400, message: 'Données invalides', details: formatZodIssues(err) };
  if (err instanceof TicketError) return { status: 400, message: translationService.translate('fr', err.message, err.vars, guildId) };
  if (err instanceof AnnouncementError) {
    const base = ANNOUNCEMENT_MESSAGES[err.code] ?? 'Erreur du module Annonces.';
    return { status: err.code === 'not_found' ? 404 : 400, message: base, details: err.details && err.code === 'invalid_spec' ? err.details.split('\n') : undefined };
  }
  if (err instanceof EmbedTemplateError) {
    const base = EMBED_TEMPLATE_MESSAGES[err.code] ?? 'Erreur du module Embeds.';
    return { status: err.code === 'not_found' ? 404 : 400, message: base, details: err.details && err.code === 'invalid_spec' ? err.details.split('\n') : undefined };
  }
  if (err instanceof ModerationError) return { status: 400, message: translationService.translate('fr', err.key, err.vars, guildId) };
  // Modules FiveM / Whitelist / Battle Royale / School / Shop : codes → messages traduits (locales/fr/<module>.json → errors.<code>)
  const coded = describeCodedError(err, guildId);
  if (coded) return coded;
  if (err instanceof Error) {
    if (err.name === 'DiscordAPIError' || err.name === 'HTTPError') return { status: 502, message: `Discord a refusé l'action : ${err.message}` };
    // Erreurs « métier » levées en clair par les services (ex. « Salon invalide »)
    if (err.name === 'Error' && err.message && err.message.length <= 200 && !/prisma|undefined|null|cannot|is not/i.test(err.message)) return { status: 400, message: err.message };
  }
  return { status: 500, message: 'Une erreur interne est survenue. Réessayez plus tard.' };
}

const NOT_FOUND_CODES = new Set(['not_found', 'profile_not_found', 'class_not_found', 'house_not_found', 'club_not_found', 'application_not_found', 'product_not_found', 'order_not_found', 'category_not_found']);

/** Erreurs à code des modules métier (WhitelistError, SchoolError, ShopError, FiveMError, BattleRoyaleError) → message FR. */
function describeCodedError(err: unknown, guildId?: string | null): DescribedError | null {
  let ns: string | null = null;
  let fallback = '';
  if (err instanceof WhitelistError) (ns = 'whitelist'), (fallback = 'Erreur du module Whitelist.');
  else if (err instanceof SchoolError) (ns = 'school'), (fallback = 'Erreur du module School RP.');
  else if (err instanceof ShopError) (ns = 'shop'), (fallback = 'Erreur du module Shop.');
  else if (err instanceof FiveMError) (ns = 'fivem'), (fallback = 'Erreur du module FiveM.');
  else if (err instanceof BattleRoyaleError) (ns = 'battleroyale'), (fallback = 'Erreur du module Battle Royale.');
  if (!ns) return null;
  const code = (err as { code: string }).code;
  const key = `${ns}.errors.${code}`;
  const translated = translationService.translate('fr', key, undefined, guildId);
  let message = translated === key ? fallback : translated;
  if (err instanceof FiveMError && code === 'unreachable' && err.message && err.message !== code) message = `${message} ${err.message.slice(0, 160)}`;
  const status = NOT_FOUND_CODES.has(code) ? 404 : err instanceof FiveMError && code === 'unreachable' ? 502 : 400;
  return { status, message };
}

/** Transforme une erreur de service en HttpError (pour les handlers JSON). */
export function toHttpError(err: unknown, guildId?: string | null): HttpError {
  if (err instanceof HttpError) return err;
  const d = describeError(err, guildId);
  if (d.status >= 500) log.error({ err }, 'Erreur service (dashboard)');
  return new HttpError(d.status, d.message, d.details);
}

export type FormHandler = (req: Request, res: Response) => Promise<string | void> | string | void;

/**
 * Handler de formulaire : exécute `fn`, puis redirige vers l'URL retournée (ou `back(req, res)`).
 * Toute erreur est convertie en message flash lisible puis redirigée (ou en JSON si la requête le demande).
 */
export function formAction(back: (req: Request, res: Response) => string, fn: FormHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((target) => {
        if (res.headersSent) return;
        res.redirect(typeof target === 'string' && target ? target : back(req, res));
      })
      .catch((err: unknown) => {
        const guildId = res.locals.guild?.id ?? null;
        const described = describeError(err, guildId);
        if (described.status >= 500) log.error({ err, path: req.originalUrl }, 'Erreur formulaire dashboard');
        if (wantsJson(req)) return next(new HttpError(described.status, described.message, described.details));
        if (res.headersSent) return;
        const detail = described.details?.length ? ` (${described.details.slice(0, 3).join(' · ')})` : '';
        flash(req, 'error', `${described.message}${detail}`);
        res.redirect(back(req, res));
      });
  };
}
