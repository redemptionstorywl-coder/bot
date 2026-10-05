import { prisma } from '../database/client';
import type { Command, InternalPermission } from '../structures/types';
import { TTLCache } from '../utils/cache';

/** Réglage d'une commande pour un serveur (table CommandPermission). */
export interface CommandRule {
  /** Rôles autorisés. Vide = règle par défaut de la commande (niveau interne + permissions Discord). */
  roleIds: string[];
  /** false = commande désactivée sur ce serveur. */
  enabled: boolean;
}

/** Description d'une commande pour les écrans de permissions (panneau /config et dashboard). */
export interface CommandInfo {
  name: string;
  description: string;
  /** Catégorie = dossier de src/commands (moderation, tickets…) */
  category: string;
  /** Niveau interne requis par défaut */
  defaultLevel: InternalPermission;
  /** Commande qui ne peut pas être restreinte (sinon un serveur pourrait se verrouiller dehors). */
  locked: boolean;
}

export type AccessDecision =
  /** Aucune règle : appliquer les vérifications par défaut de la commande. */
  | 'default'
  /** Autorisé par un rôle configuré (ou propriétaire) : ignorer niveau interne et permissions Discord. */
  | 'allow'
  | 'deny_disabled'
  | 'deny_role';

/** Commandes jamais restreignables : un serveur ne doit pas pouvoir se couper l'accès à sa propre configuration. */
export const LOCKED_COMMANDS = ['config', 'help'];

/**
 * Décision pure d'accès à une commande.
 * - Propriétaire du serveur / OWNER_IDS : toujours autorisé (ne peut pas se verrouiller dehors).
 * - Commande désactivée : refusée pour tous les autres.
 * - Rôles configurés : autorisé si le membre a l'un des rôles (ou est Administrateur Discord), refusé sinon.
 *   Un rôle configuré DONNE l'accès même sans le niveau interne ni la permission Discord par défaut.
 * - Aucune règle : vérifications par défaut.
 */
export function decideCommandAccess(input: { rule: CommandRule | null; memberRoleIds: readonly string[]; isOwner: boolean; isDiscordAdmin: boolean; locked?: boolean }): AccessDecision {
  const { rule, memberRoleIds, isOwner, isDiscordAdmin, locked } = input;
  if (isOwner) return 'allow';
  if (!rule || locked) return 'default';
  if (!rule.enabled) return 'deny_disabled';
  if (!rule.roleIds.length) return 'default';
  if (isDiscordAdmin || rule.roleIds.some((r) => memberRoleIds.includes(r))) return 'allow';
  return 'deny_role';
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^\d{15,22}$/.test(x)) : [];
}

/**
 * Permissions des commandes par rôle, configurables par serveur (panneau `/config module:permissions` et dashboard).
 * Lecture en cache (5 min) : aucune requête SQL par commande exécutée hors premier accès.
 */
export class CommandPermissionService {
  private readonly cache = new TTLCache<Map<string, CommandRule>>(5 * 60_000, 2000);

  /** Catalogue des commandes slash pour l'affichage (triées par catégorie puis nom). */
  catalog(commands: Iterable<Command>): CommandInfo[] {
    const out: CommandInfo[] = [];
    for (const c of commands) {
      out.push({
        name: c.data.name,
        description: c.data.description,
        category: c.category ?? 'misc',
        defaultLevel: c.permissions?.internal ?? 'everyone',
        locked: LOCKED_COMMANDS.includes(c.data.name),
      });
    }
    return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  /** Toutes les règles d'un serveur (commande → règle). */
  async rules(guildId: string): Promise<Map<string, CommandRule>> {
    return this.cache.getOrSet(guildId, async () => {
      const rows = await prisma.commandPermission.findMany({ where: { guildId } });
      return new Map(rows.map((r) => [r.commandName, { roleIds: asIds(r.roleIds), enabled: r.enabled }]));
    });
  }

  async get(guildId: string, command: string): Promise<CommandRule | null> {
    return (await this.rules(guildId)).get(command) ?? null;
  }

  /**
   * Définit la règle d'une ou plusieurs commandes. Une règle revenue à l'état par défaut (activée, sans rôle) est supprimée.
   * Les commandes verrouillées (LOCKED_COMMANDS) sont ignorées.
   */
  async set(guildId: string, commands: string | string[], patch: Partial<CommandRule>): Promise<number> {
    const names = (Array.isArray(commands) ? commands : [commands]).filter((n) => !LOCKED_COMMANDS.includes(n));
    const current = await this.rules(guildId);
    let changed = 0;
    for (const commandName of names) {
      const prev = current.get(commandName) ?? { roleIds: [], enabled: true };
      const next: CommandRule = { roleIds: patch.roleIds ? asIds(patch.roleIds).slice(0, 25) : prev.roleIds, enabled: patch.enabled ?? prev.enabled };
      if (next.enabled && !next.roleIds.length) {
        const { count } = await prisma.commandPermission.deleteMany({ where: { guildId, commandName } });
        changed += count;
      } else {
        await prisma.commandPermission.upsert({
          where: { guildId_commandName: { guildId, commandName } },
          create: { guildId, commandName, roleIds: next.roleIds, enabled: next.enabled },
          update: { roleIds: next.roleIds, enabled: next.enabled },
        });
        changed++;
      }
    }
    this.invalidate(guildId);
    return changed;
  }

  /** Remet une ou plusieurs commandes (ou toutes si `commands` est omis) au comportement par défaut. */
  async reset(guildId: string, commands?: string | string[]): Promise<number> {
    const where = commands ? { guildId, commandName: { in: Array.isArray(commands) ? commands : [commands] } } : { guildId };
    const { count } = await prisma.commandPermission.deleteMany({ where });
    this.invalidate(guildId);
    return count;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}

export const commandPermissionService = new CommandPermissionService();
