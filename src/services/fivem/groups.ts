import { z } from 'zod';

/**
 * Rôles Discord → groupes en jeu (ACE `group.<nom>`) : fonctions pures (testées dans tests/fivem/groups.test.ts).
 * La liste `FiveMServer.roleGroups` est ordonnée : le premier groupe détenu est le groupe principal (« le plus haut gagne »).
 */

/** Nom de groupe accepté : minuscules, chiffres, `_`, `-`, `.` (injecté dans `add_principal … group.<nom>` côté Lua). */
export const GROUP_NAME = /^[a-z0-9_.-]{1,32}$/;
export const MAX_ROLE_GROUPS = 25;

export const roleGroupSchema = z.object({
  roleId: z.string().regex(/^\d{15,22}$/, 'ID de rôle attendu'),
  group: z
    .string()
    .trim()
    .toLowerCase()
    .regex(GROUP_NAME, 'groupe : 1 à 32 caractères (a-z, 0-9, _ - .)'),
});
export type RoleGroup = z.infer<typeof roleGroupSchema>;

export const roleGroupsSchema = z
  .array(roleGroupSchema)
  .max(MAX_ROLE_GROUPS)
  .refine((list) => new Set(list.map((m) => m.roleId)).size === list.length, { message: 'un rôle ne peut apparaître qu’une fois' });

/** Lecture tolérante de la colonne JSON (valeurs invalides ignorées, doublons de rôle : première occurrence). */
export function parseRoleGroups(raw: unknown): RoleGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RoleGroup[] = [];
  for (const item of raw) {
    const r = roleGroupSchema.safeParse(item);
    if (!r.success || seen.has(r.data.roleId)) continue;
    seen.add(r.data.roleId);
    out.push(r.data);
    if (out.length >= MAX_ROLE_GROUPS) break;
  }
  return out;
}

/** Groupes gérés par le bot sur ce serveur (distincts, dans l'ordre de priorité) : ceux à retirer si le membre ne les a plus. */
export function managedGroups(mappings: readonly RoleGroup[]): string[] {
  return [...new Set(mappings.map((m) => m.group))];
}

export interface ResolvedGroups {
  /** Groupes détenus, du plus prioritaire au moins prioritaire (sans doublon) */
  groups: string[];
  /** Groupe principal (le premier détenu) ou null */
  primary: string | null;
  /** Tous les groupes gérés par le bot sur ce serveur */
  managed: string[];
}

/** Groupes effectifs d'un membre selon ses rôles Discord (ordre de la liste = priorité). */
export function resolveGroups(mappings: readonly RoleGroup[], roleIds: Iterable<string>): ResolvedGroups {
  const held = new Set(roleIds);
  const groups: string[] = [];
  for (const m of mappings) if (held.has(m.roleId) && !groups.includes(m.group)) groups.push(m.group);
  return { groups, primary: groups[0] ?? null, managed: managedGroups(mappings) };
}

/** Vrai si les groupes effectifs (ordre compris : le principal peut changer) diffèrent. */
export function groupsChanged(a: readonly string[], b: readonly string[]): boolean {
  return a.length !== b.length || a.some((g, i) => g !== b[i]);
}

// ───────────── Édition de la liste (panneau /config, dashboard) ─────────────

/**
 * Ajoute ou remplace l'association d'un rôle. `position` (1 = le plus prioritaire) : vide = conserve la place du rôle
 * s'il existait, sinon en dernier. Lance une ZodError si le groupe est invalide ou si la liste est pleine.
 */
export function upsertRoleGroup(list: readonly RoleGroup[], entry: { roleId: string; group: string }, position?: number | null): RoleGroup[] {
  const parsed = roleGroupSchema.parse(entry);
  const current = list.findIndex((m) => m.roleId === parsed.roleId);
  const rest = list.filter((m) => m.roleId !== parsed.roleId);
  const index = position && position > 0 ? Math.min(position - 1, rest.length) : current >= 0 ? current : rest.length;
  const out = [...rest.slice(0, index), parsed, ...rest.slice(index)];
  return roleGroupsSchema.parse(out);
}

/** Retire les associations des rôles donnés. */
export function removeRoleGroups(list: readonly RoleGroup[], roleIds: readonly string[]): RoleGroup[] {
  const drop = new Set(roleIds);
  return list.filter((m) => !drop.has(m.roleId));
}

/** Place l'association d'un rôle en tête (groupe le plus prioritaire). */
export function moveRoleGroupToTop(list: readonly RoleGroup[], roleId: string): RoleGroup[] {
  const found = list.find((m) => m.roleId === roleId);
  return found ? [found, ...list.filter((m) => m.roleId !== roleId)] : [...list];
}

/** Un changement de rôles touche-t-il un rôle associé à un groupe ? (évite de recalculer à chaque rôle cosmétique) */
export function touchesMappedRole(mappings: readonly RoleGroup[], before: Iterable<string>, after: Iterable<string>): boolean {
  const a = new Set(before);
  const b = new Set(after);
  return mappings.some((m) => a.has(m.roleId) !== b.has(m.roleId));
}
