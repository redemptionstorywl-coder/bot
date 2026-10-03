import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Enveloppe un handler async pour transmettre les rejets à `next()` (Express 4). */
export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
