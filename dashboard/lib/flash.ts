import type { Request } from 'express';
import type { FlashMessage, FlashType } from './types';

/** Ajoute un message flash (affiché une fois sur la prochaine page rendue). */
export function flash(req: Request, type: FlashType, message: string): void {
  if (!req.session) return;
  const list = req.session.flash ?? [];
  list.push({ type, message });
  req.session.flash = list.slice(-5);
}

/** Consomme les messages flash de la session. */
export function takeFlash(req: Request): FlashMessage[] {
  if (!req.session?.flash?.length) return [];
  const list = req.session.flash;
  delete req.session.flash;
  return list;
}
