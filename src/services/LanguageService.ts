import {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  GuildMember,
  MessageFlags,
  type Client,
  type EmbedBuilder,
  type Guild,
  type Message,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
  type RepliableInteraction,
} from 'discord.js';
import { AutoRoleType, LogCategory, PanelStyle, type LanguageRole } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND, LANGUAGES, getLanguage, type LanguageDefinition } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { buildCustomId } from '../utils/customId';
import { colorToHex, embedService } from './EmbedService';
import { guildConfigService, type ResolvedGuildConfig } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { roleService } from './RoleService';
import { translationService, type Translator } from './TranslationService';
import { renderWelcome, welcomeService } from './WelcomeService';

const log = childLogger('LanguageService');

export type LanguageRoleMap = Record<string, string>;

/** Map `{ lang: roleId }` construite depuis LANGUAGES[].defaultRoleId, limitée aux rôles existants. */
export function buildDefaultRoleMap(hasRole: (roleId: string) => boolean): LanguageRoleMap {
  const out: LanguageRoleMap = {};
  for (const l of LANGUAGES) if (l.defaultRoleId && hasRole(l.defaultRoleId)) out[l.code] = l.defaultRoleId;
  return out;
}

/** Map effective : LanguageRole configurés, sinon rôles par défaut (Battle Royale) présents sur le serveur. */
export function resolveRoleMap(configured: LanguageRoleMap, hasRole: (roleId: string) => boolean): LanguageRoleMap {
  const filtered: LanguageRoleMap = {};
  for (const [lang, roleId] of Object.entries(configured)) if (hasRole(roleId)) filtered[lang] = roleId;
  if (Object.keys(filtered).length) return filtered;
  return buildDefaultRoleMap(hasRole);
}

/** Langues activées sur le serveur, dans l'ordre de LANGUAGES. */
export function enabledLanguageDefinitions(config: Pick<ResolvedGuildConfig, 'enabledLanguages'> | null | undefined): LanguageDefinition[] {
  const enabled = config?.enabledLanguages?.length ? config.enabledLanguages : ['fr', 'en'];
  return LANGUAGES.filter((l) => enabled.includes(l.code));
}

export interface ApplyLanguageResult {
  ok: boolean;
  language: LanguageDefinition;
  /** Langue non activée sur le serveur */
  notEnabled?: boolean;
  /** Aucun rôle configuré pour cette langue (la préférence est quand même enregistrée) */
  noRole?: boolean;
  roleAdded: string | null;
  rolesRemoved: string[];
  autoRolesAdded: string[];
  /** Rôles impossibles à gérer (hiérarchie) */
  blocked: string[];
}

/**
 * Multilingue par rôle : panneau « 🌍 CHOOSE YOUR LANGUAGE », rôles de langue,
 * application du choix (rôles + préférence + autoroles MEMBER/LANGUAGE), réponse de bienvenue traduite.
 */
export class LanguageService {
  private client: Client | null = null;
  private readonly roleMaps = new TTLCache<LanguageRoleMap>(5 * 60_000);
  private readonly roleRows = new TTLCache<LanguageRole[]>(5 * 60_000);

  attach(client: Client): void {
    this.client = client;
  }

  invalidate(guildId: string): void {
    this.roleMaps.delete(guildId);
    this.roleRows.delete(guildId);
  }

  // ───── Rôles de langue ─────

  async listLanguageRoles(guildId: string): Promise<LanguageRole[]> {
    return this.roleRows.getOrSet(guildId, () => prisma.languageRole.findMany({ where: { guildId }, orderBy: { id: 'asc' } }));
  }

  /** Map `{ lang: roleId }` des LanguageRole activés (cache TTL). */
  async getLanguageRoleMap(guildId: string): Promise<LanguageRoleMap> {
    return this.roleMaps.getOrSet(guildId, async () => {
      const rows = await this.listLanguageRoles(guildId);
      const map: LanguageRoleMap = {};
      for (const r of rows) if (r.enabled) map[r.language] = r.roleId;
      return map;
    });
  }

  /** Map effective pour un serveur (configurée, sinon défauts existants). */
  async getEffectiveRoleMap(guild: Guild): Promise<LanguageRoleMap> {
    const configured = await this.getLanguageRoleMap(guild.id);
    return resolveRoleMap(configured, (id) => guild.roles.cache.has(id));
  }

  async setLanguageRole(guildId: string, language: string, roleId: string, opts: { emoji?: string | null; label?: string | null } = {}): Promise<LanguageRole> {
    if (!getLanguage(language)) throw new Error(`Langue inconnue : ${language}`);
    const row = await prisma.languageRole.upsert({
      where: { guildId_language: { guildId, language } },
      create: { guildId, language, roleId, emoji: opts.emoji ?? null, label: opts.label ?? null },
      update: { roleId, enabled: true, ...(opts.emoji !== undefined ? { emoji: opts.emoji } : {}), ...(opts.label !== undefined ? { label: opts.label } : {}) },
    });
    this.invalidate(guildId);
    return row;
  }

  async removeLanguageRole(guildId: string, language: string): Promise<number> {
    const r = await prisma.languageRole.deleteMany({ where: { guildId, language } });
    this.invalidate(guildId);
    return r.count;
  }

  /** Remplace la configuration par les rôles par défaut (LANGUAGES[].defaultRoleId) présents sur le serveur. */
  async resetDefaults(guild: Guild): Promise<{ configured: LanguageRoleMap; missing: string[] }> {
    const defaults = buildDefaultRoleMap((id) => guild.roles.cache.has(id));
    const missing = LANGUAGES.filter((l) => l.defaultRoleId && !defaults[l.code]).map((l) => l.code);
    await prisma.languageRole.deleteMany({ where: { guildId: guild.id } });
    for (const [language, roleId] of Object.entries(defaults)) {
      const def = getLanguage(language)!;
      await prisma.languageRole.create({ data: { guildId: guild.id, language, roleId, emoji: def.flag, label: def.nativeLabel } });
    }
    this.invalidate(guild.id);
    return { configured: defaults, missing };
  }

  // ───── Application du choix ─────

  /**
   * Applique une langue à un membre :
   * 1. retire les autres rôles de langue · 2. donne le rôle de la langue · 3. enregistre la préférence
   * 4. donne les autoroles MEMBER / LANGUAGE. Un seul PATCH Discord. Log MEMBER `language.change`.
   */
  async applyLanguage(member: GuildMember, lang: string, opts: { actorId?: string | null } = {}): Promise<ApplyLanguageResult> {
    const language = getLanguage(lang);
    if (!language) throw new Error(`Langue inconnue : ${lang}`);
    const cfg = await guildConfigService.get(member.guild.id);
    const base: ApplyLanguageResult = { ok: false, language, roleAdded: null, rolesRemoved: [], autoRolesAdded: [], blocked: [] };
    if (cfg && !cfg.enabledLanguages.includes(lang)) return { ...base, notEnabled: true };

    const roleMap = await this.getEffectiveRoleMap(member.guild);
    const target = roleMap[lang] ?? null;
    const others = Object.entries(roleMap)
      .filter(([l, roleId]) => l !== lang && roleId !== target && member.roles.cache.has(roleId))
      .map(([, roleId]) => roleId);
    const autoRoleRules = (await roleService.listAutoRoles(member.guild.id)).filter((r) => r.enabled && (r.type === AutoRoleType.MEMBER || r.type === AutoRoleType.LANGUAGE));
    const autoRoles = autoRoleRules
      .filter((r) => r.delaySeconds <= 0)
      .map((r) => r.roleId)
      .filter((id) => id !== target && !others.includes(id));
    for (const rule of autoRoleRules.filter((r) => r.delaySeconds > 0)) roleService.scheduleAutoRole(member, rule);

    const result = await roleService.changeRoles(member, { add: [...(target ? [target] : []), ...autoRoles], remove: others }, `Language: ${language.code}`);

    await translationService.setUserLanguage(member.guild.id, member.id, lang, {
      username: member.user.username,
      globalName: member.user.globalName,
      avatar: member.user.avatar,
    });

    const roleAdded = target && (result.added.includes(target) || member.roles.cache.has(target)) && !result.blocked.includes(target) ? target : null;
    const out: ApplyLanguageResult = {
      ok: true,
      language,
      noRole: !target,
      roleAdded,
      rolesRemoved: result.removed,
      autoRolesAdded: result.added.filter((id) => autoRoles.includes(id)),
      blocked: result.blocked,
    };

    const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', member.guild.id);
    await loggingService.log({
      guildId: member.guild.id,
      category: LogCategory.MEMBER,
      action: 'language.change',
      title: t('language.log.title'),
      description: t('language.log.description', { user: `<@${member.id}>`, flag: language.flag, language: language.nativeLabel }),
      fields: [
        { name: t('language.log.role_added'), value: roleAdded ? `<@&${roleAdded}>` : '—', inline: true },
        { name: t('language.log.roles_removed'), value: result.removed.map((r) => `<@&${r}>`).join(' ') || '—', inline: true },
        ...(result.blocked.length ? [{ name: t('language.log.blocked'), value: result.blocked.map((r) => `<@&${r}>`).join(' '), inline: true }] : []),
      ],
      actorId: opts.actorId ?? member.id,
      targetId: member.id,
      color: BRAND.colors.primary,
      data: { language: lang, roleAdded, removed: result.removed, autoRoles: out.autoRolesAdded, blocked: result.blocked },
    });
    return out;
  }

  /** Réponse éphémère après un choix : confirmation + message de bienvenue rendu dans la langue choisie. */
  async buildChoiceReply(member: GuildMember, result: ApplyLanguageResult): Promise<{ content: string; embeds: EmbedBuilder[] }> {
    const t = translationService.bind(result.language.code, member.guild.id);
    if (result.notEnabled) return { content: t('language.not_enabled', { flag: result.language.flag, language: result.language.nativeLabel }), embeds: [] };
    const lines = [t('language.changed', { flag: result.language.flag, language: result.language.nativeLabel })];
    if (result.noRole) lines.push(t('language.no_role'));
    else if (result.blocked.length) lines.push(t('language.blocked_roles', { roles: result.blocked.map((r) => `<@&${r}>`).join(' ') }));
    const embeds: EmbedBuilder[] = [];
    const welcome = await welcomeService.getConfig(member.guild.id).catch(() => null);
    if (welcome && (welcome.message || welcome.embed)) {
      const cfg = await guildConfigService.get(member.guild.id);
      const rendered = renderWelcome(member, welcome, { language: result.language.code, fallbackLanguage: cfg?.defaultLanguage, image: null, withButtons: false, brandColor: cfg?.brandColor, t });
      if (rendered.content) lines.push('', rendered.content);
      embeds.push(...rendered.embeds);
    }
    return { content: lines.join('\n').slice(0, 2000), embeds };
  }

  // ───── Panneau ─────

  /** Ligne de sélection (select menu) des langues activées. `guildId` est encodé pour un usage en DM. */
  buildSelectRow(config: Pick<ResolvedGuildConfig, 'enabledLanguages'> | null, t: Translator, guildId?: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
    const langs = enabledLanguageDefinitions(config);
    const select = new StringSelectMenuBuilder()
      .setCustomId(guildId ? buildCustomId('lang', 'select', guildId) : buildCustomId('lang', 'select'))
      .setPlaceholder(t('language.select.placeholder').slice(0, 150))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(langs.map((l) => new StringSelectMenuOptionBuilder().setValue(l.code).setLabel(l.nativeLabel).setEmoji(l.flag).setDescription(l.label)));
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
  }

  /** Panneau « 🌍 CHOOSE YOUR LANGUAGE » : embed + boutons drapeaux (5 par rangée) ou select. */
  buildPanel(config: ResolvedGuildConfig, lang: string, style: PanelStyle = PanelStyle.BUTTONS): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
    const t = translationService.bind(lang, config.guildId);
    const langs = enabledLanguageDefinitions(config);
    const embed = embedService
      .build({ title: t('language.panel.title'), description: `${t('language.panel.description')}\n\n${langs.map((l) => `${l.flag} **${l.nativeLabel}**`).join('\n')}`, footer: { text: config.footerText ?? BRAND.footer }, color: colorToHex(config.brandColor) }, { guild: null });
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    if (style === PanelStyle.SELECT) {
      components.push(this.buildSelectRow(config, t));
    } else {
      for (let i = 0; i < langs.length && components.length < 5; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        for (const l of langs.slice(i, i + 5)) row.addComponents(new ButtonBuilder().setCustomId(buildCustomId('lang', 'set', l.code)).setLabel(l.nativeLabel).setEmoji(l.flag).setStyle(ButtonStyle.Secondary));
        components.push(row);
      }
    }
    return { embeds: [embed], components };
  }

  private async fetchPanelMessage(guild: Guild, channelId: string, messageId: string): Promise<Message | null> {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return null;
    return channel.messages.fetch(messageId).catch(() => null);
  }

  /** Publie le panneau dans un salon (édite le message existant si même salon) et mémorise channelId/messageId. */


  /**
   * Crée les rôles de langue manquants (nom `🇫🇷・Français`) pour les langues données (défaut : langues activées).
   * Réutilise un rôle existant par ID configuré, ID par défaut, ou nom. Appelé au démarrage pour chaque serveur.
   */
  async ensureRoles(guild: Guild, languages?: string[]): Promise<{ createdRoles: string[]; reusedRoles: string[] }> {
    const config = await guildConfigService.getOrCreate(guild);
    const codes = (languages?.length ? languages : config.enabledLanguages).filter((c) => getLanguage(c));
    const configured = await this.getLanguageRoleMap(guild.id);
    const createdRoles: string[] = [];
    const reusedRoles: string[] = [];
    const normalize = (n: string) => n.replace(/[\s・·|•-]+/g, ' ').trim().toLowerCase();
    await guild.roles.fetch();
    for (const code of codes) {
      const def = getLanguage(code)!;
      const expectedName = `${def.flag}・${def.nativeLabel}`;
      let roleId = configured[code] && guild.roles.cache.has(configured[code]!) ? configured[code]! : undefined;
      if (!roleId && def.defaultRoleId && guild.roles.cache.has(def.defaultRoleId)) roleId = def.defaultRoleId;
      if (!roleId) {
        const byName = guild.roles.cache.find((r) => normalize(r.name) === normalize(expectedName) || normalize(r.name) === normalize(def.nativeLabel));
        if (byName) roleId = byName.id;
      }
      if (roleId) reusedRoles.push(code);
      else {
        const role = await guild.roles.create({ name: expectedName, mentionable: false, hoist: false, permissions: [], reason: 'Redemption Story — rôle de langue' });
        roleId = role.id;
        createdRoles.push(code);
      }
      if (configured[code] !== roleId) await this.setLanguageRole(guild.id, code, roleId, { emoji: def.flag, label: def.nativeLabel });
    }
    if (createdRoles.length) {
      log.info({ guild: guild.id, createdRoles }, 'Rôles de langue créés');
      await loggingService.log({ guildId: guild.id, category: LogCategory.ROLE, action: 'language.roles_created', title: '🌍 Rôles de langue créés', description: createdRoles.map((c) => `${getLanguage(c)?.flag} ${getLanguage(c)?.nativeLabel}`).join(', ') });
    }
    return { createdRoles, reusedRoles };
  }

  /** Crée les rôles de langue manquants sur tous les serveurs où le module langue est actif (démarrage). */
  async ensureRolesEverywhere(): Promise<void> {
    if (!this.client) return;
    for (const guild of this.client.guilds.cache.values()) {
      try {
        const config = await guildConfigService.getOrCreate(guild);
        if (!config.modules.language) continue;
        const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          log.warn({ guild: guild.id }, 'Rôles de langue non créés : permission ManageRoles manquante');
          continue;
        }
        await this.ensureRoles(guild);
      } catch (err) {
        log.error({ err, guild: guild.id }, 'ensureRoles');
      }
    }
  }

  /**
   * Installation complète du système de langue sur un serveur :
   *  1. crée les rôles de langue manquants (nom `🇫🇷・Français`), ou réutilise un rôle existant (ID par défaut ou même nom) ;
   *  2. crée le salon de choix de langue s'il n'est pas fourni (lecture seule pour @everyone) ;
   *  3. publie (ou met à jour) le panneau « CHOOSE YOUR LANGUAGE » ;
   *  4. désactive le choix de langue sous le message de bienvenue.
   */
  async setup(guild: Guild, opts: { channelId?: string; style?: PanelStyle; channelName?: string; languages?: string[] } = {}): Promise<{ createdRoles: string[]; reusedRoles: string[]; channelId: string; channelCreated: boolean; message: Message }> {
    const config = await guildConfigService.getOrCreate(guild);
    const languages = (opts.languages?.length ? opts.languages : config.enabledLanguages).filter((c) => getLanguage(c));
    const configured = await this.getLanguageRoleMap(guild.id);
    const { createdRoles, reusedRoles } = await this.ensureRoles(guild, languages);
    const normalize = (n: string) => n.replace(/[\s・·|•-]+/g, ' ').trim().toLowerCase();

    let channelId = opts.channelId;
    let channelCreated = false;
    if (!channelId) {
      const wanted = normalize(opts.channelName ?? '🌍・langues');
      const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && (normalize(c.name) === wanted || normalize(c.name) === 'choose language' || normalize(c.name) === 'langues' || normalize(c.name) === 'language'));
      if (existing) channelId = existing.id;
      else {
        const channel = await guild.channels.create({
          name: opts.channelName ?? '🌍・langues',
          type: ChannelType.GuildText,
          reason: 'Redemption Story — salon de choix de langue',
          permissionOverwrites: [
            { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
            { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] },
          ],
        });
        channelId = channel.id;
        channelCreated = true;
      }
    }

    const message = await this.publishPanel(guild, channelId, opts.style ?? PanelStyle.BUTTONS);
    await prisma.welcomeConfig.upsert({ where: { guildId: guild.id }, create: { guildId: guild.id, languagePromptEnabled: false }, update: { languagePromptEnabled: false } });
    this.invalidate(guild.id);
    await loggingService.log({ guildId: guild.id, category: LogCategory.SYSTEM, action: 'language.setup', title: '🌍 Système de langue installé', fields: [{ name: 'Rôles créés', value: createdRoles.join(', ') || '—', inline: true }, { name: 'Salon', value: `<#${channelId}>`, inline: true }] });
    return { createdRoles, reusedRoles, channelId, channelCreated, message };
  }

  async publishPanel(guild: Guild, channelId: string, style: PanelStyle = PanelStyle.BUTTONS): Promise<Message> {
    const config = await guildConfigService.getOrCreate(guild);
    const payload = this.buildPanel(config, config.defaultLanguage, style);
    const settings = config.raw.settings;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Salon invalide');
    let message: Message | null = null;
    if (settings?.languagePanelChannelId && settings.languagePanelMessageId) {
      const existing = await this.fetchPanelMessage(guild, settings.languagePanelChannelId, settings.languagePanelMessageId);
      if (existing && settings.languagePanelChannelId === channelId) message = await existing.edit(payload);
      else await existing?.delete().catch(() => null);
    }
    if (!message) message = await channel.send(payload);
    await guildConfigService.updateSettings(guild.id, { languagePanelChannelId: channelId, languagePanelMessageId: message.id });
    log.info({ guild: guild.id, channel: channelId, message: message.id, style }, 'Panneau de langue publié');
    return message;
  }

  /** Met à jour le panneau publié (après changement des langues activées). Retourne false s'il n'existe pas. */
  async refreshPanel(guild: Guild, style?: PanelStyle): Promise<boolean> {
    const config = await guildConfigService.getOrCreate(guild);
    const settings = config.raw.settings;
    if (!settings?.languagePanelChannelId || !settings.languagePanelMessageId) return false;
    const existing = await this.fetchPanelMessage(guild, settings.languagePanelChannelId, settings.languagePanelMessageId);
    if (!existing) return false;
    const currentStyle = style ?? (existing.components.some((row) => 'components' in row && row.components.some((c) => c.type === 3)) ? PanelStyle.SELECT : PanelStyle.BUTTONS);
    await existing.edit(this.buildPanel(config, config.defaultLanguage, currentStyle));
    return true;
  }

  /**
   * Flux complet d'un choix de langue depuis un bouton / select / commande :
   * accuse réception (< 3 s), applique, puis répond en éphémère dans la langue choisie.
   */
  async respondToChoice(interaction: RepliableInteraction, code: string, guildIdHint?: string | null): Promise<void> {
    const guild = interaction.guild ?? this.resolveGuild(guildIdHint ?? interaction.guildId);
    const ephemeralSource = interaction.isMessageComponent() && interaction.message.flags.has(MessageFlags.Ephemeral);
    if (ephemeralSource) await (interaction as MessageComponentInteraction).deferUpdate();
    else if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const language = getLanguage(code);
    const tFallback = translationService.bind(language?.code ?? 'en', guild?.id);
    if (!guild) {
      await interaction.editReply({ content: tFallback('language.guild_unavailable'), embeds: [], components: [] });
      return;
    }
    if (!language) {
      await interaction.editReply({ content: tFallback('core.invalid_input', { details: code }), embeds: [], components: [] });
      return;
    }
    const member = interaction.member instanceof GuildMember && interaction.member.guild.id === guild.id ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: tFallback('core.member_not_found'), embeds: [], components: [] });
      return;
    }
    const result = await this.applyLanguage(member, code);
    const reply = await this.buildChoiceReply(member, result);
    await interaction.editReply({ content: reply.content, embeds: reply.embeds, components: [] });
  }

  /** Résout le serveur d'une interaction (en DM, l'ID est encodé dans le customId). */
  resolveGuild(guildId: string | null | undefined): Guild | null {
    if (!guildId || !this.client) return null;
    return this.client.guilds.cache.get(guildId) ?? null;
  }
}

export const languageService = new LanguageService();
