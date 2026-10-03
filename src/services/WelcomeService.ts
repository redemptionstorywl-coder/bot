import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, type EmbedBuilder, type Guild, type GuildMember, type PartialGuildMember } from 'discord.js';
import { LogCategory, Prisma, type LeaveConfig, type WelcomeConfig } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND, LANGUAGE_CODES } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { renderTemplate, type TemplateContext } from '../utils/variables';
import { buildCustomId } from '../utils/customId';
import { colorToHex, embedService, embedSpecSchema, buttonSpecSchema, type ButtonSpec, type EmbedSpec } from './EmbedService';
import { guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { translationService, type Translator } from './TranslationService';
import { welcomeImageService } from './WelcomeImageService';

const log = childLogger('WelcomeService');

/** Valeur unique ou dictionnaire `{ [lang]: valeur }`. */
export type Localized<T> = T | Record<string, T>;

export const WELCOME_IMAGE_FILENAME = 'welcome.png';
export const LEAVE_IMAGE_FILENAME = 'goodbye.png';

/** Vrai si `value` est un dictionnaire dont toutes les clés sont des codes langue. */
export function isLocalizedMap(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 && keys.every((k) => LANGUAGE_CODES.includes(k));
}

/**
 * Résout une valeur multilingue : `value[lang]` → `value[fallback]` → première valeur disponible.
 * Une valeur simple (chaîne, EmbedSpec) est renvoyée telle quelle. `null`/`undefined` → undefined.
 */
export function resolveLocalized<T>(value: Localized<T> | null | undefined, lang: string, fallback?: string): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isLocalizedMap(value)) return value as T;
  const map = value as Record<string, T>;
  if (map[lang] !== undefined && map[lang] !== null) return map[lang];
  if (fallback && map[fallback] !== undefined && map[fallback] !== null) return map[fallback];
  const first = Object.values(map).find((v) => v !== undefined && v !== null);
  return first;
}

/**
 * Met à jour une valeur multilingue de façon immuable.
 *  - `lang` absent : remplace tout (null = effacer).
 *  - `lang` présent : fusionne dans le dictionnaire (une valeur simple existante est rattachée à `baseLang`).
 */
export function setLocalized<T>(current: Localized<T> | null | undefined, value: T | null, lang: string | null | undefined, baseLang: string): Localized<T> | null {
  if (!lang) return value;
  let map: Record<string, T> = {};
  if (isLocalizedMap(current)) map = { ...(current as Record<string, T>) };
  else if (current !== null && current !== undefined) map = { [baseLang]: current as T };
  if (value === null) delete map[lang];
  else map[lang] = value;
  return Object.keys(map).length ? map : null;
}

export interface RenderedMessage {
  content?: string;
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

export interface RenderOptions {
  /** Langue de rendu (langue de l'utilisateur) */
  language: string;
  /** Langue de secours pour les dictionnaires (langue du serveur) */
  fallbackLanguage?: string;
  /** Image générée (PNG) à joindre */
  image?: Buffer | null;
  /** Traducteur (défaut : lié à `language`) */
  t?: Translator;
  /** Couleur par défaut des embeds */
  brandColor?: number;
  /** Inclure les boutons (false pour l'aperçu éphémère) */
  withButtons?: boolean;
  /** Inclure le bouton « Choisir ma langue » quand activé */
  withLanguagePrompt?: boolean;
}

type AnyMember = GuildMember | PartialGuildMember;

function safeEmbed(spec: unknown): EmbedSpec | undefined {
  const r = embedSpecSchema.safeParse(spec);
  return r.success ? r.data : undefined;
}

function safeButtons(value: unknown): ButtonSpec[] {
  if (!Array.isArray(value)) return [];
  const out: ButtonSpec[] = [];
  for (const b of value) {
    const r = buttonSpecSchema.safeParse(b);
    if (r.success) out.push(r.data);
  }
  return out.slice(0, 24);
}

function templateContext(member: AnyMember, language: string): TemplateContext {
  return { member: member as GuildMember, user: member.user, guild: member.guild, language };
}

/**
 * Rend le message de bienvenue (fonction pure : aucun accès réseau/DB).
 * `config.message` / `config.embed` peuvent être une valeur simple ou `{ [lang]: … }`.
 */
export function renderWelcome(member: AnyMember, config: WelcomeConfig, opts: RenderOptions): RenderedMessage {
  const t = opts.t ?? translationService.bind(opts.language, member.guild.id);
  const ctx = templateContext(member, opts.language);
  const message = resolveLocalized<string>(config.message as Localized<string> | null, opts.language, opts.fallbackLanguage);
  const embedSpec = safeEmbed(resolveLocalized<unknown>(config.embed as Localized<unknown> | null, opts.language, opts.fallbackLanguage));
  const files: AttachmentBuilder[] = [];
  const embeds: EmbedBuilder[] = [];

  if (opts.image) files.push(new AttachmentBuilder(opts.image, { name: WELCOME_IMAGE_FILENAME }));
  if (embedSpec) {
    const embed = embedService.build({ color: colorToHex(opts.brandColor ?? BRAND.colors.primary), ...embedSpec }, ctx);
    if (opts.image && !embedSpec.image) embed.setImage(`attachment://${WELCOME_IMAGE_FILENAME}`);
    embeds.push(embed);
  }

  let content = message ? renderTemplate(message, ctx) : undefined;
  if (!content && !embedSpec) content = t('welcome.default_message', { user: `<@${member.id}>`, server: member.guild.name });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (opts.withButtons !== false) {
    const buttons = safeButtons(config.buttons);
    if (opts.withLanguagePrompt !== false && config.languagePromptEnabled) {
      buttons.push({ label: t('welcome.buttons.choose_language'), style: 'primary', emoji: '🌍', customId: buildCustomId('welcome', 'lang', member.guild.id) });
    }
    components.push(...embedService.buildButtons(buttons, ctx));
  }
  return { content, embeds, files, components };
}

/** Rend le message de départ (fonction pure). Variables : {username} {displayName} {memberCount} {joinedAt}. */
export function renderLeave(member: AnyMember, config: LeaveConfig, opts: RenderOptions): RenderedMessage {
  const t = opts.t ?? translationService.bind(opts.language, member.guild.id);
  const ctx = templateContext(member, opts.language);
  const message = resolveLocalized<string>(config.message as Localized<string> | null, opts.language, opts.fallbackLanguage);
  const embedSpec = safeEmbed(resolveLocalized<unknown>(config.embed as Localized<unknown> | null, opts.language, opts.fallbackLanguage));
  const files: AttachmentBuilder[] = [];
  const embeds: EmbedBuilder[] = [];
  if (opts.image) files.push(new AttachmentBuilder(opts.image, { name: LEAVE_IMAGE_FILENAME }));
  if (embedSpec) {
    const embed = embedService.build({ color: colorToHex(opts.brandColor ?? BRAND.colors.anthracite), ...embedSpec }, ctx);
    if (opts.image && !embedSpec.image) embed.setImage(`attachment://${LEAVE_IMAGE_FILENAME}`);
    embeds.push(embed);
  }
  let content = message ? renderTemplate(message, ctx) : undefined;
  if (!content && !embedSpec) content = t('welcome.leave.default_message', { username: member.user?.username ?? member.displayName, memberCount: member.guild.memberCount });
  return { content, embeds, files, components: [] };
}

export type WelcomeConfigPatch = Partial<Omit<Prisma.WelcomeConfigUncheckedCreateInput, 'guildId'>>;
export type LeaveConfigPatch = Partial<Omit<Prisma.LeaveConfigUncheckedCreateInput, 'guildId'>>;

/**
 * Bienvenue / départ : configuration (cache), rendu, envoi (salon + DM), image, test.
 */
export class WelcomeService {
  private readonly welcomeCache = new TTLCache<WelcomeConfig | null>(5 * 60_000);
  private readonly leaveCache = new TTLCache<LeaveConfig | null>(5 * 60_000);

  // ───── Configuration ─────

  async getConfig(guildId: string): Promise<WelcomeConfig | null> {
    const cached = this.welcomeCache.get(guildId);
    if (cached !== undefined) return cached;
    const row = await prisma.welcomeConfig.findUnique({ where: { guildId } });
    this.welcomeCache.set(guildId, row);
    return row;
  }

  async getLeaveConfig(guildId: string): Promise<LeaveConfig | null> {
    const cached = this.leaveCache.get(guildId);
    if (cached !== undefined) return cached;
    const row = await prisma.leaveConfig.findUnique({ where: { guildId } });
    this.leaveCache.set(guildId, row);
    return row;
  }

  async updateConfig(guildId: string, data: WelcomeConfigPatch): Promise<WelcomeConfig> {
    const row = await prisma.welcomeConfig.upsert({ where: { guildId }, create: { ...data, guildId }, update: data });
    this.invalidate(guildId);
    return row;
  }

  async updateLeaveConfig(guildId: string, data: LeaveConfigPatch): Promise<LeaveConfig> {
    const row = await prisma.leaveConfig.upsert({ where: { guildId }, create: { ...data, guildId }, update: data });
    this.invalidate(guildId);
    return row;
  }

  invalidate(guildId: string): void {
    this.welcomeCache.delete(guildId);
    this.leaveCache.delete(guildId);
  }

  // ───── Rendu complet (avec image) ─────

  private async resolveLanguages(guildId: string, userId: string): Promise<{ language: string; fallback: string; brandColor: number }> {
    const cfg = await guildConfigService.get(guildId);
    const fallback = cfg?.defaultLanguage ?? 'fr';
    const language = await translationService.resolveLanguage({ guildId, userId, guildDefault: fallback, enabledLanguages: cfg?.enabledLanguages });
    return { language, fallback, brandColor: cfg?.brandColor ?? BRAND.colors.primary };
  }

  /** Construit le message de bienvenue complet (image générée si activée). */
  async buildWelcome(member: AnyMember, config: WelcomeConfig, opts: Partial<RenderOptions> = {}): Promise<RenderedMessage> {
    const langs = await this.resolveLanguages(member.guild.id, member.id);
    const language = opts.language ?? langs.language;
    const ctx = templateContext(member, language);
    const image =
      opts.image !== undefined
        ? opts.image
        : config.imageEnabled
          ? await welcomeImageService.tryGenerate({
              title: renderTemplate(config.imageTitle, ctx),
              subtitle: renderTemplate(config.imageSubtitle, ctx),
              avatarUrl: member.user?.displayAvatarURL({ extension: 'png', size: 256 }) ?? null,
              backgroundUrl: config.imageBackgroundUrl,
              accentColor: langs.brandColor,
            })
          : null;
    return renderWelcome(member, config, { ...opts, language, fallbackLanguage: opts.fallbackLanguage ?? langs.fallback, image, brandColor: langs.brandColor, t: opts.t ?? translationService.bind(language, member.guild.id) });
  }

  /** Construit le message de départ complet. */
  async buildLeave(member: AnyMember, config: LeaveConfig, opts: Partial<RenderOptions> = {}): Promise<RenderedMessage> {
    const langs = await this.resolveLanguages(member.guild.id, member.id);
    const language = opts.language ?? langs.fallback; // le départ est rendu dans la langue du serveur
    const t = opts.t ?? translationService.bind(language, member.guild.id);
    const ctx = templateContext(member, language);
    const image =
      opts.image !== undefined
        ? opts.image
        : config.imageEnabled
          ? await welcomeImageService.tryGenerate({
              title: t('welcome.leave.image_title'),
              subtitle: renderTemplate(t('welcome.leave.image_subtitle'), ctx),
              avatarUrl: member.user?.displayAvatarURL({ extension: 'png', size: 256 }) ?? null,
              backgroundUrl: config.imageBackgroundUrl,
              accentColor: BRAND.colors.neutral,
            })
          : null;
    return renderLeave(member, config, { ...opts, language, fallbackLanguage: langs.fallback, image, brandColor: BRAND.colors.anthracite, t });
  }

  /** Aperçu (commande test / dashboard) : message de bienvenue tel qu'il serait envoyé. */
  async preview(guild: Guild, member: GuildMember): Promise<RenderedMessage | null> {
    const config = await this.getConfig(guild.id);
    if (!config) return null;
    return this.buildWelcome(member, config);
  }

  async previewLeave(guild: Guild, member: GuildMember): Promise<RenderedMessage | null> {
    const config = await this.getLeaveConfig(guild.id);
    if (!config) return null;
    return this.buildLeave(member, config);
  }

  // ───── Envoi ─────

  private async sendToChannel(guild: Guild, channelId: string, payload: RenderedMessage): Promise<boolean> {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) return false;
    await channel.send({ content: payload.content, embeds: payload.embeds, files: payload.files, components: payload.components });
    return true;
  }

  /** Envoie le DM de bienvenue (dmMessage / dmEmbed, multilingues). Ne lance jamais. */
  async sendDm(member: GuildMember, config: WelcomeConfig, language: string, fallback: string): Promise<boolean> {
    if (!config.dmEnabled) return false;
    const ctx = templateContext(member, language);
    const t = translationService.bind(language, member.guild.id);
    const message = resolveLocalized<string>(config.dmMessage as Localized<string> | null, language, fallback);
    const embedSpec = safeEmbed(resolveLocalized<unknown>(config.dmEmbed as Localized<unknown> | null, language, fallback));
    if (!message && !embedSpec) return false;
    const embeds = embedSpec ? [embedService.build(embedSpec, ctx)] : [];
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (config.languagePromptEnabled) {
      components.push(...embedService.buildButtons([{ label: t('welcome.buttons.choose_language'), style: 'primary', emoji: '🌍', customId: buildCustomId('welcome', 'lang', member.guild.id) }], ctx));
    }
    try {
      await member.send({ content: message ? renderTemplate(message, ctx) : undefined, embeds, components });
      return true;
    } catch (err) {
      log.debug({ err, user: member.id }, 'DM de bienvenue impossible (DM fermés ?)');
      return false;
    }
  }

  /** Traite l'arrivée d'un membre : message dans le salon configuré + DM. Ne lance jamais. */
  async handleJoin(member: GuildMember): Promise<void> {
    try {
      const config = await this.getConfig(member.guild.id);
      if (!config?.enabled) return;
      const langs = await this.resolveLanguages(member.guild.id, member.id);
      if (config.channelId) {
        const payload = await this.buildWelcome(member, config, { language: langs.language, fallbackLanguage: langs.fallback });
        const sent = await this.sendToChannel(member.guild, config.channelId, payload).catch((err) => {
          log.warn({ err, guild: member.guild.id }, 'Envoi du message de bienvenue impossible');
          return false;
        });
        if (!sent) log.warn({ guild: member.guild.id, channel: config.channelId }, 'Salon de bienvenue introuvable');
      }
      if (!member.user.bot) await this.sendDm(member, config, langs.language, langs.fallback);
    } catch (err) {
      log.error({ err, guild: member.guild.id, user: member.id }, 'handleJoin');
    }
  }

  /** Traite le départ d'un membre : message + log MEMBER. Ne lance jamais. */
  async handleLeave(member: AnyMember): Promise<void> {
    try {
      const config = await this.getLeaveConfig(member.guild.id);
      if (!config?.enabled) return;
      if (config.channelId) {
        const payload = await this.buildLeave(member, config);
        await this.sendToChannel(member.guild, config.channelId, payload).catch((err) => log.warn({ err, guild: member.guild.id }, 'Envoi du message de départ impossible'));
      }
      if (config.logEnabled) {
        const cfg = await guildConfigService.get(member.guild.id);
        const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', member.guild.id);
        const roles = 'roles' in member && member.roles?.cache ? member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`).slice(0, 15).join(' ') : '';
        await loggingService.log({
          guildId: member.guild.id,
          category: LogCategory.MEMBER,
          action: 'member.leave',
          title: t('welcome.leave.log_title'),
          description: t('welcome.leave.log_description', { user: `<@${member.id}>`, tag: member.user?.username ?? member.id, memberCount: member.guild.memberCount }),
          fields: [
            { name: t('welcome.leave.log_joined'), value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '—', inline: true },
            { name: t('welcome.leave.log_roles'), value: roles || '—', inline: false },
          ],
          targetId: member.id,
          thumbnail: member.user?.displayAvatarURL({ size: 128 }),
          color: BRAND.colors.neutral,
        });
      }
    } catch (err) {
      log.error({ err, guild: member.guild.id, user: member.id }, 'handleLeave');
    }
  }
}

export const welcomeService = new WelcomeService();
