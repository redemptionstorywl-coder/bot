import {
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Guild,
  type ModalBuilder,
} from 'discord.js';
import { GuildKind, type SchoolClass, type SchoolClub, type SchoolHouse } from '@prisma/client';
import { buildCustomId } from '../utils/customId';
import { embedService } from '../services/EmbedService';
import { schoolService, sortHouses } from '../services/SchoolService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import { PanelError, btn, channelMention, describeError, ko, fieldLines, labelled, modal, moduleButton, moduleLine, option, roleMention, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload, type Row } from './_modulesKit';

/**
 * Panneau `/config module:school` — namespace `cfg-school` (admin) :
 *  - onglets : `tab:<config|roles|classes|houses|clubs>`, `module`
 *  - config  : `apps` / `announce` (ChannelSelect), `role:<STUDENT|TEACHER|STAFF>` (RoleSelect)
 *  - listes  : `<kind>` (StringSelect → fiche), `<kind>-del` (StringSelect → suppression), `<kind>-new` (modal) — kind = class | house | club
 *  - fiches  : `edit:<kind>:<id>` (modal), `set:<kind>:<champ>:<id>` (Role / Channel / UserSelect), `assign:<kind>:<id>` (UserSelect)
 * Restent en commandes : /school register · profile · apply · announce · house points-add|points-remove|leaderboard · club list|join|leave.
 */

export const SCHOOL_NS = 'cfg-school';
export const SCHOOL_KINDS: GuildKind[] = [GuildKind.SCHOOL];
export const SCHOOL_TABS = ['config', 'roles', 'classes', 'houses', 'clubs'] as const;
export type SchoolTab = (typeof SCHOOL_TABS)[number];
export const ENTITY_KINDS = ['class', 'house', 'club'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const KIND_TAB: Record<EntityKind, SchoolTab> = { class: 'classes', house: 'houses', club: 'clubs' };
export const SCHOOL_ROLE_FIELDS = { STUDENT: 'studentRoleId', TEACHER: 'teacherRoleId', STAFF: 'staffRoleId' } as const;
export type SchoolRoleKey = keyof typeof SCHOOL_ROLE_FIELDS;
const TAB_EMOJI: Record<SchoolTab, string> = { config: '⚙️', roles: '🎭', classes: '📚', houses: '🏠', clubs: '🎨' };

export const scid = (action: string, ...args: (string | number)[]): string => buildCustomId(SCHOOL_NS, action, ...args);
export const isSchoolTab = (v: string | undefined): v is SchoolTab => (SCHOOL_TABS as readonly string[]).includes(v ?? '');
export const isEntityKind = (v: string | undefined): v is EntityKind => (ENTITY_KINDS as readonly string[]).includes(v ?? '');
export const isSchoolRoleKey = (v: string | undefined): v is SchoolRoleKey => v === 'STUDENT' || v === 'TEACHER' || v === 'STAFF';

// ───── Fonctions pures ─────

/** Couleur hexadécimale (`#7C3AED` / `7c3aed`) → `#7C3AED` ; vide → null. */
export function normalizeColor(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (!/^#?[0-9a-fA-F]{6}$/.test(v)) throw new PanelError('panels_modules.school.invalid_color', { value: v });
  return `#${v.replace('#', '').toUpperCase()}`;
}

// ───── Rendu ─────

export interface SchoolRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  notice?: PanelNotice;
}

function tabsRow(active: SchoolTab | null, t: Translator): Row {
  return row(...SCHOOL_TABS.map((tab) => btn(scid('tab', tab), t(`panels_modules.school.tab_${tab}`), tab === active ? ButtonStyle.Primary : ButtonStyle.Secondary, TAB_EMOJI[tab], tab === active)));
}

function baseEmbed(opts: SchoolRenderOptions, hint: string) {
  const { guild, config, t, notice } = opts;
  return embedService.brand(t('panels_modules.school.title', { server: guild.name })).setDescription(withNotice(notice, `${hint}\n\n${moduleLine(config, 'school', t, SCHOOL_KINDS)}`));
}

export async function renderSchool(tab: SchoolTab, opts: SchoolRenderOptions): Promise<PanelPayload> {
  if (tab === 'config' || tab === 'roles') return renderSettings(tab, opts);
  return renderList(tab === 'classes' ? 'class' : tab === 'houses' ? 'house' : 'club', opts);
}

async function renderSettings(tab: 'config' | 'roles', opts: SchoolRenderOptions): Promise<PanelPayload> {
  const { config, t } = opts;
  const s = await schoolService.getConfig(opts.guild.id);
  const none = t('core.none');
  const embed = baseEmbed(opts, t(`panels_modules.school.${tab}_hint`)).addFields(
    { name: t('school.config.application_channel'), value: channelMention(s.applicationChannelId, none), inline: true },
    { name: t('school.config.announce_channel'), value: channelMention(s.announceChannelId, none), inline: true },
    { name: t('school.config.roles'), value: (Object.keys(SCHOOL_ROLE_FIELDS) as SchoolRoleKey[]).map((r) => `${t(`school.roles.${r.toLowerCase()}`)} → ${roleMention(s.roles[r], none)}`).join('\n') },
  );
  const components: Row[] = [tabsRow(tab, t)];
  if (tab === 'config') {
    const apps = new ChannelSelectMenuBuilder().setCustomId(scid('apps')).setPlaceholder(truncate(t('panels_modules.school.apps_placeholder'), 150)).addChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
    if (s.applicationChannelId) apps.setDefaultChannels(s.applicationChannelId);
    const announce = new ChannelSelectMenuBuilder().setCustomId(scid('announce')).setPlaceholder(truncate(t('panels_modules.school.announce_placeholder'), 150)).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1);
    if (s.announceChannelId) announce.setDefaultChannels(s.announceChannelId);
    components.push(row(apps), row(announce), row(moduleButton(scid('module'), 'school', config.modules.school, t)));
  } else {
    for (const key of Object.keys(SCHOOL_ROLE_FIELDS) as SchoolRoleKey[]) {
      const select = new RoleSelectMenuBuilder()
        .setCustomId(scid('role', key))
        .setPlaceholder(truncate(t('panels_modules.school.role_placeholder', { role: t(`school.roles.${key.toLowerCase()}`) }), 150))
        .setMinValues(0)
        .setMaxValues(1);
      if (s.roles[key]) select.setDefaultRoles(s.roles[key]!);
      components.push(row(select));
    }
  }
  return { embeds: [embed], components };
}

interface ListEntry {
  id: number;
  label: string;
  line: string;
  description: string;
  emoji: string;
}

async function listEntries(kind: EntityKind, guildId: string, t: Translator): Promise<ListEntry[]> {
  const none = t('core.none');
  if (kind === 'class') {
    return (await schoolService.listClasses(guildId)).map((c) => ({
      id: c.id,
      label: c.name,
      emoji: '📚',
      line: `📚 **${c.name}** · ${c._count.students}${c.capacity ? `/${c.capacity}` : ''} ${t('school.class.students')}${c.teacherId ? ` · <@${c.teacherId}>` : ''}${c.roleId ? ` · <@&${c.roleId}>` : ''}${c.channelId ? ` · <#${c.channelId}>` : ''}`,
      description: `${c._count.students}${c.capacity ? `/${c.capacity}` : ''} ${t('school.class.students')}`,
    }));
  }
  if (kind === 'house') {
    return sortHouses(await schoolService.listHouses(guildId)).map((h) => ({
      id: h.id,
      label: h.name,
      emoji: h.emoji ?? '🏠',
      line: `${h.emoji ?? '🏠'} **${h.name}** · ${h.points} ${t('school.house.points')} · ${h._count.members} ${t('school.house.members')}${h.roleId ? ` · <@&${h.roleId}>` : ''}${h.color ? ` · \`${h.color}\`` : ''}`,
      description: `${h.points} ${t('school.house.points')} · ${h._count.members} ${t('school.house.members')}`,
    }));
  }
  return (await schoolService.listClubs(guildId)).map((c) => ({
    id: c.id,
    label: c.name,
    emoji: '🎨',
    line: `🎨 **${c.name}** · ${c._count.members}${c.maxMembers ? `/${c.maxMembers}` : ''} ${t('school.house.members')}${c.leaderId ? ` · <@${c.leaderId}>` : ''}${c.roleId ? ` · <@&${c.roleId}>` : ''}`,
    description: c.description ? truncate(c.description, 100) : none,
  }));
}

async function renderList(kind: EntityKind, opts: SchoolRenderOptions): Promise<PanelPayload> {
  const { guild, t } = opts;
  const entries = await listEntries(kind, guild.id, t);
  const embed = baseEmbed(opts, t(`panels_modules.school.${kind}_hint`)).addFields({ name: t(`panels_modules.school.${kind}_field`, { count: entries.length }), value: fieldLines(entries.map((e) => e.line), t(`panels_modules.school.${kind}_empty`)) });
  const components: Row[] = [tabsRow(KIND_TAB[kind], t)];
  if (entries.length) {
    components.push(
      row(new StringSelectMenuBuilder().setCustomId(scid(kind)).setPlaceholder(truncate(t(`panels_modules.school.${kind}_pick`), 150)).addOptions(entries.slice(0, 25).map((e) => option(e.label, String(e.id), { description: e.description, emoji: e.emoji })))),
      row(new StringSelectMenuBuilder().setCustomId(scid(`${kind}-del`)).setPlaceholder(truncate(t(`panels_modules.school.${kind}_delete`), 150)).addOptions(entries.slice(0, 25).map((e) => option(e.label, String(e.id), { emoji: '🗑️' })))),
    );
  }
  components.push(row(btn(scid(`${kind}-new`), t(`panels_modules.school.${kind}_new`), ButtonStyle.Success, '➕')));
  return { embeds: [embed], components };
}

/** Fiche d'une classe / maison / club. */
export async function renderEntity(kind: EntityKind, id: number, opts: SchoolRenderOptions): Promise<PanelPayload> {
  const { guild, t, notice } = opts;
  const none = t('core.none');
  const embed = embedService.brand().setDescription(withNotice(notice, t(`panels_modules.school.${kind}_view_hint`)));
  const back = btn(scid('tab', KIND_TAB[kind]), t('core.back'), ButtonStyle.Secondary, '↩️');
  const edit = btn(scid('edit', kind, id), t('core.edit'), ButtonStyle.Secondary, '✏️');
  const roleSelect = (roleId: string | null) => {
    const s = new RoleSelectMenuBuilder().setCustomId(scid('set', kind, 'role', id)).setPlaceholder(truncate(t('panels_modules.school.entity_role_placeholder'), 150)).setMinValues(0).setMaxValues(1);
    if (roleId) s.setDefaultRoles(roleId);
    return row(s);
  };
  const assign = () => row(new UserSelectMenuBuilder().setCustomId(scid('assign', kind, id)).setPlaceholder(truncate(t(`panels_modules.school.${kind}_assign_placeholder`), 150)).setMinValues(1).setMaxValues(25));

  if (kind === 'class') {
    const c = await schoolService.requireClass(guild.id, id);
    embed.setTitle(`📚 ${c.name}`).addFields(
      { name: t('panels_modules.school.field_students'), value: `${c._count.students}${c.capacity ? `/${c.capacity}` : ''}`, inline: true },
      { name: t('panels_modules.school.field_teacher'), value: c.teacherId ? `<@${c.teacherId}>` : none, inline: true },
      { name: t('panels_modules.school.field_role'), value: roleMention(c.roleId, none), inline: true },
      { name: t('panels_modules.school.field_channel'), value: channelMention(c.channelId, none), inline: true },
    );
    const channel = new ChannelSelectMenuBuilder().setCustomId(scid('set', kind, 'channel', id)).setPlaceholder(truncate(t('panels_modules.school.entity_channel_placeholder'), 150)).addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory).setMinValues(0).setMaxValues(1);
    if (c.channelId) channel.setDefaultChannels(c.channelId);
    const teacher = new UserSelectMenuBuilder().setCustomId(scid('set', kind, 'teacher', id)).setPlaceholder(truncate(t('panels_modules.school.teacher_placeholder'), 150)).setMinValues(0).setMaxValues(1);
    if (c.teacherId) teacher.setDefaultUsers(c.teacherId);
    return { embeds: [embed], components: [roleSelect(c.roleId), row(channel), row(teacher), assign(), row(edit, back)] };
  }
  if (kind === 'house') {
    const h = (await schoolService.listHouses(guild.id)).find((x) => x.id === id) ?? null;
    if (!h) throw new PanelError('school.errors.house_not_found');
    embed.setTitle(`${h.emoji ?? '🏠'} ${h.name}`).addFields(
      { name: t('panels_modules.school.field_points'), value: String(h.points), inline: true },
      { name: t('panels_modules.school.field_members'), value: String(h._count.members), inline: true },
      { name: t('panels_modules.school.field_color'), value: h.color ? `\`${h.color}\`` : none, inline: true },
      { name: t('panels_modules.school.field_role'), value: roleMention(h.roleId, none), inline: true },
    );
    if (h.color) embed.setColor(parseInt(h.color.replace('#', ''), 16));
    return { embeds: [embed], components: [roleSelect(h.roleId), assign(), row(edit, back)] };
  }
  const c = await schoolService.requireClub(guild.id, id);
  embed.setTitle(`🎨 ${c.name}`).addFields(
    { name: t('panels_modules.school.field_members'), value: `${c._count.members}${c.maxMembers ? `/${c.maxMembers}` : ''}`, inline: true },
    { name: t('panels_modules.school.field_leader'), value: c.leaderId ? `<@${c.leaderId}>` : none, inline: true },
    { name: t('panels_modules.school.field_role'), value: roleMention(c.roleId, none), inline: true },
    { name: t('panels_modules.school.field_description'), value: c.description ? truncate(c.description, 1024) : none },
  );
  const leader = new UserSelectMenuBuilder().setCustomId(scid('set', kind, 'leader', id)).setPlaceholder(truncate(t('panels_modules.school.leader_placeholder'), 150)).setMinValues(0).setMaxValues(1);
  if (c.leaderId) leader.setDefaultUsers(c.leaderId);
  return { embeds: [embed], components: [roleSelect(c.roleId), row(leader), row(edit, back)] };
}

// ───── Modals ─────

/** Modal de création (`<kind>-new`) ou d'édition (`edit:<kind>:<id>`). */
export function buildEntityModal(kind: EntityKind, t: Translator, current?: SchoolClass | SchoolHouse | SchoolClub): ModalBuilder {
  const customId = current ? scid('edit', kind, current.id) : scid(`${kind}-new`);
  const title = t(current ? `panels_modules.school.${kind}_edit_title` : `panels_modules.school.${kind}_new_title`, { name: current?.name ?? '' });
  const name = labelled(t('panels_modules.school.modal_name'), textInput('name', TextInputStyle.Short, { required: true, max: 60, value: current?.name }));
  if (kind === 'class') {
    const c = current as SchoolClass | undefined;
    return modal(customId, title, name, labelled(t('panels_modules.school.modal_capacity'), textInput('capacity', TextInputStyle.Short, { max: 4, value: c?.capacity ? String(c.capacity) : undefined }), t('panels_modules.school.modal_capacity_help')));
  }
  if (kind === 'house') {
    const h = current as SchoolHouse | undefined;
    return modal(
      customId,
      title,
      name,
      labelled(t('panels_modules.school.modal_emoji'), textInput('emoji', TextInputStyle.Short, { max: 32, value: h?.emoji, placeholder: '🦁' })),
      labelled(t('panels_modules.school.modal_color'), textInput('color', TextInputStyle.Short, { max: 7, value: h?.color, placeholder: '#7C3AED' })),
    );
  }
  const c = current as SchoolClub | undefined;
  return modal(
    customId,
    title,
    name,
    labelled(t('panels_modules.school.modal_description'), textInput('description', TextInputStyle.Paragraph, { max: 500, value: c?.description })),
    labelled(t('panels_modules.school.modal_max_members'), textInput('max', TextInputStyle.Short, { max: 4, value: c?.maxMembers ? String(c.maxMembers) : undefined }), t('panels_modules.school.modal_capacity_help')),
  );
}

export async function loadEntity(kind: EntityKind, guildId: string, id: number): Promise<SchoolClass | SchoolHouse | SchoolClub> {
  if (kind === 'class') return schoolService.requireClass(guildId, id);
  if (kind === 'house') return schoolService.requireHouse(guildId, id);
  return schoolService.requireClub(guildId, id);
}

/** Fiche d'une entité ; si elle a disparu, revient à la liste avec la notice d'erreur. */
export async function renderEntityOrList(kind: EntityKind, id: number, opts: SchoolRenderOptions): Promise<PanelPayload> {
  try {
    return await renderEntity(kind, id, opts);
  } catch (err) {
    const text = describeError(err, opts.t);
    if (text === null) throw err;
    return renderSchool(KIND_TAB[kind], { ...opts, notice: ko(text) });
  }
}
