import type { FiveMPlayer } from '@prisma/client';
import { prisma } from '../../src/database/client';

/**
 * Lecture seule des joueurs FiveM connus (table FiveMPlayer, alimentée par FiveMSyncService) pour l'onglet « Joueurs ».
 * Aucune écriture ici : la liaison manuelle passe par fivemSyncService.linkManually.
 */
export interface PlayerListOptions {
  q?: string;
  filter?: 'all' | 'linked' | 'unlinked' | 'online';
  page?: number;
  pageSize?: number;
}

export async function listFiveMPlayers(guildId: string, opts: PlayerListOptions = {}): Promise<{ items: FiveMPlayer[]; total: number; page: number; pages: number; counts: { all: number; linked: number; online: number } }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const q = opts.q?.trim();
  const where = {
    guildId,
    ...(opts.filter === 'linked' ? { discordId: { not: null } } : opts.filter === 'unlinked' ? { discordId: null } : opts.filter === 'online' ? { online: true } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { license: { contains: q } }, { discordId: q }, { steam: { contains: q } }] } : {}),
  };
  const [total, all, linked, online] = await Promise.all([
    prisma.fiveMPlayer.count({ where }),
    prisma.fiveMPlayer.count({ where: { guildId } }),
    prisma.fiveMPlayer.count({ where: { guildId, discordId: { not: null } } }),
    prisma.fiveMPlayer.count({ where: { guildId, online: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(opts.page ?? 1, 1), pages);
  const items = await prisma.fiveMPlayer.findMany({ where, orderBy: [{ online: 'desc' }, { lastSeenAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize });
  return { items, total, page, pages, counts: { all, linked, online } };
}
