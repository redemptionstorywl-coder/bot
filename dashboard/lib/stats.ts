import type { RedemptionClient } from '../../src/core/Client';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import { translationService } from '../../src/services/TranslationService';
import { scheduler } from '../../src/services/SchedulerService';
import { prisma } from '../../src/database/client';
import { LANGUAGES, MODULE_KEYS, MODULE_LABELS, GUILD_KIND_LABELS, type ModuleKey } from '../../src/config/constants';
import type { GuildView } from './guildData';

export interface LanguageStat {
  code: string;
  label: string;
  flag: string;
  count: number;
  percent: number;
}

export interface GuildOverview {
  guildId: string;
  members: number;
  channels: number;
  roles: number;
  uptimeSeconds: number;
  pingMs: number;
  modules: { active: number; total: number; list: { key: ModuleKey; label: string; enabled: boolean }[] };
  kind: string;
  kindLabel: string;
  defaultLanguage: string;
  enabledLanguages: string[];
  languages: LanguageStat[];
  languageUsers: number;
  tasks: string[];
  counts: { openTickets: number; activeWarnings: number; sanctions: number; logs: number };
}

/** Statistiques du dashboard d'un serveur (page + API /overview). */
export async function buildOverview(client: RedemptionClient, guild: GuildView, config: ResolvedGuildConfig): Promise<GuildOverview> {
  const [byLanguage, openTickets, activeWarnings, sanctions, logs] = await Promise.all([
    translationService.countByLanguage(guild.id),
    prisma.ticket.count({ where: { guildId: guild.id, status: { in: ['OPEN', 'CLAIMED'] } } }),
    prisma.warning.count({ where: { guildId: guild.id, active: true } }),
    prisma.sanction.count({ where: { guildId: guild.id } }),
    prisma.log.count({ where: { guildId: guild.id } }),
  ]);
  const languageUsers = Object.values(byLanguage).reduce((a, b) => a + b, 0);
  const languages: LanguageStat[] = LANGUAGES.filter((l) => config.enabledLanguages.includes(l.code) || byLanguage[l.code])
    .map((l) => ({ code: l.code, label: l.nativeLabel, flag: l.flag, count: byLanguage[l.code] ?? 0, percent: languageUsers ? Math.round(((byLanguage[l.code] ?? 0) / languageUsers) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const list = MODULE_KEYS.map((key) => ({ key, label: MODULE_LABELS[key], enabled: config.modules[key] }));
  return {
    guildId: guild.id,
    members: guild.memberCount,
    channels: guild.channelCount,
    roles: guild.roleCount,
    uptimeSeconds: client.uptimeSeconds,
    pingMs: client.isReady() ? Math.max(0, Math.round(client.ws.ping)) : -1,
    modules: { active: list.filter((m) => m.enabled).length, total: list.length, list },
    kind: config.kind,
    kindLabel: GUILD_KIND_LABELS[config.kind],
    defaultLanguage: config.defaultLanguage,
    enabledLanguages: config.enabledLanguages,
    languages,
    languageUsers,
    tasks: scheduler.registered,
    counts: { openTickets, activeWarnings, sanctions, logs },
  };
}
