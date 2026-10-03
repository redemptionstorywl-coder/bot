import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { Prisma } from '@prisma/client';
import { prisma } from '../../src/database/client';
import { ShopService, ShopError, decrementStock, restoreStock, formatPrice, parsePrice, canTransition, releasesStock, tebexWebhookSchema } from '../../src/services/ShopService';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const guildId = '123456789012345678';

describe('stock (fonctions pures)', () => {
  it('décrémente et refuse si épuisé', () => {
    expect(decrementStock(5, 2)).toBe(3);
    expect(decrementStock(null, 99)).toBeNull();
    expect(() => decrementStock(1, 2)).toThrow(ShopError);
    expect(() => decrementStock(0, 1)).toThrowError(expect.objectContaining({ code: 'out_of_stock' }));
    expect(() => decrementStock(5, 0)).toThrowError(expect.objectContaining({ code: 'invalid_quantity' }));
  });
  it('restaure le stock', () => {
    expect(restoreStock(3, 2)).toBe(5);
    expect(restoreStock(null, 2)).toBeNull();
  });
  it('formate les prix avec 2 décimales', () => {
    expect(formatPrice(new Prisma.Decimal('9.9'), 'EUR')).toBe('9.90 EUR');
    expect(formatPrice(12, 'USD')).toBe('12.00 USD');
    expect(formatPrice('3.456')).toBe('3.46 EUR');
    expect(parsePrice('4,5').toFixed(2)).toBe('4.50');
    expect(() => parsePrice('abc')).toThrow(ShopError);
  });
  it('transitions de statut', () => {
    expect(canTransition('PENDING', 'PAID')).toBe(true);
    expect(canTransition('CANCELLED', 'PAID')).toBe(false);
    expect(canTransition('DELIVERED', 'REFUNDED')).toBe(true);
    expect(releasesStock('PENDING', 'CANCELLED')).toBe(true);
    expect(releasesStock('CANCELLED', 'REFUNDED')).toBe(false);
  });
  it('webhook Tebex : alias de statut', () => {
    expect(tebexWebhookSchema.parse({ transactionId: 't', packageId: 123, status: 'complete' }).status).toBe('PAID');
    expect(tebexWebhookSchema.parse({ transactionId: 't', packageId: '1', status: 'chargeback' }).status).toBe('REFUNDED');
    expect(tebexWebhookSchema.safeParse({ transactionId: 't', packageId: '1', status: 'weird' }).success).toBe(false);
  });
});

describe('ShopService.createOrder', () => {
  const service = new ShopService();
  const product = { id: 7, guildId, name: 'VIP', price: new Prisma.Decimal('9.99'), currency: 'EUR', stock: 2, enabled: true, categoryId: null, tebexUrl: null };
  beforeEach(() => {
    db.log.create.mockResolvedValue({});
    db.guild.findUnique.mockResolvedValue(null);
  });
  it('crée une commande et décrémente le stock', async () => {
    db.shopProduct.findUnique.mockResolvedValue(product);
    db.shopProduct.updateMany.mockResolvedValue({ count: 1 });
    db.shopOrder.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data, product, createdAt: new Date(), updatedAt: new Date() }));
    const order = await service.createOrder({ guildId, userId: '1', productId: 7, quantity: 2 });
    expect(order.total.toString()).toBe('19.98');
    expect(db.shopProduct.updateMany).toHaveBeenCalledWith({ where: { id: 7, stock: { gte: 2 } }, data: { stock: 0 } });
  });
  it('refuse si le stock est épuisé', async () => {
    db.shopProduct.findUnique.mockResolvedValue({ ...product, stock: 0 });
    await expect(service.createOrder({ guildId, userId: '1', productId: 7 })).rejects.toMatchObject({ code: 'out_of_stock' });
    expect(db.shopOrder.create).not.toHaveBeenCalled();
  });
  it('refuse si la mise à jour conditionnelle échoue (course)', async () => {
    db.shopProduct.findUnique.mockResolvedValue(product);
    db.shopProduct.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.createOrder({ guildId, userId: '1', productId: 7 })).rejects.toMatchObject({ code: 'out_of_stock' });
  });
  it('ignore le stock illimité et refuse un produit désactivé ou d’un autre serveur', async () => {
    db.shopProduct.findUnique.mockResolvedValue({ ...product, stock: null });
    db.shopOrder.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 2, ...data, product }));
    await service.createOrder({ guildId, userId: '1', productId: 7 });
    expect(db.shopProduct.updateMany).not.toHaveBeenCalled();
    db.shopProduct.findUnique.mockResolvedValue({ ...product, enabled: false });
    await expect(service.createOrder({ guildId, userId: '1', productId: 7 })).rejects.toMatchObject({ code: 'product_disabled' });
    db.shopProduct.findUnique.mockResolvedValue({ ...product, guildId: 'other' });
    await expect(service.createOrder({ guildId, userId: '1', productId: 7 })).rejects.toMatchObject({ code: 'product_not_found' });
  });
});
