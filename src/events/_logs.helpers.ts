import { AuditLogEvent, PermissionsBitField, type Guild, type GuildAuditLogsEntry, type User } from 'discord.js';
import { guildConfigService, type ResolvedGuildConfig } from '../services/GuildConfigService';
import { translationService, type Translator } from '../services/TranslationService';
import { logHubService } from '../services/LogHubService';

/**
 * Helpers partagés par les événements de logs (fichier préfixé `_` : ignoré par le loader).
 */
export interface LogCtx {
  cfg: ResolvedGuildConfig;
  t: Translator;
  lang: string;
}

/**
 * Contexte de log d'un serveur (langue par défaut), null si le module logs est désactivé ET que le serveur n'est pas relié
 * à un serveur de logs central (hub) : une source reliée envoie ses logs au hub même sans salons de logs locaux.
 */
export async function logContext(guildId: string): Promise<LogCtx | null> {
  const cfg = await guildConfigService.get(guildId);
  if (!cfg) return null;
  if (!cfg.modules.logs && !(await logHubService.getSourceLink(guildId).catch(() => null))) return null;
  return { cfg, t: translationService.bind(cfg.defaultLanguage, guildId), lang: cfg.defaultLanguage };
}

export function trunc(value: string | null | undefined, max = 1024): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function userLine(user: User | { id: string; tag?: string; username?: string }): string {
  const tag = 'tag' in user && user.tag ? user.tag : user.username;
  return `<@${user.id}>${tag ? ` • ${tag}` : ''} (\`${user.id}\`)`;
}

export interface AuditInfo {
  executor: User | null;
  reason: string | null;
  entry: GuildAuditLogsEntry;
}

/**
 * Cherche dans l'audit log l'entrée récente (< maxAgeMs) du type donné visant `targetId`.
 * Nécessite ViewAuditLog ; retourne null sinon.
 */
export async function fetchAudit(guild: Guild, type: AuditLogEvent, targetId?: string | null, maxAgeMs = 10_000): Promise<AuditInfo | null> {
  const me = guild.members.me;
  if (!me?.permissions.has('ViewAuditLog')) return null;
  const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
  if (!logs) return null;
  const now = Date.now();
  const entry = logs.entries.find((e) => now - e.createdTimestamp < maxAgeMs && (!targetId || e.targetId === targetId));
  if (!entry) return null;
  const executor = entry.executor && !entry.executor.partial ? (entry.executor as User) : entry.executorId ? await guild.client.users.fetch(entry.executorId).catch(() => null) : null;
  return { executor, reason: entry.reason ?? null, entry };
}

/** Liste lisible des permissions ajoutées / retirées entre deux bitfields. */
export function permissionDiff(before: PermissionsBitField, after: PermissionsBitField): { added: string[]; removed: string[] } {
  const b = new Set(before.toArray());
  const a = new Set(after.toArray());
  return { added: [...a].filter((p) => !b.has(p)), removed: [...b].filter((p) => !a.has(p)) };
}

export function joinOrNone(list: string[], t: Translator, sep = ', '): string {
  return list.length ? trunc(list.join(sep)) : t('core.none');
}

export const AUDIT = AuditLogEvent;
