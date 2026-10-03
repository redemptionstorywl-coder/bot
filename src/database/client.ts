import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * Instance unique de Prisma (évite les connexions multiples en mode watch).
 */
export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }] : [{ emit: 'event', level: 'error' }],
  });

if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;

// @ts-expect-error - event typing depends on log config
prisma.$on('error', (e: { message: string }) => logger.error({ err: e.message }, 'Prisma error'));
// @ts-expect-error - event typing depends on log config
prisma.$on('warn', (e: { message: string }) => logger.warn({ msg: e.message }, 'Prisma warning'));

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Base de données connectée');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
