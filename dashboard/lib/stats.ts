import type { RedemptionClient } from '../../src/core/Client';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import { scheduler } from '../../src/services/SchedulerService';
import { prisma } from '../../src/database/client';
import { MODULE_KEYS, MODULE_LABELS, GUILD_KIND_LABELS, type ModuleKey } from '../../src/config/constants';
import type { GuildView } from './guildData';

export interface GuildOverview {
  guildId: string;
  members: number;
  /** Membres en ligne (présences en cache) ; null si inconnu */
  online: number | null;
  channels: number;
  roles: number;
  uptimeSeconds: number;
  pingMs: number;
  modules: { active: number; total: number; list: { key: ModuleKey; label: string; enabled: boolean }[] };
  kind: string;
  kindLabel: string;
  defaultLanguage: string;
  tasks: string[];
  counts: { openTickets: number; activeWarnings: number; sanctions: number; sanctions7d: number; logs: number };
}

/** Membres en ligne d'après les présences en cache (intent GuildPresences) ; null si indisponible. */
export function onlineCount(client: RedemptionClient, guildId: string): number | null {
  if (!client.isReady()) return null;
  const guild = client.guilds.cache.get(guildId) as unknown as { presences?: { cache?: { filter(fn: (p: { status: string }) => boolean): { size: number } } } } | undefined;
  const cache = guild?.presences?.cache;
  if (!cache || typeof cache.filter !== 'function') return null;
  return cache.filter((p) => p.status !== 'offline').size;
}

/** Statistiques de la vue d'ensemble d'un serveur (page + API /overview). */
export async function buildOverview(client: RedemptionClient, guild: GuildView, config: ResolvedGuildConfig): Promise<GuildOverview> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [openTickets, activeWarnings, sanctions, sanctions7d, logs] = await Promise.all([
    prisma.ticket.count({ where: { guildId: guild.id, status: { in: ['OPEN', 'CLAIMED'] } } }),
    prisma.warning.count({ where: { guildId: guild.id, active: true } }),
    prisma.sanction.count({ where: { guildId: guild.id } }),
    prisma.sanction.count({ where: { guildId: guild.id, createdAt: { gte: weekAgo } } }),
    prisma.log.count({ where: { guildId: guild.id } }),
  ]);
  const list = MODULE_KEYS.map((key) => ({ key, label: MODULE_LABELS[key], enabled: config.modules[key] }));
  return {
    guildId: guild.id,
    members: guild.memberCount,
    online: onlineCount(client, guild.id),
    channels: guild.channelCount,
    roles: guild.roleCount,
    uptimeSeconds: client.uptimeSeconds,
    pingMs: client.isReady() ? Math.max(0, Math.round(client.ws.ping)) : -1,
    modules: { active: list.filter((m) => m.enabled).length, total: list.length, list },
    kind: config.kind,
    kindLabel: GUILD_KIND_LABELS[config.kind],
    defaultLanguage: config.defaultLanguage,
    tasks: scheduler.registered,
    counts: { openTickets: openTickets ?? 0, activeWarnings: activeWarnings ?? 0, sanctions: sanctions ?? 0, sanctions7d: sanctions7d ?? 0, logs: logs ?? 0 },
  };
}
