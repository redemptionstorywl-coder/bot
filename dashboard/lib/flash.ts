import type { Request, Response } from 'express';
import type { FlashMessage, FlashType } from './types';
import { loggingService } from '../../src/services/LoggingService';

/**
 * Ajoute un message flash (affiché une fois sur la prochaine page rendue).
 * Un succès sur une page d'un serveur est aussi journalisé (log SYSTEM `dashboard.change`, route hub : bot.config),
 * sauf si la route a déjà écrit son propre log (`markAudited(res)`).
 */
export function flash(req: Request, type: FlashType, message: string): void {
  if (!req.session) return;
  const list = req.session.flash ?? [];
  list.push({ type, message });
  req.session.flash = list.slice(-5);
  if (type === 'success') auditDashboardChange(req, message);
}

/** La route a déjà journalisé la modification : pas de log `dashboard.change` en plus. */
export function markAudited(res: Response): void {
  res.locals.auditLogged = true;
}

function auditDashboardChange(req: Request, message: string): void {
  const guildId = (req.params as { guildId?: string } | undefined)?.guildId;
  const user = req.session?.user;
  if (!guildId || !/^\d{15,22}$/.test(guildId) || !user || req.res?.locals.auditLogged) return;
  const page = `${req.baseUrl ?? ''}${req.path ?? ''}`.replace(`/guilds/${guildId}`, '') || '/';
  void loggingService.log({
    guildId,
    category: 'SYSTEM',
    action: 'dashboard.change',
    title: `🖥️ Dashboard — ${message}`.slice(0, 256),
    fields: [
      { name: 'Page', value: `\`${req.method} ${page}\``.slice(0, 1024), inline: true },
      { name: 'Par', value: `<@${user.id}> (\`${user.id}\`)`, inline: true },
    ],
    actorId: user.id,
    data: { page, method: req.method, message, source: 'dashboard' },
  });
}

/** Consomme les messages flash de la session. */
export function takeFlash(req: Request): FlashMessage[] {
  if (!req.session?.flash?.length) return [];
  const list = req.session.flash;
  delete req.session.flash;
  return list;
}
