import { Router } from 'express';
import { z } from 'zod';
import { OrderStatus, Prisma } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { shopService, canTransition, formatPrice } from '../../../src/services/ShopService';
import { env } from '../../../src/config/env';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema, optionalText, checkbox, pageQuery } from '../../lib/validate';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserNames } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const PAGE_SIZE = 25;
const TABS = ['products', 'categories', 'orders', 'history', 'stats', 'webhook'] as const;
const STATS_DAYS = 30;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = { PENDING: 'En attente', PAID: 'Payée', DELIVERED: 'Livrée', CANCELLED: 'Annulée', REFUNDED: 'Remboursée' };

const optionalIdQuery = z.preprocess((v) => (v === '' || v === undefined ? undefined : Number(v)), z.number().int().positive().optional());
const optionalId = z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int().positive().nullable());
const optionalStock = z.preprocess((v) => (v === '' || v === undefined ? null : Number(v)), z.number().int().min(0).max(1_000_000).nullable());
const optionalUrl = z.preprocess((v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v), z.string().trim().url('URL attendue').max(500).nullable());

const pageQuerySchema = z.object({
  tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'products'), z.enum(TABS)),
  product: optionalIdQuery,
  status: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(OrderStatus).optional()),
  user: z.preprocess((v) => (v === '' ? undefined : v), discordIdSchema.optional()),
  page: pageQuery,
  order: optionalIdQuery,
  historyUser: z.preprocess((v) => (v === '' ? undefined : v), discordIdSchema.optional()),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });

const productBody = z.object({
  name: z.string().trim().min(1, 'nom requis').max(100),
  description: optionalText(2000),
  categoryId: optionalId,
  price: z.string().trim().regex(/^\d+([.,]\d{1,2})?$/, 'prix : nombre avec 2 décimales max (ex. 9.99)'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3,8}$/, 'devise : code ISO (EUR, USD…)').default('EUR'),
  imageUrl: optionalUrl,
  stock: optionalStock,
  tebexPackageId: optionalText(64),
  tebexUrl: optionalUrl,
  enabled: checkbox,
});

const categoryBody = z.object({ name: z.string().trim().min(1, 'nom requis').max(100), description: optionalText(300), emoji: optionalText(64), order: z.coerce.number().int().min(-1000).max(1000).default(0) });
const orderBody = z.object({ userId: discordIdSchema, productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(99).default(1), note: optionalText(1000) });
const statusBody = z.object({ status: z.nativeEnum(OrderStatus), note: optionalText(1000) });

const ALL_STATUSES = Object.values(OrderStatus);

/** Pages Shop : produits, catégories, commandes (liste paginée, fiche, transitions, création manuelle), historique client, statistiques, webhook Tebex. */
export function createShopRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/shop`;

  router.get(
    '/shop',
    validate({ query: pageQuerySchema }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof pageQuerySchema>>(req);
      const where: Prisma.ShopOrderWhereInput = { guildId: guild.id, ...(query.status ? { status: query.status } : {}), ...(query.user ? { userId: query.user } : {}) };
      const since = new Date(Date.now() - STATS_DAYS * 86400_000);
      const [products, categories, orders, orderTotal, byStatus, recentPaid, editing, selectedOrder, history] = await Promise.all([
        shopService.listProducts(guild.id),
        shopService.listCategories(guild.id),
        // ShopService.listOrders n'est pas paginé : lecture directe avec skip/take (aucun cache côté service).
        prisma.shopOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { product: true } }),
        prisma.shopOrder.count({ where }),
        prisma.shopOrder.groupBy({ by: ['status'], where: { guildId: guild.id }, _count: { _all: true }, _sum: { total: true } }),
        prisma.shopOrder.findMany({ where: { guildId: guild.id, status: { in: [OrderStatus.PAID, OrderStatus.DELIVERED] }, createdAt: { gte: since } }, select: { total: true, currency: true, createdAt: true, status: true } }),
        query.product ? shopService.getProduct(guild.id, query.product) : Promise.resolve(null),
        query.order ? shopService.getOrder(guild.id, query.order) : Promise.resolve(null),
        query.historyUser ? shopService.history(guild.id, query.historyUser, 100) : Promise.resolve([]),
      ]);
      if (query.product && !editing) throw new HttpError(404, 'Produit introuvable.');
      if (query.order && !selectedOrder) throw new HttpError(404, 'Commande introuvable.');
      const names = await resolveUserNames(client, guild.id, [...orders.map((o) => o.userId), selectedOrder?.userId, query.historyUser]);

      // Statistiques : commandes par statut + CA payé / livré par jour sur 30 jours
      const statusCounts: Record<OrderStatus, { count: number; total: number }> = { PENDING: { count: 0, total: 0 }, PAID: { count: 0, total: 0 }, DELIVERED: { count: 0, total: 0 }, CANCELLED: { count: 0, total: 0 }, REFUNDED: { count: 0, total: 0 } };
      for (const row of byStatus) statusCounts[row.status] = { count: row._count._all, total: Number(row._sum.total ?? 0) };
      const maxStatus = Math.max(1, ...ALL_STATUSES.map((s) => statusCounts[s].count));
      const dayKey = (d: Date) => d.toISOString().slice(0, 10);
      const days: { key: string; label: string; total: number; count: number }[] = [];
      for (let i = STATS_DAYS - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000);
        days.push({ key: dayKey(d), label: new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: config.timezone }).format(d), total: 0, count: 0 });
      }
      const byDay = new Map(days.map((d) => [d.key, d]));
      let revenue = 0;
      for (const o of recentPaid) {
        const d = byDay.get(dayKey(o.createdAt));
        const amount = Number(o.total);
        revenue += amount;
        if (d) {
          d.total += amount;
          d.count += 1;
        }
      }
      const maxDay = Math.max(1, ...days.map((d) => d.total));
      const currency = products[0]?.currency ?? recentPaid[0]?.currency ?? 'EUR';
      const baseQuery = new URLSearchParams({ tab: 'orders', ...(query.status ? { status: query.status } : {}), ...(query.user ? { user: query.user } : {}) }).toString();
      const dashboardUrl = env().DASHBOARD_URL.replace(/\/+$/, '');
      render(res, 'shop', {
        title: 'Shop',
        page: 'shop',
        tab: query.tab,
        filters: { status: query.status ?? '', user: query.user ?? '', historyUser: query.historyUser ?? '' },
        products: products.map((p) => ({ ...p, priceLabel: formatPrice(p.price, p.currency) })),
        categories,
        editing: editing ? { ...editing, priceInput: new Prisma.Decimal(editing.price).toFixed(2) } : null,
        orders: orders.map((o) => ({ ...o, totalLabel: formatPrice(o.total, o.currency) })),
        pagination: { page: query.page, pages: Math.max(1, Math.ceil(orderTotal / PAGE_SIZE)), total: orderTotal, pageSize: PAGE_SIZE },
        baseQuery,
        selectedOrder: selectedOrder ? { ...selectedOrder, totalLabel: formatPrice(selectedOrder.total, selectedOrder.currency), transitions: ALL_STATUSES.filter((s) => s !== selectedOrder.status && canTransition(selectedOrder.status, s)) } : null,
        history: history.map((o) => ({ ...o, totalLabel: formatPrice(o.total, o.currency) })),
        historyTotal: history.filter((o) => o.status === OrderStatus.PAID || o.status === OrderStatus.DELIVERED).reduce((n, o) => n + Number(o.total), 0),
        names,
        statusLabels: ORDER_STATUS_LABELS,
        statuses: ALL_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
        stats: {
          byStatus: ALL_STATUSES.map((s) => ({ status: s, label: ORDER_STATUS_LABELS[s], ...statusCounts[s], pct: Math.round((statusCounts[s].count / maxStatus) * 1000) / 10 })),
          totalOrders: ALL_STATUSES.reduce((n, s) => n + statusCounts[s].count, 0),
          revenue,
          revenueLabel: formatPrice(revenue, currency),
          days: days.map((d) => ({ ...d, pct: Math.round((d.total / maxDay) * 1000) / 10, totalLabel: formatPrice(d.total, currency) })),
          period: STATS_DAYS,
          currency,
        },
        webhook: {
          url: `${dashboardUrl}/api/shop/tebex`,
          health: `${dashboardUrl}/api/shop/health`,
          header: 'x-webhook-secret',
          secretSource: env().TEBEX_WEBHOOK_SECRET ? 'TEBEX_WEBHOOK_SECRET' : 'FIVEM_API_KEY (TEBEX_WEBHOOK_SECRET non défini)',
          linkedProducts: products.filter((p) => p.tebexPackageId).length,
        },
        moduleEnabled: config.modules.shop,
      });
    }),
  );

  // ───── Produits ─────

  function productInput(body: z.infer<typeof productBody>) {
    return {
      name: body.name,
      price: body.price.replace(',', '.'),
      currency: body.currency,
      description: body.description ?? null,
      imageUrl: body.imageUrl,
      stock: body.stock,
      categoryId: body.categoryId,
      tebexPackageId: body.tebexPackageId ?? null,
      tebexUrl: body.tebexUrl,
    };
  }

  router.post(
    '/shop/products',
    validate({ body: productBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=products`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof productBody>>(req);
        if (body.categoryId) {
          const categories = await shopService.listCategories(guild.id);
          if (!categories.some((c) => c.id === body.categoryId)) throw new HttpError(400, 'Catégorie inconnue.');
        }
        let product = await shopService.addProduct(guild.id, productInput(body), req.session.user!.id);
        if (!body.enabled) product = await shopService.editProduct(guild.id, product.id, { enabled: false }, req.session.user!.id);
        broadcastToGuild(guild.id, 'shop:product', { guildId: guild.id, productId: product.id, action: 'create' });
        flash(req, 'success', `Produit « ${product.name} » ajouté (${formatPrice(product.price, product.currency)}).`);
      },
    ),
  );

  router.post(
    '/shop/products/:id(\\d+)',
    validate({ params: idParams, body: productBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=products&product=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof productBody>, unknown, z.infer<typeof idParams>>(req);
        if (body.categoryId) {
          const categories = await shopService.listCategories(guild.id);
          if (!categories.some((c) => c.id === body.categoryId)) throw new HttpError(400, 'Catégorie inconnue.');
        }
        const product = await shopService.editProduct(guild.id, params.id, { ...productInput(body), enabled: body.enabled }, req.session.user!.id);
        broadcastToGuild(guild.id, 'shop:product', { guildId: guild.id, productId: product.id, action: 'update' });
        flash(req, 'success', `Produit « ${product.name} » mis à jour.`);
        return `${base(guild.id)}?tab=products`;
      },
    ),
  );

  router.post(
    '/shop/products/:id(\\d+)/delete',
    validate({ params: idParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=products`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const product = await shopService.removeProduct(guild.id, params.id, req.session.user!.id);
        broadcastToGuild(guild.id, 'shop:product', { guildId: guild.id, productId: product.id, action: 'delete' });
        flash(req, 'success', `Produit « ${product.name} » supprimé (les commandes existantes sont conservées).`);
      },
    ),
  );

  // ───── Catégories ─────

  router.post(
    '/shop/categories',
    validate({ body: categoryBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=categories`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof categoryBody>>(req);
        const cat = await shopService.addCategory(guild.id, { name: body.name, description: body.description ?? null, emoji: body.emoji ?? null, order: body.order });
        flash(req, 'success', `Catégorie « ${cat.name} » créée.`);
      },
    ),
  );

  router.post(
    '/shop/categories/:id(\\d+)',
    validate({ params: idParams, body: categoryBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=categories`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof categoryBody>, unknown, z.infer<typeof idParams>>(req);
        const categories = await shopService.listCategories(guild.id);
        if (!categories.some((c) => c.id === params.id)) throw new HttpError(404, 'Catégorie introuvable.');
        // Pas de méthode d'édition dans ShopService : mise à jour directe (aucun cache côté service).
        const cat = await prisma.shopCategory.update({ where: { id: params.id }, data: { name: body.name.slice(0, 100), description: body.description ?? null, emoji: body.emoji ?? null, order: body.order } });
        flash(req, 'success', `Catégorie « ${cat.name} » mise à jour.`);
      },
    ),
  );

  router.post(
    '/shop/categories/:id(\\d+)/delete',
    validate({ params: idParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=categories`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const cat = await shopService.removeCategory(guild.id, params.id);
        flash(req, 'success', `Catégorie « ${cat.name} » supprimée (les produits restent sans catégorie).`);
      },
    ),
  );

  // ───── Commandes ─────

  router.post(
    '/shop/orders',
    validate({ body: orderBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=orders`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof orderBody>>(req);
        const order = await shopService.createOrder({ guildId: guild.id, userId: body.userId, productId: body.productId, quantity: body.quantity, note: body.note ?? null, actorId: req.session.user!.id });
        broadcastToGuild(guild.id, 'shop:order', { guildId: guild.id, orderId: order.id, status: order.status, action: 'create' });
        flash(req, 'success', `Commande #${order.id} créée pour ${order.product?.name ?? 'produit'} ×${order.quantity} (${formatPrice(order.total, order.currency)}).`);
        return `${base(guild.id)}?tab=orders&order=${order.id}`;
      },
    ),
  );

  router.post(
    '/shop/orders/:id(\\d+)/status',
    validate({ params: idParams, body: statusBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=orders&order=${req.params.id}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof statusBody>, unknown, z.infer<typeof idParams>>(req);
        const existing = await shopService.getOrder(guild.id, params.id);
        if (!existing) throw new HttpError(404, 'Commande introuvable.');
        if (existing.status === body.status) throw new HttpError(400, `La commande est déjà « ${ORDER_STATUS_LABELS[body.status]} ».`);
        if (!canTransition(existing.status, body.status)) throw new HttpError(400, `Transition impossible : ${ORDER_STATUS_LABELS[existing.status]} → ${ORDER_STATUS_LABELS[body.status]}.`);
        const order = await shopService.updateOrderStatus(guild.id, params.id, body.status, req.session.user!.id, body.note ? body.note : undefined);
        broadcastToGuild(guild.id, 'shop:order', { guildId: guild.id, orderId: order.id, status: order.status, action: 'status' });
        flash(req, 'success', `Commande #${order.id} → ${ORDER_STATUS_LABELS[order.status]}.`);
      },
    ),
  );

  return router;
}
