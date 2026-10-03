import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { shopService } from '../services/ShopService';
import { formatZodError } from '../services/fivem/schemas';
import { childLogger } from '../utils/logger';

const log = childLogger('ShopApi');

/** Secret attendu dans `x-webhook-secret` : TEBEX_WEBHOOK_SECRET si défini, sinon FIVEM_API_KEY. */
export function webhookSecret(): string {
  return process.env.TEBEX_WEBHOOK_SECRET?.trim() || env().FIVEM_API_KEY;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Webhooks boutique — montés par le dashboard sur `/api/shop`.
 * POST /tebex  (header `x-webhook-secret`) → shopService.handleTebexWebhook
 */
export function createShopWebhookRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: '64kb' }));

  router.get('/health', (_req, res) => res.json({ ok: true, service: 'shop' }));

  router.post('/tebex', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const secret = req.header('x-webhook-secret') ?? '';
      if (!secret || !safeEqual(secret, webhookSecret())) {
        res.status(401).json({ error: 'unauthorized', message: 'x-webhook-secret invalide' });
        return;
      }
      const result = await shopService.handleTebexWebhook(req.body);
      if (!result.ok) {
        res.status(202).json({ ok: false, reason: result.reason });
        return;
      }
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'validation', message: formatZodError(err) });
      return;
    }
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'Corps JSON invalide' });
      return;
    }
    log.error({ err }, 'Erreur webhook shop');
    res.status(500).json({ error: 'internal', message: 'Erreur interne' });
  });
  return router;
}
