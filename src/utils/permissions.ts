import { GuildMember, PermissionFlagsBits, PermissionResolvable, PermissionsBitField } from 'discord.js';
import type { InternalPermission } from '../structures/types';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import { DEFAULT_TEAM_ROLE_NAMES } from '../config/constants';

const normalizeRoleName = (n: string) => n.replace(/[\s・·|•-]+/g, ' ').trim().toLowerCase();
const TEAM_NAMES = DEFAULT_TEAM_ROLE_NAMES.map(normalizeRoleName);

/** Vrai si le nom de rôle est un nom « équipe » reconnu (ex. 🛡️ RS Team). */
export function isTeamRoleName(name: string): boolean {
  return TEAM_NAMES.includes(normalizeRoleName(name));
}

/** Vrai si le membre porte un rôle « équipe » reconnu par son nom (ex. 🛡️ RS Team). */
export function hasTeamRole(member: GuildMember): boolean {
  return member.roles.cache.some((r) => isTeamRoleName(r.name));
}

const LEVELS: Record<InternalPermission, number> = { everyone: 0, staff: 1, admin: 2, owner: 3 };

export interface PermissionCheckInput {
  member: GuildMember | null;
  config: ResolvedGuildConfig | null;
  ownerIds: string[];
  required: InternalPermission;
}

/** Détermine le niveau interne d'un membre : owner > admin > staff > everyone. */
export function resolveInternalLevel(member: GuildMember | null, config: ResolvedGuildConfig | null, ownerIds: string[]): InternalPermission {
  if (!member) return 'everyone';
  if (ownerIds.includes(member.id) || member.guild.ownerId === member.id) return 'owner';
  const roles = member.roles.cache;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return 'admin';
  if (config?.adminRoleIds.some((r) => roles.has(r))) return 'admin';
  if (hasTeamRole(member)) return 'admin';
  if (config?.staffRoleIds.some((r) => roles.has(r))) return 'staff';
  if (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.ModerateMembers)) return 'staff';
  return 'everyone';
}

export function hasInternalPermission(input: PermissionCheckInput): boolean {
  const level = resolveInternalLevel(input.member, input.config, input.ownerIds);
  return LEVELS[level] >= LEVELS[input.required];
}

export function missingDiscordPermissions(perms: Readonly<PermissionsBitField> | null | undefined, required: PermissionResolvable[]): string[] {
  if (!perms) return required.map(String);
  return perms.missing(required);
}

/** Vérifie si le bot peut gérer un rôle (hiérarchie). */
export function canManageRole(me: GuildMember | null, roleId: string): boolean {
  if (!me) return false;
  const role = me.guild.roles.cache.get(roleId);
  if (!role) return false;
  if (role.managed) return false;
  return me.roles.highest.comparePositionTo(role) > 0 && me.permissions.has(PermissionFlagsBits.ManageRoles);
}

/** Vérifie si `actor` peut sanctionner `target` (hiérarchie des rôles). */
export function canModerate(actor: GuildMember, target: GuildMember): boolean {
  if (actor.guild.ownerId === actor.id) return true;
  if (target.guild.ownerId === target.id) return false;
  return actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}
