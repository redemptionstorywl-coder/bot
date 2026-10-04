import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Client,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type Message,
  type MessageActionRowComponentBuilder,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { AutoRoleType, LogCategory, PanelStyle, Prisma, type AutoRole, type NotificationRole, type ReactionRole, type RoleMenu } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { buildCustomId } from '../utils/customId';
import { canManageRole } from '../utils/permissions';
import { colorToHex, embedService, embedSpecSchema, type EmbedSpec } from './EmbedService';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { translationService, type Translator } from './TranslationService';

const log = childLogger('RoleService');

export const MAX_AUTOROLE_DELAY_SECONDS = 24 * 3600;
/** Déclencheurs d'autorole utilisables (MEMBER / LANGUAGE de l'enum ne sont plus déclenchés : système de langue retiré). */
export const ACTIVE_AUTOROLE_TYPES = ['JOIN', 'BOT', 'VERIFIED', 'SPECIAL'] as const satisfies readonly AutoRoleType[];
const SNOWFLAKE = /^\d{17,20}$/;

// ───────────────────────── Schémas JSON ─────────────────────────

export const roleMenuOptionSchema = z.object({
  roleId: z.string().regex(SNOWFLAKE),
  label: z.string().min(1).max(80).optional(),
  emoji: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(100).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).optional(),
});
export type RoleMenuOption = z.infer<typeof roleMenuOptionSchema>;
export const roleMenuOptionsSchema = z.array(roleMenuOptionSchema).max(25);

const BUTTON_STYLES: Record<NonNullable<RoleMenuOption['style']>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

export interface NotificationDefinition {
  key: string;
  emoji: string;
  label: string;
}

/** Rôles de notification créés par « Rôles par défaut » (panneau `/config module:roles`). */
export const DEFAULT_NOTIFICATIONS: NotificationDefinition[] = [
  { key: 'announcements', emoji: '🔔', label: 'Announcements' },
  { key: 'battle-royale', emoji: '🎮', label: 'Battle Royale' },
  { key: 'events', emoji: '🎉', label: 'Events' },
  { key: 'tournament', emoji: '🏆', label: 'Tournament' },
  { key: 'shop', emoji: '🛒', label: 'Shop' },
  { key: 'streams', emoji: '📺', label: 'Streams' },
  { key: 'updates', emoji: '🛠️', label: 'Updates' },
];

// ───────────────────────── Fonctions pures ─────────────────────────

export interface RoleDiff {
  add: string[];
  remove: string[];
}

/**
 * Clic sur un rôle d'un role menu : ajoute s'il manque, retire s'il est présent.
 * En mode exclusif, les autres rôles du menu sont retirés quand on en ajoute un.
 */
export function computeToggle(currentRoleIds: Iterable<string>, roleId: string, menuRoleIds: string[], exclusive: boolean): RoleDiff & { action: 'added' | 'removed' } {
  const current = new Set(currentRoleIds);
  if (current.has(roleId)) return { add: [], remove: [roleId], action: 'removed' };
  const remove = exclusive ? menuRoleIds.filter((id) => id !== roleId && current.has(id)) : [];
  return { add: [roleId], remove, action: 'added' };
}

/**
 * Sélection via select menu : les rôles du menu sélectionnés sont ajoutés,
 * ceux du menu non sélectionnés sont retirés. Les rôles hors menu ne sont jamais touchés.
 */
export function computeSelection(currentRoleIds: Iterable<string>, selectedRoleIds: string[], menuRoleIds: string[]): RoleDiff {
  const current = new Set(currentRoleIds);
  const selected = new Set(selectedRoleIds.filter((id) => menuRoleIds.includes(id)));
  return {
    add: menuRoleIds.filter((id) => selected.has(id) && !current.has(id)),
    remove: menuRoleIds.filter((id) => !selected.has(id) && current.has(id)),
  };
}

/** Parse les options JSON d'un RoleMenu (ignore les entrées invalides). */
export function parseRoleMenuOptions(value: unknown): RoleMenuOption[] {
  if (!Array.isArray(value)) return [];
  const out: RoleMenuOption[] = [];
  for (const v of value) {
    const r = roleMenuOptionSchema.safeParse(v);
    if (r.success) out.push(r.data);
  }
  return out.slice(0, 25);
}

/**
 * Normalise un emoji saisi par un utilisateur :
 *  - custom `<:name:id>` / `<a:name:id>` → stocké et réagi sous la forme `name:id`
 *  - unicode → tel quel
 */
export function parseEmojiInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const custom = raw.match(/^<(a?):([\w~]+):(\d{17,20})>$/);
  if (custom) return `${custom[2]}:${custom[3]}`;
  const bare = raw.match(/^([\w~]+):(\d{17,20})$/);
  if (bare) return raw;
  if (/^\d{17,20}$/.test(raw)) return raw; // ID brut d'un emoji custom
  if (raw.length > 32 || /\s/.test(raw)) return null;
  return raw;
}

/** Vrai si l'emoji stocké correspond à l'emoji d'une réaction (custom : comparaison par ID). */
export function emojiMatches(stored: string, emoji: { id: string | null; name: string | null }): boolean {
  if (emoji.id) {
    const storedId = stored.includes(':') ? stored.split(':').pop() : stored;
    return storedId === emoji.id;
  }
  return stored === emoji.name;
}

/** Représentation affichable d'un emoji stocké. */
export function displayEmoji(stored: string): string {
  const m = stored.match(/^([\w~]+):(\d{17,20})$/);
  if (m) return `<:${m[1]}:${m[2]}>`;
  if (/^\d{17,20}$/.test(stored)) return `<:e:${stored}>`;
  return stored;
}

// ───────────────────────── Service ─────────────────────────

export interface RoleChangeResult {
  added: string[];
  removed: string[];
  /** Rôles ignorés (hiérarchie / rôle introuvable / rôle géré) */
  blocked: string[];
  /** Membre à jour renvoyé par l'API (le cache n'est rafraîchi qu'à l'événement gateway suivant) */
  member?: GuildMember;
}

export interface RoleMenuInput {
  name: string;
  embed: EmbedSpec;
  style?: PanelStyle;
  options?: RoleMenuOption[];
  exclusive?: boolean;
  placeholder?: string | null;
  minValues?: number;
  maxValues?: number;
}

export interface NotificationRoleInput {
  key: string;
  roleId: string;
  label: string;
  emoji?: string | null;
  description?: string | null;
  order?: number;
  enabled?: boolean;
}

/**
 * Rôles : autorole (JOIN/BOT/VERIFIED/SPECIAL), role menus, reaction roles, notifications.
 * Toute modification de rôle passe par `changeRoles()` (hiérarchie vérifiée, un seul appel API, log ROLE).
 */
export class RoleService {
  private client: Client | null = null;
  private readonly autoRoles = new TTLCache<AutoRole[]>(5 * 60_000);
  private readonly menus = new TTLCache<RoleMenu | null>(5 * 60_000);
  private readonly menuLists = new TTLCache<RoleMenu[]>(5 * 60_000);
  private readonly reactionsByMessage = new TTLCache<ReactionRole[]>(10 * 60_000);
  private readonly trackedMessages = new Set<string>();
  private trackedLoaded = false;
  private readonly notifications = new TTLCache<NotificationRole[]>(5 * 60_000);
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();

  attach(client: Client): void {
    this.client = client;
  }

  invalidate(guildId: string): void {
    this.autoRoles.delete(guildId);
    this.menuLists.delete(guildId);
    this.menus.clear();
    this.notifications.delete(guildId);
    this.reactionsByMessage.clear();
    void this.loadTrackedMessages().catch((err) => log.error({ err }, 'loadTrackedMessages'));
  }

  // ───── Noyau : application des changements ─────

  /** Applique un diff de rôles à un membre (hiérarchie vérifiée, un seul PATCH). */
  async changeRoles(member: GuildMember, diff: RoleDiff, reason: string): Promise<RoleChangeResult> {
    const me = member.guild.members.me;
    const blocked: string[] = [];
    const add = diff.add.filter((id) => (canManageRole(me, id) ? true : (blocked.push(id), false)));
    const remove = diff.remove.filter((id) => (canManageRole(me, id) ? true : (blocked.push(id), false)));
    const current = new Set(member.roles.cache.keys());
    const added = add.filter((id) => !current.has(id));
    const removed = remove.filter((id) => current.has(id));
    if (!added.length && !removed.length) return { added: [], removed: [], blocked, member };
    for (const id of removed) current.delete(id);
    for (const id of added) current.add(id);
    const updated = await member.roles.set([...current], reason);
    return { added, removed, blocked, member: updated };
  }

  private async logRoleChange(member: GuildMember, action: string, result: RoleChangeResult, opts: { skipDatabase?: boolean; actorId?: string | null; detail?: string } = {}): Promise<void> {
    if (!result.added.length && !result.removed.length) return;
    const cfg = await guildConfigService.get(member.guild.id);
    const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', member.guild.id);
    const fields = [];
    if (result.added.length) fields.push({ name: t('roles.log.added'), value: result.added.map((r) => `<@&${r}>`).join(' '), inline: true });
    if (result.removed.length) fields.push({ name: t('roles.log.removed'), value: result.removed.map((r) => `<@&${r}>`).join(' '), inline: true });
    await loggingService.log({
      guildId: member.guild.id,
      category: LogCategory.ROLE,
      action,
      title: t(`roles.log.${action.replace('role.', '')}`),
      description: `${t('core.user')} : <@${member.id}>${opts.detail ? `\n${opts.detail}` : ''}`,
      fields,
      actorId: opts.actorId ?? null,
      targetId: member.id,
      color: BRAND.colors.primary,
      skipDatabase: opts.skipDatabase,
      data: { added: result.added, removed: result.removed, blocked: result.blocked },
    });
  }

  // ───── Autorole ─────

  async listAutoRoles(guildId: string): Promise<AutoRole[]> {
    return this.autoRoles.getOrSet(guildId, () => prisma.autoRole.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } }));
  }

  async addAutoRole(guildId: string, roleId: string, type: AutoRoleType, delaySeconds = 0): Promise<AutoRole> {
    const delay = Math.min(Math.max(0, Math.floor(delaySeconds)), MAX_AUTOROLE_DELAY_SECONDS);
    const row = await prisma.autoRole.upsert({
      where: { guildId_roleId_type: { guildId, roleId, type } },
      create: { guildId, roleId, type, delaySeconds: delay },
      update: { delaySeconds: delay, enabled: true },
    });
    this.autoRoles.delete(guildId);
    return row;
  }

  async removeAutoRole(guildId: string, roleId: string, type?: AutoRoleType): Promise<number> {
    const r = await prisma.autoRole.deleteMany({ where: { guildId, roleId, ...(type ? { type } : {}) } });
    this.autoRoles.delete(guildId);
    return r.count;
  }

  /** Applique les autoroles d'un type (délais en mémoire, bornés à 24 h). */
  async applyAutoRoles(member: GuildMember, type: AutoRoleType, actorId: string | null = null): Promise<RoleChangeResult> {
    const rows = (await this.listAutoRoles(member.guild.id)).filter((r) => r.enabled && r.type === type);
    const immediate = rows.filter((r) => r.delaySeconds <= 0).map((r) => r.roleId);
    for (const r of rows.filter((r) => r.delaySeconds > 0)) this.scheduleAutoRole(member, r);
    if (!immediate.length) return { added: [], removed: [], blocked: [] };
    const result = await this.changeRoles(member, { add: immediate, remove: [] }, `Autorole ${type}`);
    await this.logRoleChange(member, 'role.autorole', result, { actorId, detail: type });
    return result;
  }

  /** Programme un autorole différé (délai borné à 24 h, en mémoire). */
  scheduleAutoRole(member: GuildMember, rule: AutoRole): void {
    const key = `${member.guild.id}:${member.id}:${rule.roleId}`;
    const existing = this.pendingTimers.get(key);
    if (existing) clearTimeout(existing);
    const delayMs = Math.min(rule.delaySeconds, MAX_AUTOROLE_DELAY_SECONDS) * 1000;
    const timer = setTimeout(async () => {
      this.pendingTimers.delete(key);
      try {
        const fresh = await member.guild.members.fetch(member.id).catch(() => null);
        if (!fresh) return;
        const result = await this.changeRoles(fresh, { add: [rule.roleId], remove: [] }, `Autorole ${rule.type} (+${rule.delaySeconds}s)`);
        await this.logRoleChange(fresh, 'role.autorole', result, { detail: `${rule.type} (+${rule.delaySeconds}s)` });
      } catch (err) {
        log.warn({ err, key }, 'Autorole différé impossible');
      }
    }, delayMs);
    timer.unref();
    this.pendingTimers.set(key, timer);
  }

  /** Annule les autoroles différés d'un membre (départ du serveur). */
  cancelPending(guildId: string, userId: string): number {
    let n = 0;
    for (const [key, timer] of this.pendingTimers) {
      if (key.startsWith(`${guildId}:${userId}:`)) {
        clearTimeout(timer);
        this.pendingTimers.delete(key);
        n++;
      }
    }
    return n;
  }

  get pendingCount(): number {
    return this.pendingTimers.size;
  }

  // ───── Role menus ─────

  async listRoleMenus(guildId: string): Promise<RoleMenu[]> {
    return this.menuLists.getOrSet(guildId, () => prisma.roleMenu.findMany({ where: { guildId }, orderBy: { id: 'asc' } }));
  }

  async getRoleMenu(id: number): Promise<RoleMenu | null> {
    const key = `menu:${id}`;
    const cached = this.menus.get(key);
    if (cached !== undefined) return cached;
    const row = await prisma.roleMenu.findUnique({ where: { id } });
    this.menus.set(key, row);
    return row;
  }

  async createRoleMenu(guildId: string, data: RoleMenuInput): Promise<RoleMenu> {
    const row = await prisma.roleMenu.create({
      data: {
        guildId,
        name: data.name.slice(0, 100),
        embed: embedSpecSchema.parse(data.embed) as Prisma.InputJsonValue,
        style: data.style ?? PanelStyle.BUTTONS,
        options: roleMenuOptionsSchema.parse(data.options ?? []) as Prisma.InputJsonValue,
        exclusive: data.exclusive ?? false,
        placeholder: data.placeholder ?? null,
        minValues: data.minValues ?? 0,
        maxValues: data.maxValues ?? 25,
      },
    });
    this.menuLists.delete(guildId);
    return row;
  }

  async updateRoleMenu(id: number, data: Partial<RoleMenuInput> & { channelId?: string | null; messageId?: string | null }): Promise<RoleMenu> {
    const patch: Prisma.RoleMenuUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.slice(0, 100);
    if (data.embed !== undefined) patch.embed = embedSpecSchema.parse(data.embed) as Prisma.InputJsonValue;
    if (data.style !== undefined) patch.style = data.style;
    if (data.options !== undefined) patch.options = roleMenuOptionsSchema.parse(data.options) as Prisma.InputJsonValue;
    if (data.exclusive !== undefined) patch.exclusive = data.exclusive;
    if (data.placeholder !== undefined) patch.placeholder = data.placeholder;
    if (data.minValues !== undefined) patch.minValues = data.minValues;
    if (data.maxValues !== undefined) patch.maxValues = data.maxValues;
    if (data.channelId !== undefined) patch.channelId = data.channelId;
    if (data.messageId !== undefined) patch.messageId = data.messageId;
    const row = await prisma.roleMenu.update({ where: { id }, data: patch });
    this.menus.delete(`menu:${id}`);
    this.menuLists.delete(row.guildId);
    return row;
  }

  async deleteRoleMenu(id: number, deleteMessage = true): Promise<void> {
    const menu = await this.getRoleMenu(id);
    if (!menu) return;
    if (deleteMessage && menu.channelId && menu.messageId) {
      const msg = await this.fetchMessage(menu.channelId, menu.messageId);
      await msg?.delete().catch(() => null);
    }
    await prisma.roleMenu.delete({ where: { id } });
    this.menus.delete(`menu:${id}`);
    this.menuLists.delete(menu.guildId);
  }

  getMenuOptions(menu: RoleMenu): RoleMenuOption[] {
    return parseRoleMenuOptions(menu.options);
  }

  /** Message public d'un role menu (embed + boutons ou select). */
  buildRoleMenuMessage(menu: RoleMenu, opts: { guild?: Guild | null; brandColor?: number; t?: Translator } = {}): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
    const spec = embedSpecSchema.safeParse(menu.embed);
    const embed = embedService.build({ color: colorToHex(opts.brandColor ?? BRAND.colors.primary), ...(spec.success ? spec.data : { title: menu.name }) }, { guild: opts.guild ?? null });
    const options = this.getMenuOptions(menu);
    const roleName = (id: string) => opts.guild?.roles.cache.get(id)?.name ?? `@${id}`;
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    if (!options.length) return { embeds: [embed], components };
    if (menu.style === PanelStyle.SELECT) {
      const max = menu.exclusive ? 1 : Math.min(Math.max(1, menu.maxValues), options.length);
      const min = Math.min(Math.max(0, menu.minValues), max);
      const select = new StringSelectMenuBuilder()
        .setCustomId(buildCustomId('rolemenu', 'select', menu.id))
        .setPlaceholder((menu.placeholder ?? opts.t?.('roles.rolemenu.default_placeholder') ?? 'Select your roles').slice(0, 150))
        .setMinValues(min)
        .setMaxValues(max)
        .addOptions(
          options.map((o) => {
            const opt = new StringSelectMenuOptionBuilder().setValue(o.roleId).setLabel((o.label ?? roleName(o.roleId)).slice(0, 100));
            if (o.emoji) opt.setEmoji(o.emoji);
            if (o.description) opt.setDescription(o.description.slice(0, 100));
            return opt;
          }),
        );
      components.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select));
    } else {
      for (let i = 0; i < options.length && components.length < 5; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        for (const o of options.slice(i, i + 5)) {
          const btn = new ButtonBuilder()
            .setCustomId(buildCustomId('rolemenu', 'menu', menu.id, o.roleId))
            .setLabel((o.label ?? roleName(o.roleId)).slice(0, 80))
            .setStyle(BUTTON_STYLES[o.style ?? 'secondary']);
          if (o.emoji) btn.setEmoji(o.emoji);
          row.addComponents(btn);
        }
        components.push(row);
      }
    }
    return { embeds: [embed], components };
  }

  /** Éditeur interactif (éphémère) d'un role menu : aperçu + sélecteurs + actions. */
  buildRoleMenuEditor(menu: RoleMenu, guild: Guild | null, t: Translator, note?: string): { content?: string; embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
    const options = this.getMenuOptions(menu);
    const roleName = (id: string) => guild?.roles.cache.get(id)?.name ?? id;
    const preview = this.buildRoleMenuMessage(menu, { guild, t }).embeds[0]!;
    const status = embedService.info(
      [
        `**${t('roles.rolemenu.editor.name')}** : ${menu.name}`,
        `**${t('roles.rolemenu.editor.style')}** : ${menu.style === PanelStyle.SELECT ? t('roles.rolemenu.style_select') : t('roles.rolemenu.style_buttons')}`,
        `**${t('roles.rolemenu.editor.exclusive')}** : ${menu.exclusive ? t('core.yes') : t('core.no')}`,
        `**${t('roles.rolemenu.editor.published')}** : ${menu.channelId && menu.messageId ? `<#${menu.channelId}>` : t('core.no')}`,
        '',
        options.length ? options.map((o) => `${o.emoji ?? '•'} ${o.label ?? roleName(o.roleId)} — <@&${o.roleId}>`).join('\n') : t('roles.rolemenu.editor.no_options'),
      ].join('\n'),
      t('roles.rolemenu.editor.title', { id: menu.id }),
    );
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new RoleSelectMenuBuilder().setCustomId(buildCustomId('rolemenu', 'addroles', menu.id)).setPlaceholder(t('roles.rolemenu.editor.add_roles')).setMinValues(1).setMaxValues(Math.max(1, 25 - options.length || 1)),
      ),
    );
    if (options.length) {
      components.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(buildCustomId('rolemenu', 'option', menu.id))
            .setPlaceholder(t('roles.rolemenu.editor.customize'))
            .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setValue(o.roleId).setLabel((o.label ?? roleName(o.roleId)).slice(0, 100)).setEmoji(o.emoji ?? '✏️'))),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(buildCustomId('rolemenu', 'removerole', menu.id))
            .setPlaceholder(t('roles.rolemenu.editor.remove_roles'))
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setValue(o.roleId).setLabel((o.label ?? roleName(o.roleId)).slice(0, 100)).setEmoji('🗑️'))),
        ),
      );
    }
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId('rolemenu', 'style', menu.id)).setLabel(menu.style === PanelStyle.SELECT ? t('roles.rolemenu.style_select') : t('roles.rolemenu.style_buttons')).setEmoji('🎛️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(buildCustomId('rolemenu', 'exclusive', menu.id)).setLabel(t('roles.rolemenu.editor.exclusive')).setEmoji(menu.exclusive ? '🔒' : '🔓').setStyle(menu.exclusive ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(buildCustomId('rolemenu', 'edit', menu.id)).setLabel(t('core.edit')).setEmoji('✏️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(buildCustomId('rolemenu', 'publish', menu.id)).setLabel(t('roles.rolemenu.editor.publish')).setEmoji('📤').setStyle(ButtonStyle.Primary).setDisabled(!options.length),
        new ButtonBuilder().setCustomId(buildCustomId('rolemenu', 'delete', menu.id)).setLabel(t('core.delete')).setEmoji('🗑️').setStyle(ButtonStyle.Danger),
      ),
      // Retour au panneau `/config module:roles` (onglet Role menus)
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId('cfg-roles', 'tab', 'menus')).setLabel(t('panels_modules.roles.menus.back_to_panel').slice(0, 80)).setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    );
    return { content: note ?? '', embeds: [status, preview], components };
  }

  /** Sélecteur de salon pour publier un role menu. */
  buildChannelPicker(menu: RoleMenu, t: Translator): { content: string; embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
    return {
      content: t('roles.rolemenu.editor.pick_channel', { name: menu.name }),
      embeds: [],
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ChannelSelectMenuBuilder().setCustomId(buildCustomId('rolemenu', 'channel', menu.id)).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setPlaceholder(t('roles.rolemenu.editor.pick_channel_placeholder')),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(buildCustomId('rolemenu', 'editor', menu.id)).setLabel(t('core.back')).setStyle(ButtonStyle.Secondary)),
      ],
    };
  }

  private async fetchMessage(channelId: string, messageId: string): Promise<Message | null> {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return null;
    return channel.messages.fetch(messageId).catch(() => null);
  }

  /** Publie (ou republie) le menu dans un salon et mémorise channelId/messageId. */
  async publishRoleMenu(menuId: number, channelId: string): Promise<RoleMenu> {
    if (!this.client) throw new Error('RoleService non attaché au client');
    const menu = await this.getRoleMenu(menuId);
    if (!menu) throw new Error('Role menu introuvable');
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Salon invalide');
    const guild = 'guild' in channel ? channel.guild : null;
    const cfg = await guildConfigService.get(menu.guildId);
    const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', menu.guildId);
    const payload = this.buildRoleMenuMessage(menu, { guild, brandColor: cfg?.brandColor, t });
    // Supprime l'ancien message si publié ailleurs
    if (menu.channelId && menu.messageId && menu.channelId !== channelId) {
      const old = await this.fetchMessage(menu.channelId, menu.messageId);
      await old?.delete().catch(() => null);
    }
    const existing = menu.channelId === channelId && menu.messageId ? await this.fetchMessage(channelId, menu.messageId) : null;
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    return this.updateRoleMenu(menuId, { channelId, messageId: message.id });
  }

  /** Met à jour le message déjà publié (après édition des options). */
  async refreshRoleMenu(menuId: number): Promise<boolean> {
    const menu = await this.getRoleMenu(menuId);
    if (!menu?.channelId || !menu.messageId) return false;
    const message = await this.fetchMessage(menu.channelId, menu.messageId);
    if (!message) return false;
    const cfg = await guildConfigService.get(menu.guildId);
    const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', menu.guildId);
    await message.edit(this.buildRoleMenuMessage(menu, { guild: message.guild, brandColor: cfg?.brandColor, t }));
    return true;
  }

  /** Clic sur un bouton de role menu. */
  async toggleMenuRole(member: GuildMember, menu: RoleMenu, roleId: string): Promise<RoleChangeResult & { action: 'added' | 'removed' | 'blocked' }> {
    const menuRoleIds = this.getMenuOptions(menu).map((o) => o.roleId);
    if (!menuRoleIds.includes(roleId)) return { added: [], removed: [], blocked: [roleId], action: 'blocked' };
    const diff = computeToggle(member.roles.cache.keys(), roleId, menuRoleIds, menu.exclusive);
    const result = await this.changeRoles(member, diff, `Role menu #${menu.id}`);
    await this.logRoleChange(member, 'role.menu', result, { skipDatabase: true, detail: menu.name });
    const blockedTarget = result.blocked.includes(roleId);
    return { ...result, action: blockedTarget ? 'blocked' : diff.action };
  }

  /** Sélection via select menu de role menu. */
  async applyMenuSelection(member: GuildMember, menu: RoleMenu, selected: string[]): Promise<RoleChangeResult> {
    const menuRoleIds = this.getMenuOptions(menu).map((o) => o.roleId);
    const diff = computeSelection(member.roles.cache.keys(), selected, menuRoleIds);
    const result = await this.changeRoles(member, diff, `Role menu #${menu.id}`);
    await this.logRoleChange(member, 'role.menu', result, { skipDatabase: true, detail: menu.name });
    return result;
  }

  /** Bouton générique `rolemenu:toggle:<roleId>` (Embed Builder) : ajoute ou retire un rôle. */
  async toggleRole(member: GuildMember, roleId: string): Promise<RoleChangeResult & { action: 'added' | 'removed' | 'blocked' }> {
    const diff = computeToggle(member.roles.cache.keys(), roleId, [roleId], false);
    const result = await this.changeRoles(member, diff, 'Role toggle');
    await this.logRoleChange(member, 'role.toggle', result, { skipDatabase: true });
    return { ...result, action: result.blocked.includes(roleId) ? 'blocked' : diff.action };
  }

  // ───── Reaction roles ─────

  /** Charge en mémoire l'ensemble des messages suivis (appelé au ready). */
  async loadTrackedMessages(): Promise<number> {
    const rows = await prisma.reactionRole.findMany({ select: { messageId: true } });
    this.trackedMessages.clear();
    for (const r of rows) this.trackedMessages.add(r.messageId);
    this.trackedLoaded = true;
    return this.trackedMessages.size;
  }

  isTracked(messageId: string): boolean {
    return this.trackedMessages.has(messageId);
  }

  get isTrackedLoaded(): boolean {
    return this.trackedLoaded;
  }

  async listReactionRoles(guildId: string): Promise<ReactionRole[]> {
    return prisma.reactionRole.findMany({ where: { guildId }, orderBy: { id: 'asc' } });
  }

  async getReactionRolesForMessage(messageId: string): Promise<ReactionRole[]> {
    return this.reactionsByMessage.getOrSet(messageId, () => prisma.reactionRole.findMany({ where: { messageId } }));
  }

  async addReactionRole(data: { guildId: string; channelId: string; messageId: string; emoji: string; roleId: string }): Promise<ReactionRole> {
    const row = await prisma.reactionRole.upsert({
      where: { messageId_emoji: { messageId: data.messageId, emoji: data.emoji } },
      create: data,
      update: { roleId: data.roleId, channelId: data.channelId },
    });
    this.trackedMessages.add(data.messageId);
    this.reactionsByMessage.delete(data.messageId);
    return row;
  }

  async removeReactionRole(where: { id: number } | { messageId: string; emoji: string }): Promise<ReactionRole | null> {
    const row = 'id' in where ? await prisma.reactionRole.findUnique({ where: { id: where.id } }) : await prisma.reactionRole.findUnique({ where: { messageId_emoji: where } });
    if (!row) return null;
    await prisma.reactionRole.delete({ where: { id: row.id } });
    this.reactionsByMessage.delete(row.messageId);
    const remaining = await prisma.reactionRole.count({ where: { messageId: row.messageId } });
    if (!remaining) this.trackedMessages.delete(row.messageId);
    return row;
  }

  /** Réaction ajoutée / retirée : aucune requête SQL pour les messages non suivis. */
  async handleReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean): Promise<void> {
    if (user.bot) return;
    if (!this.isTracked(reaction.message.id)) return;
    try {
      if (reaction.partial) await reaction.fetch();
      const guild = reaction.message.guild;
      if (!guild) return;
      const rows = (await this.getReactionRolesForMessage(reaction.message.id)).filter((r) => emojiMatches(r.emoji, reaction.emoji));
      if (!rows.length) return;
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;
      const roleIds = [...new Set(rows.map((r) => r.roleId))];
      const result = await this.changeRoles(member, added ? { add: roleIds, remove: [] } : { add: [], remove: roleIds }, 'Reaction role');
      await this.logRoleChange(member, 'role.reaction', result, { skipDatabase: true });
    } catch (err) {
      log.warn({ err, message: reaction.message.id }, 'Reaction role impossible');
    }
  }

  // ───── Notifications ─────

  async listNotificationRoles(guildId: string): Promise<NotificationRole[]> {
    return this.notifications.getOrSet(guildId, () => prisma.notificationRole.findMany({ where: { guildId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }));
  }

  async upsertNotificationRole(guildId: string, data: NotificationRoleInput): Promise<NotificationRole> {
    const key = data.key.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64);
    const row = await prisma.notificationRole.upsert({
      where: { guildId_key: { guildId, key } },
      create: { guildId, key, roleId: data.roleId, label: data.label.slice(0, 100), emoji: data.emoji ?? null, description: data.description ?? null, order: data.order ?? 0, enabled: data.enabled ?? true },
      update: { roleId: data.roleId, label: data.label.slice(0, 100), emoji: data.emoji ?? null, description: data.description ?? null, ...(data.order !== undefined ? { order: data.order } : {}), ...(data.enabled !== undefined ? { enabled: data.enabled } : {}) },
    });
    this.notifications.delete(guildId);
    return row;
  }

  async removeNotificationRole(guildId: string, key: string): Promise<number> {
    const r = await prisma.notificationRole.deleteMany({ where: { guildId, key } });
    this.notifications.delete(guildId);
    return r.count;
  }

  /** Crée les rôles manquants (neutres, non mentionnables) et les enregistre. */
  async setupDefaults(guild: Guild): Promise<{ created: string[]; linked: string[] }> {
    const existing = await this.listNotificationRoles(guild.id);
    const created: string[] = [];
    const linked: string[] = [];
    for (const [index, def] of DEFAULT_NOTIFICATIONS.entries()) {
      const row = existing.find((r) => r.key === def.key);
      const name = `${def.emoji} ${def.label}`;
      let role = row ? guild.roles.cache.get(row.roleId) : undefined;
      if (!role) role = guild.roles.cache.find((r) => r.name === name || r.name === def.label);
      if (!role) {
        role = await guild.roles.create({ name, color: BRAND.colors.neutral, mentionable: false, permissions: [], reason: 'Notifications setup' });
        created.push(role.id);
      } else linked.push(role.id);
      await this.upsertNotificationRole(guild.id, { key: def.key, roleId: role.id, label: row?.label ?? def.label, emoji: row?.emoji ?? def.emoji, description: row?.description ?? null, order: row?.order ?? index });
    }
    return { created, linked };
  }

  /** Panneau de notifications (select multi ou boutons). */
  async buildNotificationPanel(guildId: string, style: PanelStyle, t: Translator, brandColor: number = BRAND.colors.primary): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] }> {
    const rows = (await this.listNotificationRoles(guildId)).filter((r) => r.enabled);
    const embed = embedService.build(
      {
        title: t('roles.notif.panel_title'),
        description: rows.length ? `${t('roles.notif.panel_description')}\n\n${rows.map((r) => `${r.emoji ?? '🔔'} **${r.label}** — <@&${r.roleId}>${r.description ? `\n> ${r.description}` : ''}`).join('\n')}` : t('roles.notif.panel_empty'),
        footer: { text: BRAND.footer },
        color: colorToHex(brandColor),
      },
      {},
    );
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    if (!rows.length) return { embeds: [embed], components };
    if (style === PanelStyle.SELECT) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(buildCustomId('notif', 'select'))
        .setPlaceholder(t('roles.notif.select_placeholder').slice(0, 150))
        .setMinValues(0)
        .setMaxValues(rows.length)
        .addOptions(
          rows.map((r) => {
            const o = new StringSelectMenuOptionBuilder().setValue(r.key).setLabel(r.label.slice(0, 100));
            if (r.emoji) o.setEmoji(r.emoji);
            if (r.description) o.setDescription(r.description.slice(0, 100));
            return o;
          }),
        );
      components.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select));
    } else {
      for (let i = 0; i < rows.length && components.length < 5; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        for (const r of rows.slice(i, i + 5)) {
          const btn = new ButtonBuilder().setCustomId(buildCustomId('notif', 'toggle', r.key)).setLabel(r.label.slice(0, 80)).setStyle(ButtonStyle.Secondary);
          if (r.emoji) btn.setEmoji(r.emoji);
          row.addComponents(btn);
        }
        components.push(row);
      }
    }
    return { embeds: [embed], components };
  }

  async publishNotificationPanel(guildId: string, channelId: string, style: PanelStyle = PanelStyle.SELECT): Promise<Message> {
    if (!this.client) throw new Error('RoleService non attaché au client');
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Salon invalide');
    const cfg = await guildConfigService.get(guildId);
    const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', guildId);
    const payload = await this.buildNotificationPanel(guildId, style, t, cfg?.brandColor);
    return channel.send(payload);
  }

  async toggleNotification(member: GuildMember, key: string): Promise<(RoleChangeResult & { action: 'added' | 'removed' | 'blocked'; row: NotificationRole }) | null> {
    const row = (await this.listNotificationRoles(member.guild.id)).find((r) => r.key === key && r.enabled);
    if (!row) return null;
    const diff = computeToggle(member.roles.cache.keys(), row.roleId, [row.roleId], false);
    const result = await this.changeRoles(member, diff, `Notification ${key}`);
    await this.logRoleChange(member, 'role.notification', result, { skipDatabase: true, detail: row.label });
    return { ...result, row, action: result.blocked.includes(row.roleId) ? 'blocked' : diff.action };
  }

  async applyNotificationSelection(member: GuildMember, keys: string[]): Promise<RoleChangeResult> {
    const rows = (await this.listNotificationRoles(member.guild.id)).filter((r) => r.enabled);
    const selected = rows.filter((r) => keys.includes(r.key)).map((r) => r.roleId);
    const diff = computeSelection(member.roles.cache.keys(), selected, rows.map((r) => r.roleId));
    const result = await this.changeRoles(member, diff, 'Notifications');
    await this.logRoleChange(member, 'role.notification', result, { skipDatabase: true });
    return result;
  }
}

export const roleService = new RoleService();
