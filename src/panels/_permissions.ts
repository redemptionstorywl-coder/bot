import { ButtonStyle, RoleSelectMenuBuilder, StringSelectMenuBuilder, type Guild } from 'discord.js';
import type { GuildKind } from '@prisma/client';
import { buildCustomId } from '../utils/customId';
import { liveRoles } from '../utils/liveIds';
import { embedService } from '../services/EmbedService';
import { commandPermissionService, type CommandInfo, type CommandRule } from '../services/CommandPermissionService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import type { Command, InternalPermission } from '../structures/types';
import { btn, fieldLines, option, row, truncate, withNotice, type PanelNotice, type PanelPayload, type Row } from './_coreKit';

/**
 * Panneau `/config permissions` (namespace `cfg-perms`, admin) : qui peut utiliser chaque commande slash.
 *  - menus   : `cfg-perms:cat` (catégorie) · `cfg-perms:cmd` (commande) · `cfg-perms:roles:<commande>` (RoleSelect)
 *              · `cfg-perms:catroles:<catégorie>` (RoleSelect, toute la catégorie)
 *  - boutons : `cfg-perms:view:<main|resetall>` · `cfg-perms:view:cat:<catégorie>:<page>` · `cfg-perms:toggle:<commande>`
 *              · `cfg-perms:reset:<commande>` · `cfg-perms:catreset:<catégorie>` · `cfg-perms:resetall`
 * Règles stockées par CommandPermissionService (table CommandPermission), appliquées par le routeur d'interactions.
 */

export const CFG_PERMS = 'cfg-perms';
export const pid = (...parts: string[]): string => buildCustomId(CFG_PERMS, ...parts);

/** Commandes par page dans la vue catégorie (limite d'options d'un menu Discord). */
export const COMMANDS_PER_PAGE = 25;
/** Rôles autorisés par commande (limite d'un RoleSelect). */
export const MAX_ALLOWED_ROLES = 25;
/** Ordre d'affichage des catégories (dossiers de src/commands) ; les autres suivent par ordre alphabétique. */
export const CATEGORY_ORDER = ['admin', 'moderation', 'tickets', 'announcements', 'embeds', 'events', 'roles', 'whitelist', 'battle-royale', 'school', 'shop'];
const LEVEL_ORDER: InternalPermission[] = ['everyone', 'staff', 'admin', 'owner'];
/** Budget de caractères de l'embed principal (limite Discord : 6000 au total). */
const EMBED_BUDGET = 5800;

export type CommandState = 'default' | 'roles' | 'disabled' | 'locked';
export const STATE_ICON: Record<CommandState, string> = { default: '🔒', roles: '👥', disabled: '⛔', locked: '🔐' };

export type PermissionsView = { kind: 'main' } | { kind: 'resetall' } | { kind: 'category'; category: string; page?: number } | { kind: 'command'; command: string };

export function commandState(info: Pick<CommandInfo, 'locked'>, rule: CommandRule | null | undefined): CommandState {
  if (info.locked) return 'locked';
  if (rule && !rule.enabled) return 'disabled';
  if (rule?.roleIds.length) return 'roles';
  return 'default';
}

/** Commandes affichées : toutes les commandes slash, sauf celles réservées à un autre type de serveur (non déployées ici). */
export function permissionCatalog(commands: Iterable<Command>, kind: GuildKind | null | undefined): CommandInfo[] {
  return commandPermissionService.catalog([...commands].filter((c) => !kind || !c.guildKinds?.length || c.guildKinds.includes(kind)));
}

export interface CategoryGroup {
  key: string;
  commands: CommandInfo[];
}

export function groupByCategory(catalog: readonly CommandInfo[]): CategoryGroup[] {
  const map = new Map<string, CommandInfo[]>();
  for (const c of catalog) {
    const list = map.get(c.category) ?? [];
    list.push(c);
    map.set(c.category, list);
  }
  const rank = (k: string) => (CATEGORY_ORDER.includes(k) ? CATEGORY_ORDER.indexOf(k) : CATEGORY_ORDER.length);
  return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([key, commands]) => ({ key, commands }));
}

export function categoryLabel(t: Translator, key: string): string {
  const k = `permissions.categories.${key}`;
  const v = t(k);
  return v === k ? key : v;
}

export const levelLabel = (t: Translator, level: InternalPermission): string => t(`permissions.levels.${level}`);

export const pageCount = (count: number): number => Math.max(1, Math.ceil(count / COMMANDS_PER_PAGE));
export function clampPage(page: number, count: number): number {
  const p = Number.isFinite(page) ? Math.trunc(page) : 0;
  return Math.min(Math.max(0, p), pageCount(count) - 1);
}
/** Page de la vue catégorie qui contient la commande. */
export function pageOf(group: CategoryGroup, command: string): number {
  return Math.max(0, Math.floor(group.commands.findIndex((c) => c.name === command) / COMMANDS_PER_PAGE));
}

/** Rôles communs à toutes les commandes modifiables d'une catégorie (pré-remplissage du menu « toute la catégorie »), [] sinon. */
export function commonRoles(commands: readonly CommandInfo[], rules: ReadonlyMap<string, CommandRule>): string[] {
  const editable = commands.filter((c) => !c.locked);
  const first = editable[0] ? rules.get(editable[0].name)?.roleIds ?? [] : [];
  if (!first.length) return [];
  const key = (ids: readonly string[]) => [...ids].sort().join(',');
  const ref = key(first);
  return editable.every((c) => key(rules.get(c.name)?.roleIds ?? []) === ref) ? [...first] : [];
}

/** Mentions des rôles autorisés encore présents (au plus `max`, puis « +n »), null si aucun n'existe plus. */
function roleMentions(guild: Guild, ids: readonly string[], max: number): string | null {
  const live = liveRoles(guild, ids);
  if (!live.length) return null;
  const shown = live.slice(0, max).map((r) => `<@&${r}>`).join(' ');
  return live.length > max ? `${shown} +${live.length - max}` : shown;
}

/** État lisible d'une commande (texte brut, pour les descriptions de menu). */
function stateText(t: Translator, info: CommandInfo, rule: CommandRule | null | undefined): string {
  switch (commandState(info, rule)) {
    case 'locked':
      return t('permissions.state.locked');
    case 'disabled':
      return t('permissions.state.disabled');
    case 'roles':
      return t('permissions.state.roles', { count: rule!.roleIds.length });
    default:
      return t('permissions.state.default', { level: levelLabel(t, info.defaultLevel) });
  }
}

/** Ligne d'une commande dans la vue catégorie (avec mentions des rôles). */
function commandLine(t: Translator, guild: Guild, info: CommandInfo, rule: CommandRule | null | undefined): string {
  const state = commandState(info, rule);
  const detail = state === 'roles' ? (roleMentions(guild, rule!.roleIds, 5) ?? `⚠️ ${t('permissions.state.roles_gone')}`) : stateText(t, info, rule);
  return `${STATE_ICON[state]} \`/${info.name}\` — ${detail}`;
}

/** Résumé d'une catégorie pour la vue principale : commandes par défaut groupées par niveau, puis les règles. */
export function categorySummary(t: Translator, guild: Guild, commands: readonly CommandInfo[], rules: ReadonlyMap<string, CommandRule>): string[] {
  const byLevel = new Map<InternalPermission, string[]>();
  const custom: string[] = [];
  const locked: string[] = [];
  for (const c of commands) {
    const rule = rules.get(c.name);
    const state = commandState(c, rule);
    if (state === 'locked') locked.push(`\`/${c.name}\``);
    else if (state === 'disabled') custom.push(`${STATE_ICON.disabled} \`/${c.name}\``);
    else if (state === 'roles') custom.push(`${STATE_ICON.roles} \`/${c.name}\` → ${roleMentions(guild, rule!.roleIds, 3) ?? `⚠️ ${t('permissions.state.roles_gone')}`}`);
    else byLevel.set(c.defaultLevel, [...(byLevel.get(c.defaultLevel) ?? []), `\`/${c.name}\``]);
  }
  const lines = LEVEL_ORDER.filter((l) => byLevel.has(l)).map((l) => `${STATE_ICON.default} **${levelLabel(t, l)}** · ${byLevel.get(l)!.join(' ')}`);
  lines.push(...custom);
  if (locked.length) lines.push(`${STATE_ICON.locked} ${locked.join(' ')}`);
  return lines;
}

const customCount = (commands: readonly CommandInfo[], rules: ReadonlyMap<string, CommandRule>) => commands.filter((c) => !c.locked && rules.has(c.name)).length;

export interface PermissionsRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  /** Commandes slash du bot (`client.commands.values()`) */
  commands: Iterable<Command>;
  rules: ReadonlyMap<string, CommandRule>;
  view?: PermissionsView;
  notice?: PanelNotice;
}

export function renderPermissions(opts: PermissionsRenderOptions): PanelPayload {
  const catalog = permissionCatalog(opts.commands, opts.config.kind);
  const view = opts.view ?? { kind: 'main' };
  if (view.kind === 'category') {
    const group = groupByCategory(catalog).find((g) => g.key === view.category);
    if (group) return renderCategory(opts, group, view.page ?? 0);
  }
  if (view.kind === 'command') {
    const info = catalog.find((c) => c.name === view.command);
    const group = info && groupByCategory(catalog).find((g) => g.key === info.category);
    if (info && group) return renderCommand(opts, info, group, hiddenByDiscord([...opts.commands].find((c) => c.data.name === info.name)));
  }
  if (view.kind === 'resetall') return renderResetAll(opts);
  return renderMain(opts, catalog);
}

function renderMain({ guild, config, t, rules, notice }: PermissionsRenderOptions, catalog: CommandInfo[]): PanelPayload {
  const groups = groupByCategory(catalog).slice(0, 25);
  const title = t('permissions.panel.title', { server: guild.name });
  const description = withNotice(notice, t('permissions.panel.hint'));
  const names = groups.map((g) => truncate(t('permissions.panel.field_category', { category: categoryLabel(t, g.key), custom: customCount(g.commands, rules), total: g.commands.length }), 256));
  const used = title.length + description.length + names.reduce((n, s) => n + s.length, 0) + embedService.brand().toJSON().footer!.text.length;
  const perField = Math.max(100, Math.min(1024, Math.floor((EMBED_BUDGET - used) / Math.max(1, groups.length))));
  const embed = embedService
    .brand(truncate(title, 256))
    .setColor(config.brandColor)
    .setDescription(description)
    .addFields(groups.map((g, i) => ({ name: names[i]!, value: fieldLines(categorySummary(t, guild, g.commands, rules), '—', perField) })));

  const components: Row[] = [];
  if (groups.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(pid('cat'))
      .setPlaceholder(t('permissions.panel.category_placeholder'))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(groups.map((g) => option(categoryLabel(t, g.key), g.key, { description: t('permissions.panel.category_option', { total: g.commands.length, custom: customCount(g.commands, rules) }) })));
    components.push(row(select));
  }
  components.push(row(btn(pid('view', 'resetall'), t('permissions.panel.btn_reset_all'), ButtonStyle.Danger, '♻️', rules.size === 0)));
  return { embeds: [embed], components };
}

function renderResetAll({ guild, t, rules, notice }: PermissionsRenderOptions): PanelPayload {
  const embed = embedService
    .warning(withNotice(notice, t('permissions.panel.reset_all_confirm', { count: rules.size })), t('permissions.panel.reset_all_title'))
    .setFooter({ text: truncate(guild.name, 100) });
  return {
    embeds: [embed],
    components: [
      row(
        btn(pid('resetall'), t('permissions.panel.btn_confirm_reset_all'), ButtonStyle.Danger, '♻️', rules.size === 0),
        btn(pid('view', 'main'), t('core.back'), ButtonStyle.Secondary, '↩️'),
      ),
    ],
  };
}

function renderCategory({ guild, config, t, rules, notice }: PermissionsRenderOptions, group: CategoryGroup, rawPage: number): PanelPayload {
  const pages = pageCount(group.commands.length);
  const page = clampPage(rawPage, group.commands.length);
  const slice = group.commands.slice(page * COMMANDS_PER_PAGE, (page + 1) * COMMANDS_PER_PAGE);
  const label = categoryLabel(t, group.key);
  const embed = embedService
    .brand(truncate(t('permissions.panel.category_title', { category: label }), 256))
    .setColor(config.brandColor)
    .setDescription(
      withNotice(
        notice,
        t('permissions.panel.category_hint'),
        pages > 1 ? t('permissions.panel.page', { page: page + 1, pages }) : null,
        fieldLines(
          slice.map((c) => commandLine(t, guild, c, rules.get(c.name))),
          '—',
          3200,
        ),
      ),
    );

  const commandSelect = new StringSelectMenuBuilder()
    .setCustomId(pid('cmd'))
    .setPlaceholder(t('permissions.panel.command_placeholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(slice.map((c) => option(`/${c.name}`, c.name, { description: stateText(t, c, rules.get(c.name)), emoji: STATE_ICON[commandState(c, rules.get(c.name))] })));

  const editable = group.commands.filter((c) => !c.locked);
  const categoryRoles = new RoleSelectMenuBuilder()
    .setCustomId(pid('catroles', group.key))
    .setPlaceholder(t('permissions.panel.category_roles_placeholder'))
    .setMinValues(0)
    .setMaxValues(MAX_ALLOWED_ROLES)
    .setDisabled(!editable.length);
  const defaults = liveRoles(guild, commonRoles(group.commands, rules)).slice(0, MAX_ALLOWED_ROLES);
  if (defaults.length) categoryRoles.setDefaultRoles(defaults);

  const buttons = [btn(pid('catreset', group.key), t('permissions.panel.btn_category_reset'), ButtonStyle.Danger, '♻️', customCount(group.commands, rules) === 0)];
  if (pages > 1) {
    buttons.push(
      btn(pid('view', 'cat', group.key, String(page - 1)), t('permissions.panel.btn_prev'), ButtonStyle.Secondary, '◀️', page === 0),
      btn(pid('view', 'cat', group.key, String(page + 1)), t('permissions.panel.btn_next'), ButtonStyle.Secondary, '▶️', page >= pages - 1),
    );
  }
  buttons.push(btn(pid('view', 'main'), t('core.back'), ButtonStyle.Secondary, '↩️'));

  return { embeds: [embed], components: [row(commandSelect), row(categoryRoles), row(...buttons)] };
}

/** Commande masquée par Discord aux membres sans certaines permissions (`setDefaultMemberPermissions`). */
function hiddenByDiscord(command: Command | undefined): boolean {
  const perms = command?.data.toJSON().default_member_permissions;
  return perms !== undefined && perms !== null && perms !== '0';
}

function renderCommand({ guild, config, t, rules, notice }: PermissionsRenderOptions, info: CommandInfo, group: CategoryGroup, hidden = false): PanelPayload {
  const rule = rules.get(info.name) ?? null;
  const state = commandState(info, rule);
  const live = liveRoles(guild, rule?.roleIds ?? []).slice(0, MAX_ALLOWED_ROLES);
  const effect = {
    locked: t('permissions.panel.effect_locked'),
    disabled: t('permissions.panel.effect_disabled'),
    roles: t('permissions.panel.effect_roles'),
    default: t('permissions.panel.effect_default', { level: levelLabel(t, info.defaultLevel) }),
  }[state];
  const rolesValue = rule?.roleIds.length ? (live.length ? live.map((r) => `<@&${r}>`).join(' ') : `⚠️ ${t('permissions.state.roles_gone')}`) : t('permissions.panel.no_roles');
  const enabled = rule?.enabled ?? true;
  const embed = embedService
    .brand(truncate(t('permissions.panel.command_title', { command: info.name }), 256))
    .setColor(config.brandColor)
    .setDescription(withNotice(notice, truncate(info.description, 300), `${STATE_ICON[state]} ${effect}`, hidden && state === 'roles' ? t('permissions.panel.discord_hidden') : null))
    .addFields(
      { name: t('permissions.panel.field_category_name'), value: categoryLabel(t, info.category), inline: true },
      { name: t('permissions.panel.field_level'), value: levelLabel(t, info.defaultLevel), inline: true },
      { name: t('permissions.panel.field_state'), value: info.locked ? `${STATE_ICON.locked} ${t('permissions.state.locked')}` : t(enabled ? 'permissions.panel.state_enabled' : 'permissions.panel.state_disabled'), inline: true },
      { name: t('permissions.panel.field_roles'), value: truncate(rolesValue, 1024) },
    );

  const roles = new RoleSelectMenuBuilder()
    .setCustomId(pid('roles', info.name))
    .setPlaceholder(t('permissions.panel.roles_placeholder'))
    .setMinValues(0)
    .setMaxValues(MAX_ALLOWED_ROLES)
    .setDisabled(info.locked);
  if (live.length && !info.locked) roles.setDefaultRoles(live);

  return {
    embeds: [embed],
    components: [
      row(roles),
      row(
        btn(pid('toggle', info.name), t(enabled ? 'permissions.panel.btn_enabled' : 'permissions.panel.btn_disabled'), enabled ? ButtonStyle.Success : ButtonStyle.Danger, enabled ? '🟢' : '⛔', info.locked),
        btn(pid('reset', info.name), t('permissions.panel.btn_reset'), ButtonStyle.Secondary, '♻️', info.locked || !rule),
        btn(pid('view', 'cat', group.key, String(pageOf(group, info.name))), t('core.back'), ButtonStyle.Secondary, '↩️'),
      ),
    ],
  };
}
