import {
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
  type Guild,
  type ModalBuilder,
} from 'discord.js';
import { AutoRoleType, PanelStyle } from '@prisma/client';
import { buildCustomId } from '../utils/customId';
import { TTLCache } from '../utils/cache';
import { canManageRole } from '../utils/permissions';
import { formatDuration, parseDuration } from '../utils/time';
import type { ModuleKey } from '../config/constants';
import { embedService } from '../services/EmbedService';
import { DEFAULT_NOTIFICATIONS, MAX_AUTOROLE_DELAY_SECONDS, displayEmoji, parseEmojiInput, roleService } from '../services/RoleService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import { PanelError, btn, fieldLines, labelled, modal, moduleButton, moduleLine, option, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload, type Row } from './_modulesKit';

/**
 * Panneau `/config module:roles` — namespace `cfg-roles` (admin) :
 *  - onglets   : `cfg-roles:tab:<auto|menus|reactions|notifs>`, `cfg-roles:module:<tab>` (active / désactive le module de l'onglet)
 *  - auto-roles: `cfg-roles:auto:<JOIN|BOT|VERIFIED>` (RoleSelect), `cfg-roles:delays` (modal)
 *  - role menus: `cfg-roles:menu` (StringSelect → éditeur `rolemenu:*`), `cfg-roles:menu-new` (modal `rolemenu:create`)
 *  - reaction  : `cfg-roles:rr-add` (modal lien + emoji + RoleSelect), `cfg-roles:rr-del` (StringSelect)
 *  - notifs    : `cfg-roles:nf-add` (modal), `cfg-roles:nf-del`, `cfg-roles:nf-publish` (ChannelSelect), `cfg-roles:nf-defaults`, `cfg-roles:nf-style`
 * Les boutons / menus publics (`rolemenu:menu|select|toggle`, `notif:*`) restent gérés par leurs namespaces.
 */

export const ROLES_NS = 'cfg-roles';
export const ROLES_TABS = ['auto', 'menus', 'reactions', 'notifs'] as const;
export type RolesTab = (typeof ROLES_TABS)[number];
export const TAB_MODULE: Record<RolesTab, ModuleKey> = { auto: 'autorole', menus: 'rolemenu', reactions: 'reactionrole', notifs: 'notifications' };
const TAB_EMOJI: Record<RolesTab, string> = { auto: '🤖', menus: '📋', reactions: '🔘', notifs: '🔔' };

/** Déclencheurs configurables depuis le panneau (SPECIAL n'est jamais déclenché automatiquement). */
export const PANEL_AUTOROLE_TYPES = [AutoRoleType.JOIN, AutoRoleType.BOT, AutoRoleType.VERIFIED] as const;
export type PanelAutoRoleType = (typeof PANEL_AUTOROLE_TYPES)[number];
export const AUTOROLE_SELECT_MAX = 10;

export function isRolesTab(v: string | undefined): v is RolesTab {
  return (ROLES_TABS as readonly string[]).includes(v ?? '');
}

export function isPanelAutoRoleType(v: string | undefined): v is PanelAutoRoleType {
  return (PANEL_AUTOROLE_TYPES as readonly string[]).includes(v ?? '');
}

export const rcid = (action: string, ...args: (string | number)[]): string => buildCustomId(ROLES_NS, action, ...args);

// ───── Brouillon : style du panneau de notifications (par utilisateur, 15 min) ─────

const notifStyles = new TTLCache<PanelStyle>(15 * 60_000, 1000);
export const getNotifStyle = (guildId: string, userId: string): PanelStyle => notifStyles.get(`${guildId}:${userId}`) ?? PanelStyle.SELECT;
export function toggleNotifStyle(guildId: string, userId: string): PanelStyle {
  const next = getNotifStyle(guildId, userId) === PanelStyle.SELECT ? PanelStyle.BUTTONS : PanelStyle.SELECT;
  notifStyles.set(`${guildId}:${userId}`, next);
  return next;
}

// ───── Fonctions pures ─────

/** Diff entre les rôles enregistrés et la sélection d'un RoleSelect. */
export function diffSelection(existing: string[], selected: string[]): { add: string[]; remove: string[] } {
  const sel = new Set(selected);
  const cur = new Set(existing);
  return { add: [...sel].filter((id) => !cur.has(id)), remove: [...cur].filter((id) => !sel.has(id)) };
}

/** Délai d'auto-role saisi (« 10m », « 1h30m », vide / 0 = immédiat), borné à 24 h. */
export function parseDelayInput(raw: string | undefined): number {
  const v = (raw ?? '').trim();
  if (!v || v === '0') return 0;
  const seconds = parseDuration(v);
  if (seconds === null) throw new PanelError('panels_modules.roles.auto.invalid_delay', { value: v });
  if (seconds > MAX_AUTOROLE_DELAY_SECONDS) throw new PanelError('panels_modules.roles.auto.delay_too_long', { value: v });
  return seconds;
}

/** Délai affiché / pré-rempli (format re-parsable : « 1h 30m »). */
export const formatDelay = (seconds: number): string => (seconds > 0 ? formatDuration(seconds, 'en') : '');

const MESSAGE_LINK = /(?:https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/)?(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/;

/** Parse un lien de message Discord (ou `guildId/channelId/messageId`). */
export function parseMessageLink(input: string): { guildId: string; channelId: string; messageId: string } | null {
  const m = input.trim().match(MESSAGE_LINK);
  if (!m) return null;
  return { guildId: m[1]!, channelId: m[2]!, messageId: m[3]! };
}

// ───── Rendu ─────

export interface RolesRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  userId: string;
  notice?: PanelNotice;
}

function tabsRow(active: RolesTab, config: ResolvedGuildConfig, t: Translator): Row {
  return row(
    ...ROLES_TABS.map((tab) => btn(rcid('tab', tab), t(`panels_modules.roles.tab_${tab}`), tab === active ? ButtonStyle.Primary : ButtonStyle.Secondary, TAB_EMOJI[tab], tab === active)),
    moduleButton(rcid('module', active), TAB_MODULE[active], config.modules[TAB_MODULE[active]], t),
  );
}

function header(tab: RolesTab, opts: RolesRenderOptions, hint: string) {
  const { guild, config, t, notice } = opts;
  return embedService.brand(t('panels_modules.roles.title', { tab: t(`panels_modules.roles.tab_${tab}`), server: guild.name })).setDescription(withNotice(notice, `${hint}\n\n${moduleLine(config, TAB_MODULE[tab], t)}`));
}

export async function renderRoles(tab: RolesTab, opts: RolesRenderOptions): Promise<PanelPayload> {
  switch (tab) {
    case 'menus':
      return renderMenus(opts);
    case 'reactions':
      return renderReactions(opts);
    case 'notifs':
      return renderNotifs(opts);
    default:
      return renderAuto(opts);
  }
}

async function renderAuto(opts: RolesRenderOptions): Promise<PanelPayload> {
  const { guild, config, t } = opts;
  const rows = await roleService.listAutoRoles(guild.id);
  const embed = header('auto', opts, t('panels_modules.roles.auto.hint'));
  const selects: Row[] = [];
  for (const type of PANEL_AUTOROLE_TYPES) {
    const ofType = rows.filter((r) => r.type === type);
    embed.addFields({
      name: t(`panels_modules.roles.auto.type_${type}`),
      value: fieldLines(
        ofType.map((r) => `${r.enabled ? '' : '⏸️ '}<@&${r.roleId}>${r.delaySeconds ? ` · ⏱️ ${formatDuration(r.delaySeconds, 'fr')}` : ''}`),
        t('core.none'),
      ),
      inline: true,
    });
    const max = Math.min(25, Math.max(AUTOROLE_SELECT_MAX, ofType.length));
    const select = new RoleSelectMenuBuilder().setCustomId(rcid('auto', type)).setPlaceholder(truncate(t(`panels_modules.roles.auto.placeholder_${type}`), 150)).setMinValues(0).setMaxValues(max);
    if (ofType.length) select.setDefaultRoles(ofType.slice(0, max).map((r) => r.roleId));
    selects.push(row(select));
  }
  return {
    embeds: [embed],
    components: [tabsRow('auto', config, t), ...selects, row(btn(rcid('delays'), t('panels_modules.roles.auto.btn_delays'), ButtonStyle.Secondary, '⏱️'))],
  };
}

async function renderMenus(opts: RolesRenderOptions): Promise<PanelPayload> {
  const { guild, config, t } = opts;
  const menus = await roleService.listRoleMenus(guild.id);
  const styleLabel = (s: PanelStyle) => (s === PanelStyle.SELECT ? t('roles.rolemenu.style_select') : t('roles.rolemenu.style_buttons'));
  const embed = header('menus', opts, t('panels_modules.roles.menus.hint'));
  embed.addFields({
    name: t('panels_modules.roles.menus.field', { count: menus.length }),
    value: fieldLines(
      menus.map((m) => `**#${m.id}** · ${m.name} — ${styleLabel(m.style)} · ${t('panels_modules.roles.menus.roles_count', { count: roleService.getMenuOptions(m).length })}${m.exclusive ? ' · 🔒' : ''}${m.channelId && m.messageId ? ` · <#${m.channelId}>` : ''}`),
      t('panels_modules.roles.menus.empty'),
    ),
  });
  const components: Row[] = [tabsRow('menus', config, t)];
  if (menus.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(rcid('menu'))
          .setPlaceholder(truncate(t('panels_modules.roles.menus.select_placeholder'), 150))
          .addOptions(menus.slice(0, 25).map((m) => option(`#${m.id} · ${m.name}`, String(m.id), { description: `${styleLabel(m.style)} · ${t('panels_modules.roles.menus.roles_count', { count: roleService.getMenuOptions(m).length })}`, emoji: '📋' }))),
      ),
    );
  }
  components.push(row(btn(rcid('menu-new'), t('panels_modules.roles.menus.btn_new'), ButtonStyle.Success, '➕')));
  return { embeds: [embed], components };
}

const messageUrl = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

async function renderReactions(opts: RolesRenderOptions): Promise<PanelPayload> {
  const { guild, config, t } = opts;
  const rows = await roleService.listReactionRoles(guild.id);
  const embed = header('reactions', opts, t('panels_modules.roles.reactions.hint'));
  embed.addFields({
    name: t('panels_modules.roles.reactions.field', { count: rows.length }),
    value: fieldLines(
      rows.map((r) => `${displayEmoji(r.emoji)} → <@&${r.roleId}> · [${t('roles.reactionrole.message')}](${messageUrl(r.guildId, r.channelId, r.messageId)})`),
      t('panels_modules.roles.reactions.empty'),
    ),
  });
  const components: Row[] = [tabsRow('reactions', config, t)];
  if (rows.length) {
    const roleName = (id: string) => guild.roles.cache.get(id)?.name ?? id;
    const channelName = (id: string) => guild.channels.cache.get(id)?.name ?? id;
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(rcid('rr-del'))
          .setPlaceholder(truncate(t('panels_modules.roles.reactions.delete_placeholder'), 150))
          .addOptions(rows.slice(0, 25).map((r) => option(`${r.emoji.includes(':') ? r.emoji.split(':')[0] : r.emoji} → @${roleName(r.roleId)}`, String(r.id), { description: `#${channelName(r.channelId)} · ${r.messageId}`, emoji: '🗑️' }))),
      ),
    );
  }
  components.push(row(btn(rcid('rr-add'), t('panels_modules.roles.reactions.btn_add'), ButtonStyle.Success, '➕')));
  return { embeds: [embed], components };
}

async function renderNotifs(opts: RolesRenderOptions): Promise<PanelPayload> {
  const { guild, config, t, userId } = opts;
  const rows = await roleService.listNotificationRoles(guild.id);
  const style = getNotifStyle(guild.id, userId);
  const styleLabel = style === PanelStyle.SELECT ? t('roles.rolemenu.style_select') : t('roles.rolemenu.style_buttons');
  const embed = header('notifs', opts, t('panels_modules.roles.notifs.hint', { count: DEFAULT_NOTIFICATIONS.length }));
  embed.addFields(
    {
      name: t('panels_modules.roles.notifs.field', { count: rows.length }),
      value: fieldLines(
        rows.map((r) => `${r.enabled ? '🟢' : '🔴'} ${r.emoji ?? '🔔'} **${r.label}** (\`${r.key}\`) → <@&${r.roleId}>`),
        t('panels_modules.roles.notifs.empty'),
      ),
    },
    { name: t('panels_modules.roles.notifs.style_field'), value: styleLabel, inline: true },
  );
  const enabledCount = rows.filter((r) => r.enabled).length;
  const components: Row[] = [tabsRow('notifs', config, t)];
  if (rows.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(rcid('nf-del'))
          .setPlaceholder(truncate(t('panels_modules.roles.notifs.delete_placeholder'), 150))
          .addOptions(rows.slice(0, 25).map((r) => option(`${r.label} (${r.key})`, r.key, { emoji: r.emoji ?? '🔔', description: guild.roles.cache.get(r.roleId)?.name ?? r.roleId }))),
      ),
    );
  }
  components.push(
    row(
      new ChannelSelectMenuBuilder()
        .setCustomId(rcid('nf-publish'))
        .setPlaceholder(truncate(t('panels_modules.roles.notifs.publish_placeholder', { style: styleLabel }), 150))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)
        .setDisabled(enabledCount === 0),
    ),
    row(
      btn(rcid('nf-defaults'), t('panels_modules.roles.notifs.btn_defaults'), ButtonStyle.Secondary, '📦'),
      btn(rcid('nf-add'), t('panels_modules.roles.notifs.btn_add'), ButtonStyle.Success, '➕'),
      btn(rcid('nf-style'), t('panels_modules.roles.notifs.btn_style', { style: styleLabel }), ButtonStyle.Secondary, '🎛️'),
    ),
  );
  return { embeds: [embed], components };
}

// ───── Modals ─────

export async function buildDelaysModal(guildId: string, t: Translator): Promise<ModalBuilder> {
  const rows = await roleService.listAutoRoles(guildId);
  return modal(
    rcid('delays'),
    t('panels_modules.roles.auto.delays_title'),
    ...PANEL_AUTOROLE_TYPES.map((type, i) =>
      labelled(
        t(`panels_modules.roles.auto.delay_${type}`),
        textInput(`delay_${type}`, TextInputStyle.Short, { max: 16, value: formatDelay(rows.find((r) => r.type === type)?.delaySeconds ?? 0), placeholder: t('panels_modules.roles.auto.delay_placeholder') }),
        i === 0 ? t('panels_modules.roles.auto.delay_help') : undefined,
      ),
    ),
  );
}

export function buildReactionRoleModal(t: Translator): ModalBuilder {
  return modal(
    rcid('rr-add'),
    t('panels_modules.roles.reactions.modal_title'),
    labelled(t('panels_modules.roles.reactions.modal_link'), textInput('link', TextInputStyle.Short, { required: true, max: 200, placeholder: 'https://discord.com/channels/…' }), t('panels_modules.roles.reactions.modal_link_help')),
    labelled(t('panels_modules.roles.reactions.modal_emoji'), textInput('emoji', TextInputStyle.Short, { required: true, max: 64, placeholder: '✅' })),
    labelled(t('panels_modules.roles.reactions.modal_role'), new RoleSelectMenuBuilder().setCustomId('role').setMinValues(1).setMaxValues(1).setRequired(true)),
  );
}

export function buildNotificationModal(t: Translator): ModalBuilder {
  return modal(
    rcid('nf-add'),
    t('panels_modules.roles.notifs.modal_title'),
    labelled(t('panels_modules.roles.notifs.modal_key'), textInput('key', TextInputStyle.Short, { required: true, max: 64, placeholder: 'streams' }), t('panels_modules.roles.notifs.modal_key_help')),
    labelled(t('panels_modules.roles.notifs.modal_role'), new RoleSelectMenuBuilder().setCustomId('role').setMinValues(1).setMaxValues(1).setRequired(true)),
    labelled(t('panels_modules.roles.notifs.modal_label'), textInput('label', TextInputStyle.Short, { max: 100 }), t('panels_modules.roles.notifs.modal_label_help')),
    labelled(t('panels_modules.roles.notifs.modal_emoji'), textInput('emoji', TextInputStyle.Short, { max: 64, placeholder: '🔔' })),
    labelled(t('panels_modules.roles.notifs.modal_description'), textInput('description', TextInputStyle.Short, { max: 100 })),
  );
}

// ───── Actions ─────

/** Applique la sélection d'un RoleSelect d'auto-roles (ajouts au délai du type, retraits). */
export async function saveAutoRoles(guild: Guild, type: PanelAutoRoleType, selected: string[], t: Translator): Promise<PanelNotice> {
  const existing = (await roleService.listAutoRoles(guild.id)).filter((r) => r.type === type);
  const delay = existing[0]?.delaySeconds ?? 0;
  const diff = diffSelection(
    existing.map((r) => r.roleId),
    selected,
  );
  const me = guild.members.me;
  const skipped = diff.add.filter((id) => !canManageRole(me, id));
  for (const roleId of diff.add.filter((id) => !skipped.includes(id))) await roleService.addAutoRole(guild.id, roleId, type, delay);
  for (const roleId of diff.remove) await roleService.removeAutoRole(guild.id, roleId, type);
  const text = t('panels_modules.roles.auto.saved', { type: t(`panels_modules.roles.auto.type_${type}`), added: diff.add.length - skipped.length, removed: diff.remove.length });
  if (skipped.length) return { type: 'warning', text: `${text}\n${t('panels_modules.roles.skipped', { roles: skipped.map((r) => `<@&${r}>`).join(' ') })}` };
  return { type: 'success', text };
}

/** Enregistre les délais par déclencheur (appliqués à tous les rôles du type). */
export async function saveDelays(guildId: string, values: Record<PanelAutoRoleType, string | undefined>, t: Translator): Promise<string> {
  const delays = Object.fromEntries(PANEL_AUTOROLE_TYPES.map((type) => [type, parseDelayInput(values[type])])) as Record<PanelAutoRoleType, number>;
  const rows = await roleService.listAutoRoles(guildId);
  for (const r of rows) if (isPanelAutoRoleType(r.type) && r.delaySeconds !== delays[r.type]) await roleService.addAutoRole(guildId, r.roleId, r.type, delays[r.type]);
  return t('panels_modules.roles.auto.delays_saved', {
    delays: PANEL_AUTOROLE_TYPES.map((type) => `${t(`panels_modules.roles.auto.type_${type}`)} : ${delays[type] ? formatDuration(delays[type], 'fr') : t('panels_modules.roles.auto.immediate')}`).join(' · '),
  });
}

/** Ajoute un reaction role : vérifie le lien, l'emoji, le rôle, réagit au message puis enregistre. */
export async function addReactionRole(guild: Guild, input: { link?: string; emoji?: string; roleId?: string }, t: Translator): Promise<string> {
  const link = input.link ? parseMessageLink(input.link) : null;
  if (!link || link.guildId !== guild.id) throw new PanelError('roles.reactionrole.invalid_link');
  const emoji = input.emoji ? parseEmojiInput(input.emoji) : null;
  if (!emoji) throw new PanelError('roles.reactionrole.invalid_emoji');
  if (!input.roleId) throw new PanelError('core.role_not_found');
  if (!canManageRole(guild.members.me, input.roleId)) throw new PanelError('core.role_hierarchy');
  const channel = await guild.channels.fetch(link.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('messages' in channel)) throw new PanelError('core.channel_not_found');
  const message = await channel.messages.fetch(link.messageId).catch(() => null);
  if (!message) throw new PanelError('roles.reactionrole.message_not_found');
  try {
    await message.react(emoji);
  } catch {
    throw new PanelError('roles.reactionrole.react_failed');
  }
  await roleService.addReactionRole({ guildId: guild.id, channelId: link.channelId, messageId: link.messageId, emoji, roleId: input.roleId });
  return t('roles.reactionrole.created', { emoji: displayEmoji(emoji), role: `<@&${input.roleId}>`, url: message.url });
}

/** Retire un reaction role (et la réaction du bot sur le message). */
export async function removeReactionRole(guild: Guild, id: number, t: Translator): Promise<string> {
  const row = await roleService.removeReactionRole({ id });
  if (!row || row.guildId !== guild.id) throw new PanelError('core.not_found');
  const channel = await guild.channels.fetch(row.channelId).catch(() => null);
  if (channel?.isTextBased() && 'messages' in channel) {
    const message = await channel.messages.fetch(row.messageId).catch(() => null);
    const stored = row.emoji;
    await message?.reactions.cache
      .find((r) => (r.emoji.id ? stored.endsWith(r.emoji.id) : r.emoji.name === stored))
      ?.users.remove(guild.members.me?.id)
      .catch(() => null);
  }
  return t('roles.reactionrole.removed', { emoji: displayEmoji(row.emoji), role: `<@&${row.roleId}>` });
}

/** Ajoute / modifie un rôle de notification depuis le modal. */
export async function saveNotification(guild: Guild, input: { key?: string; roleId?: string; label?: string; emoji?: string; description?: string }, t: Translator): Promise<string> {
  const key = (input.key ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!key) throw new PanelError('core.invalid_input', { details: t('panels_modules.roles.notifs.modal_key') });
  if (!input.roleId) throw new PanelError('core.role_not_found');
  if (!canManageRole(guild.members.me, input.roleId)) throw new PanelError('core.role_hierarchy');
  const existing = (await roleService.listNotificationRoles(guild.id)).find((r) => r.key === key);
  const role = guild.roles.cache.get(input.roleId);
  const saved = await roleService.upsertNotificationRole(guild.id, {
    key,
    roleId: input.roleId,
    label: input.label ?? existing?.label ?? role?.name ?? key,
    emoji: input.emoji ?? existing?.emoji ?? null,
    description: input.description ?? existing?.description ?? null,
    order: existing?.order ?? (await roleService.listNotificationRoles(guild.id)).length,
  });
  return t('roles.notif.added', { emoji: saved.emoji ?? '🔔', label: saved.label, role: `<@&${saved.roleId}>`, key: saved.key });
}
