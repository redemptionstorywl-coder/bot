import { vi } from 'vitest';

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Crée un mock Prisma "profond" : chaque `prisma.<model>.<method>` est un vi.fn().
 * Usage :
 *   vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
 */
export function createPrismaMock(): Record<string, Record<string, ReturnType<typeof vi.fn>>> & { $transaction: AnyFn; $queryRaw: AnyFn; $connect: AnyFn; $disconnect: AnyFn } {
  const methods = ['findUnique', 'findFirst', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'groupBy', 'aggregate'];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      const model: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const m of methods) model[m] = vi.fn().mockResolvedValue(m.startsWith('find') ? (m === 'findMany' ? [] : null) : m === 'count' ? 0 : {});
      target[prop] = model;
      return model;
    },
  };
  const base: Record<string, unknown> = {
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as AnyFn)(proxy) : Promise.all(arg as Promise<unknown>[]))),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
  const proxy = new Proxy(base, handler);
  return proxy as never;
}
