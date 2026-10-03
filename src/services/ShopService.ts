import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ColorResolvable } from 'discord.js';
import { LogCategory, OrderStatus, Prisma, type ShopCategory, type ShopOrder, type ShopProduct } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { loggingService } from './LoggingService';
import { translationService } from './TranslationService';
import { BRAND } from '../config/constants';
import { buildCustomId } from '../utils/customId';
import { chunk } from '../utils/pagination';
import { childLogger } from '../utils/logger';

const log = childLogger('ShopService');

export type ShopErrorCode = 'product_not_found' | 'product_disabled' | 'out_of_stock' | 'order_not_found' | 'category_not_found' | 'invalid_price' | 'invalid_quantity' | 'invalid_transition';

export class ShopError extends Error {
  constructor(readonly code: ShopErrorCode) {
    super(code);
    this.name = 'ShopError';
  }
}

// ───────────── Fonctions pures (testées) ─────────────

/** Nouveau stock après commande : `null` = illimité ; lance `out_of_stock` si insuffisant. */
export function decrementStock(stock: number | null, quantity: number): number | null {
  if (!Number.isInteger(quantity) || quantity < 1) throw new ShopError('invalid_quantity');
  if (stock === null) return null;
  if (stock < quantity) throw new ShopError('out_of_stock');
  return stock - quantity;
}

export function restoreStock(stock: number | null, quantity: number): number | null {
  return stock === null ? null : stock + Math.max(0, quantity);
}

/** Formate un prix Decimal / number / string avec 2 décimales + devise. */
export function formatPrice(amount: Prisma.Decimal | number | string, currency = 'EUR'): string {
  const value = amount instanceof Prisma.Decimal ? amount.toFixed(2) : new Prisma.Decimal(amount).toFixed(2);
  return `${value} ${currency}`;
}

export function parsePrice(input: string | number): Prisma.Decimal {
  const normalized = String(input).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new ShopError('invalid_price');
  return new Prisma.Decimal(normalized);
}

/** Transitions autorisées entre statuts de commande. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAID', 'DELIVERED', 'CANCELLED'],
  PAID: ['DELIVERED', 'REFUNDED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Statuts qui rendent le stock (commande annulée / remboursée depuis un état où le stock avait été réservé). */
export function releasesStock(from: OrderStatus, to: OrderStatus): boolean {
  return (to === 'CANCELLED' || to === 'REFUNDED') && from !== 'CANCELLED' && from !== 'REFUNDED';
}

// ───────────── Tebex ─────────────

const TEBEX_STATUS_ALIASES: Record<string, OrderStatus> = {
  paid: 'PAID',
  complete: 'PAID',
  completed: 'PAID',
  'payment.completed': 'PAID',
  delivered: 'DELIVERED',
  refund: 'REFUNDED',
  refunded: 'REFUNDED',
  chargeback: 'REFUNDED',
  'payment.refunded': 'REFUNDED',
  'payment.disputed': 'REFUNDED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  declined: 'CANCELLED',
  'payment.declined': 'CANCELLED',
  pending: 'PENDING',
};

export const tebexWebhookSchema = z.object({
  transactionId: z.string().min(1).max(128),
  packageId: z.union([z.string(), z.number()]).transform(String),
  discordId: z.string().regex(/^\d{15,22}$/).optional(),
  status: z
    .string()
    .min(1)
    .transform((s, ctx) => {
      const mapped = TEBEX_STATUS_ALIASES[s.trim().toLowerCase()] ?? (Object.values(OrderStatus) as string[]).find((v) => v === s.trim().toUpperCase());
      if (!mapped) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Statut inconnu : ${s}` });
        return z.NEVER;
      }
      return mapped as OrderStatus;
    }),
  quantity: z.coerce.number().int().min(1).max(999).optional(),
  note: z.string().max(1000).optional(),
});
export type TebexWebhookPayload = z.infer<typeof tebexWebhookSchema>;

export type ProductWithCategory = ShopProduct & { category: ShopCategory | null };
export type OrderWithProduct = ShopOrder & { product: ShopProduct | null };

export class ShopService {
  // ───── Catégories ─────

  listCategories(guildId: string): Promise<ShopCategory[]> {
    return prisma.shopCategory.findMany({ where: { guildId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  }

  async addCategory(guildId: string, input: { name: string; description?: string | null; emoji?: string | null; order?: number }): Promise<ShopCategory> {
    return prisma.shopCategory.create({ data: { guildId, name: input.name.slice(0, 100), description: input.description ?? null, emoji: input.emoji ?? null, order: input.order ?? 0 } });
  }

  async removeCategory(guildId: string, id: number): Promise<ShopCategory> {
    const cat = await prisma.shopCategory.findFirst({ where: { id, guildId } });
    if (!cat) throw new ShopError('category_not_found');
    await prisma.shopCategory.delete({ where: { id } });
    return cat;
  }

  // ───── Produits ─────

  listProducts(guildId: string, opts: { categoryId?: number | null; enabledOnly?: boolean } = {}): Promise<ProductWithCategory[]> {
    return prisma.shopProduct.findMany({
      where: { guildId, ...(opts.categoryId !== undefined ? { categoryId: opts.categoryId } : {}), ...(opts.enabledOnly ? { enabled: true } : {}) },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      include: { category: true },
    });
  }

  async getProduct(guildId: string, id: number): Promise<ProductWithCategory | null> {
    const p = await prisma.shopProduct.findUnique({ where: { id }, include: { category: true } });
    return p && p.guildId === guildId ? p : null;
  }

  async addProduct(
    guildId: string,
    input: { name: string; price: string | number; currency?: string; description?: string | null; imageUrl?: string | null; stock?: number | null; categoryId?: number | null; tebexPackageId?: string | null; tebexUrl?: string | null },
    actorId?: string,
  ): Promise<ShopProduct> {
    const product = await prisma.shopProduct.create({
      data: {
        guildId,
        name: input.name.slice(0, 100),
        price: parsePrice(input.price),
        currency: (input.currency ?? 'EUR').toUpperCase().slice(0, 8),
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        stock: input.stock ?? null,
        categoryId: input.categoryId ?? null,
        tebexPackageId: input.tebexPackageId ?? null,
        tebexUrl: input.tebexUrl ?? null,
      },
    });
    await loggingService.log({ guildId, category: LogCategory.SHOP, action: 'shop.product.add', title: `🛒 Produit ajouté : ${product.name}`, description: formatPrice(product.price, product.currency), actorId: actorId ?? null, data: { productId: product.id } });
    return product;
  }

  async editProduct(guildId: string, id: number, patch: Partial<{ name: string; price: string | number; currency: string; description: string | null; imageUrl: string | null; stock: number | null; categoryId: number | null; tebexPackageId: string | null; tebexUrl: string | null; enabled: boolean }>, actorId?: string): Promise<ShopProduct> {
    const existing = await this.getProduct(guildId, id);
    if (!existing) throw new ShopError('product_not_found');
    const data: Prisma.ShopProductUncheckedUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name.slice(0, 100);
    if (patch.price !== undefined) data.price = parsePrice(patch.price);
    if (patch.currency !== undefined) data.currency = patch.currency.toUpperCase().slice(0, 8);
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.imageUrl !== undefined) data.imageUrl = patch.imageUrl;
    if (patch.stock !== undefined) data.stock = patch.stock;
    if (patch.categoryId !== undefined) data.categoryId = patch.categoryId;
    if (patch.tebexPackageId !== undefined) data.tebexPackageId = patch.tebexPackageId;
    if (patch.tebexUrl !== undefined) data.tebexUrl = patch.tebexUrl;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    const product = await prisma.shopProduct.update({ where: { id }, data });
    await loggingService.log({ guildId, category: LogCategory.SHOP, action: 'shop.product.edit', title: `🛒 Produit modifié : ${product.name}`, actorId: actorId ?? null, data: { productId: id, patch } });
    return product;
  }

  async removeProduct(guildId: string, id: number, actorId?: string): Promise<ShopProduct> {
    const existing = await this.getProduct(guildId, id);
    if (!existing) throw new ShopError('product_not_found');
    await prisma.shopProduct.delete({ where: { id } });
    await loggingService.log({ guildId, category: LogCategory.SHOP, action: 'shop.product.remove', title: `🛒 Produit supprimé : ${existing.name}`, actorId: actorId ?? null, data: { productId: id } });
    return existing;
  }

  // ───── Commandes ─────

  /** Crée une commande PENDING, décrémente le stock si défini (atomique), refuse si épuisé. */
  async createOrder(input: { guildId: string; userId: string; productId: number; quantity?: number; note?: string | null; actorId?: string }): Promise<OrderWithProduct> {
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new ShopError('invalid_quantity');
    const order = await prisma.$transaction(async (tx) => {
      const product = await tx.shopProduct.findUnique({ where: { id: input.productId } });
      if (!product || product.guildId !== input.guildId) throw new ShopError('product_not_found');
      if (!product.enabled) throw new ShopError('product_disabled');
      const newStock = decrementStock(product.stock, quantity);
      if (newStock !== null) {
        const r = await tx.shopProduct.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: newStock } });
        if (r.count === 0) throw new ShopError('out_of_stock');
      }
      const total = new Prisma.Decimal(product.price).mul(quantity);
      return tx.shopOrder.create({
        data: { guildId: input.guildId, userId: input.userId, productId: product.id, quantity, total, currency: product.currency, status: OrderStatus.PENDING, note: input.note ?? null },
        include: { product: true },
      });
    });
    await loggingService.log({
      guildId: input.guildId,
      category: LogCategory.SHOP,
      action: 'shop.order.create',
      title: `🛒 Commande #${order.id}`,
      description: `<@${order.userId}> — ${order.product?.name ?? '—'} ×${order.quantity} — ${formatPrice(order.total, order.currency)}`,
      actorId: input.actorId ?? input.userId,
      targetId: input.userId,
      data: { orderId: order.id, productId: order.productId, quantity, total: order.total.toString() },
    });
    return order;
  }

  async getOrder(guildId: string, id: number): Promise<OrderWithProduct | null> {
    const o = await prisma.shopOrder.findUnique({ where: { id }, include: { product: true } });
    return o && o.guildId === guildId ? o : null;
  }

  async updateOrderStatus(guildId: string, id: number, status: OrderStatus, actorId?: string, note?: string | null): Promise<OrderWithProduct> {
    const order = await this.getOrder(guildId, id);
    if (!order) throw new ShopError('order_not_found');
    if (!canTransition(order.status, status)) throw new ShopError('invalid_transition');
    const updated = await prisma.$transaction(async (tx) => {
      if (releasesStock(order.status, status) && order.productId) {
        const product = await tx.shopProduct.findUnique({ where: { id: order.productId } });
        if (product && product.stock !== null) await tx.shopProduct.update({ where: { id: product.id }, data: { stock: restoreStock(product.stock, order.quantity) } });
      }
      return tx.shopOrder.update({ where: { id }, data: { status, ...(note !== undefined ? { note } : {}) }, include: { product: true } });
    });
    await loggingService.log({
      guildId,
      category: LogCategory.SHOP,
      action: 'shop.order.status',
      title: `🛒 Commande #${id} → ${status}`,
      description: `<@${order.userId}> — ${order.product?.name ?? '—'}`,
      actorId: actorId ?? null,
      targetId: order.userId,
      data: { orderId: id, from: order.status, to: status },
    });
    return updated;
  }

  listOrders(guildId: string, status?: OrderStatus, take = 100): Promise<OrderWithProduct[]> {
    return prisma.shopOrder.findMany({ where: { guildId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take, include: { product: true } });
  }

  history(guildId: string, userId: string, take = 50): Promise<OrderWithProduct[]> {
    return prisma.shopOrder.findMany({ where: { guildId, userId }, orderBy: { createdAt: 'desc' }, take, include: { product: true } });
  }

  /** Associe un ticket de support à une commande (utilisé par le module tickets). */
  async linkTicket(orderId: number, ticketId: number): Promise<ShopOrder> {
    return prisma.shopOrder.update({ where: { id: orderId }, data: { ticketId } });
  }

  // ───── Tebex ─────

  /**
   * Webhook Tebex (normalisé) : met à jour la commande liée au package.
   * Recherche : commande avec ce `tebexTransactionId`, sinon dernière commande PENDING du client (discordId) pour ce package,
   * sinon création d'une commande directement au statut reçu (achat fait sur Tebex sans passer par Discord).
   */
  async handleTebexWebhook(raw: unknown): Promise<{ ok: true; orderId: number; status: OrderStatus; created: boolean } | { ok: false; reason: 'unknown_package' | 'no_order' }> {
    const payload = tebexWebhookSchema.parse(raw);
    const product = await prisma.shopProduct.findFirst({ where: { tebexPackageId: payload.packageId } });
    if (!product) return { ok: false, reason: 'unknown_package' };

    let order = await prisma.shopOrder.findFirst({ where: { tebexTransactionId: payload.transactionId }, include: { product: true } });
    if (!order && payload.discordId) {
      order = await prisma.shopOrder.findFirst({ where: { guildId: product.guildId, userId: payload.discordId, productId: product.id, status: OrderStatus.PENDING }, orderBy: { createdAt: 'desc' }, include: { product: true } });
    }
    if (order) {
      const target = canTransition(order.status, payload.status) ? payload.status : order.status;
      const updated = await prisma.shopOrder.update({ where: { id: order.id }, data: { status: target, tebexTransactionId: payload.transactionId, ...(payload.note ? { note: payload.note } : {}) } });
      await loggingService.log({ guildId: product.guildId, category: LogCategory.SHOP, action: 'shop.tebex.update', title: `🛒 Tebex ${payload.transactionId} → commande #${order.id} (${target})`, targetId: order.userId, data: { orderId: order.id, transactionId: payload.transactionId, status: target } });
      return { ok: true, orderId: updated.id, status: updated.status, created: false };
    }
    if (!payload.discordId) {
      log.warn({ transactionId: payload.transactionId, packageId: payload.packageId }, 'Webhook Tebex sans commande ni discordId');
      return { ok: false, reason: 'no_order' };
    }
    const quantity = payload.quantity ?? 1;
    const created = await prisma.shopOrder.create({
      data: { guildId: product.guildId, userId: payload.discordId, productId: product.id, quantity, total: new Prisma.Decimal(product.price).mul(quantity), currency: product.currency, status: payload.status, tebexTransactionId: payload.transactionId, note: payload.note ?? null },
    });
    await loggingService.log({ guildId: product.guildId, category: LogCategory.SHOP, action: 'shop.tebex.create', title: `🛒 Tebex ${payload.transactionId} → nouvelle commande #${created.id} (${created.status})`, targetId: payload.discordId, data: { orderId: created.id, transactionId: payload.transactionId } });
    return { ok: true, orderId: created.id, status: created.status, created: true };
  }
}

export const CATALOG_PAGE_SIZE = 5;

export interface CatalogPage {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  page: number;
  total: number;
}

/**
 * Rend une page du catalogue (5 produits max, un bouton « Commander » par produit + navigation stateless
 * `shop:page:<n>:<categoryId|all>`), triée par catégorie.
 */
export function buildCatalogPage(input: { guildId: string; lang: string; products: ProductWithCategory[]; categories: ShopCategory[]; page: number; categoryId: number | null; color?: number }): CatalogPage {
  const t = translationService.bind(input.lang, input.guildId);
  const filtered = input.categoryId !== null ? input.products.filter((p) => p.categoryId === input.categoryId) : input.products;
  const pages = chunk(filtered, CATALOG_PAGE_SIZE);
  const total = Math.max(1, pages.length);
  const page = Math.min(Math.max(0, input.page), total - 1);
  const items = pages[page] ?? [];
  const embed = new EmbedBuilder().setColor((input.color ?? BRAND.colors.primary) as ColorResolvable).setTitle(t('shop.catalog.title')).setFooter({ text: `${BRAND.footer} • ${t('core.page', { current: page + 1, total })}` });
  const catName = input.categoryId !== null ? input.categories.find((c) => c.id === input.categoryId) : null;
  if (catName) embed.setDescription(`${catName.emoji ?? '📦'} **${catName.name}**${catName.description ? `\n${catName.description}` : ''}`);
  if (!items.length) embed.setDescription(t('shop.catalog.empty'));
  for (const p of items) {
    const stock = p.stock === null ? t('shop.catalog.unlimited') : p.stock > 0 ? t('shop.catalog.in_stock', { stock: p.stock }) : t('shop.catalog.sold_out');
    embed.addFields({ name: `${p.category?.emoji ?? '📦'} ${p.name} — ${formatPrice(p.price, p.currency)}`, value: `${p.description ? `${p.description.slice(0, 300)}\n` : ''}\`#${p.id}\` · ${stock}${p.tebexUrl ? ` · [Tebex](${p.tebexUrl})` : ''}` });
  }
  const first = items[0];
  if (first?.imageUrl && items.length === 1) embed.setImage(first.imageUrl);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (items.length) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...items.map((p) => new ButtonBuilder().setCustomId(buildCustomId('shop', 'order', p.id)).setLabel(`${t('shop.catalog.order')} ${p.name}`.slice(0, 80)).setEmoji('🛒').setStyle(ButtonStyle.Primary).setDisabled(p.stock !== null && p.stock <= 0)),
      ),
    );
  }
  if (total > 1) {
    const cat = input.categoryId === null ? 'all' : String(input.categoryId);
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId('shop', 'page', page - 1, cat)).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(buildCustomId('shop', 'page', 'cur', cat)).setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(buildCustomId('shop', 'page', page + 1, cat)).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1),
      ),
    );
  }
  return { embeds: [embed], components, page, total };
}

/** Embed d'annonce produit (image, prix, stock) + bouton lien Tebex + bouton commander. */
export function buildProductAnnouncement(product: ProductWithCategory, lang: string, color?: number): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const t = translationService.bind(lang, product.guildId);
  const embed = new EmbedBuilder()
    .setColor((color ?? BRAND.colors.primary) as ColorResolvable)
    .setTitle(`${product.category?.emoji ?? '🛒'} ${product.name}`)
    .setDescription(product.description?.slice(0, 2000) || null)
    .addFields(
      { name: t('shop.product.price'), value: formatPrice(product.price, product.currency), inline: true },
      { name: t('shop.product.stock'), value: product.stock === null ? t('shop.catalog.unlimited') : String(product.stock), inline: true },
      ...(product.category ? [{ name: t('shop.product.category'), value: product.category.name, inline: true }] : []),
    )
    .setFooter({ text: `${BRAND.footer} • #${product.id}` });
  if (product.imageUrl) embed.setImage(product.imageUrl);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(buildCustomId('shop', 'order', product.id)).setLabel(t('shop.catalog.order')).setEmoji('🛒').setStyle(ButtonStyle.Primary));
  if (product.tebexUrl) row.addComponents(new ButtonBuilder().setLabel('Tebex').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(product.tebexUrl));
  return { embeds: [embed], components: [row] };
}

/** Récapitulatif de commande (éphémère + DM). */
export function buildOrderSummary(order: OrderWithProduct, lang: string, color?: number): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const t = translationService.bind(lang, order.guildId);
  const embed = new EmbedBuilder()
    .setColor((color ?? BRAND.colors.primary) as ColorResolvable)
    .setTitle(t('shop.order.summary_title', { id: order.id }))
    .addFields(
      { name: t('shop.order.product'), value: order.product?.name ?? '—', inline: true },
      { name: t('shop.order.quantity'), value: String(order.quantity), inline: true },
      { name: t('shop.order.total'), value: formatPrice(order.total, order.currency), inline: true },
      { name: t('shop.order.status'), value: t(`shop.status.${order.status.toLowerCase()}`), inline: true },
    )
    .setFooter({ text: `${BRAND.footer} • #${order.id}` })
    .setTimestamp(order.createdAt);
  if (order.note) embed.addFields({ name: t('shop.order.note'), value: order.note.slice(0, 1024) });
  if (order.product?.tebexUrl) embed.setDescription(t('shop.order.pay_hint'));
  else embed.setDescription(t('shop.order.support_hint'));
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (order.product?.tebexUrl) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel(t('shop.order.pay_button')).setEmoji('💳').setStyle(ButtonStyle.Link).setURL(order.product.tebexUrl)));
  return { embeds: [embed], components };
}

export const shopService = new ShopService();
