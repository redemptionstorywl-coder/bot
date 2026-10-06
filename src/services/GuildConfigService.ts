import type { Guild as DiscordGuild } from 'discord.js';
import { GuildKind, Prisma, type Guild, type GuildSettings, type LogChannel } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND, DEFAULT_BRAND_HEX, DEFAULT_MODULES_BY_KIND, MODULE_KEYS, type ModuleKey } from '../config/constants';
import { TTLCache } from '../utils/cache';
import { childLogger } from '../utils/logger';
import { EventEmitter } from 'node:events';
import { DEFAULT_AUTO_TRANSLATE, type AutoTranslateConfig } from './autotranslate/bilingual';

const log = childLogger('GuildConfigService');

/** Émis (guildId) après la recréation d'un salon (/clear salon) : les services gardant des IDs de salons en cache les invalident. */
export const CHANNELS_REMAPPED_EVENT = 'channels:remapped';

export type { AutoTranslateConfig };

export interface ResolvedGuildConfig {
  guildId: string;
  kind: GuildKind;
  name: string;
  defaultLanguage: string;
  timezone: string;
  brandColor: number;
  adminRoleIds: string[];
  staffRoleIds: string[];
  modules: Record<ModuleKey, boolean>;
  logChannels: Partial<Record<string, string>>;
  footerText: string | null;
  footerIconUrl: string | null;
  autoTranslate: AutoTranslateConfig;
  raw: Guild & { settings: GuildSettings | null; logChannels: LogChannel[] };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Charge et met en cache la configuration de chaque serveur.
 * Émet `update` (guildId) quand une config change (dashboard / commandes) pour les abonnés (Socket.IO…).
 */
export class GuildConfigService extends EventEmitter {
  private readonly cache = new TTLCache<ResolvedGuildConfig>(5 * 60_000, 2000);

  /** S'assure que le serveur existe en base (appelé à ready / guildCreate). */
  async ensureGuild(guild: DiscordGuild): Promise<void> {
    await prisma.guild.upsert({
      where: { id: guild.id },
      create: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        ownerId: guild.ownerId,
        settings: { create: { modules: DEFAULT_MODULES_BY_KIND.GENERIC as Prisma.InputJsonValue } },
      },
      update: { name: guild.name, icon: guild.iconURL(), ownerId: guild.ownerId, leftAt: null },
    });
    // S'assurer que settings existe (si guild créé autrement)
    await prisma.guildSettings.upsert({ where: { guildId: guild.id }, create: { guildId: guild.id }, update: {} });
  }

  async markLeft(guildId: string): Promise<void> {
    await prisma.guild.updateMany({ where: { id: guildId }, data: { leftAt: new Date() } });
    this.invalidate(guildId);
  }

  async get(guildId: string): Promise<ResolvedGuildConfig | null> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const raw = await prisma.guild.findUnique({ where: { id: guildId }, include: { settings: true, logChannels: true } });
    if (!raw) return null;
    const resolved = this.resolve(raw, await this.loadAutoTranslate(guildId));
    this.cache.set(guildId, resolved);
    return resolved;
  }

  /** Comme get() mais crée le serveur s'il n'existe pas encore. */
  async getOrCreate(guild: DiscordGuild): Promise<ResolvedGuildConfig> {
    const existing = await this.get(guild.id);
    if (existing) return existing;
    await this.ensureGuild(guild);
    const created = await this.get(guild.id);
    if (!created) throw new Error(`Impossible de créer la configuration du serveur ${guild.id}`);
    return created;
  }

  /** Réglage de traduction automatique (défaut : désactivé ; table absente ou erreur → défaut). */
  private async loadAutoTranslate(guildId: string): Promise<AutoTranslateConfig> {
    try {
      const row = await prisma.autoTranslateSettings.findUnique({ where: { guildId } });
      if (!row) return { ...DEFAULT_AUTO_TRANSLATE };
      return { enabled: row.enabled === true, layout: row.layout === 'content' ? 'content' : 'embed' };
    } catch (err) {
      log.debug({ err, guildId }, 'Lecture du réglage de traduction automatique impossible');
      return { ...DEFAULT_AUTO_TRANSLATE };
    }
  }

  private resolve(raw: Guild & { settings: GuildSettings | null; logChannels: LogChannel[] }, autoTranslate: AutoTranslateConfig = { ...DEFAULT_AUTO_TRANSLATE }): ResolvedGuildConfig {
    const s = raw.settings;
    const defaults = DEFAULT_MODULES_BY_KIND[raw.kind] ?? {};
    const stored = (s?.modules && typeof s.modules === 'object' && !Array.isArray(s.modules) ? (s.modules as Record<string, unknown>) : {}) as Record<string, unknown>;
    const modules = {} as Record<ModuleKey, boolean>;
    for (const key of MODULE_KEYS) {
      const v = stored[key];
      modules[key] = typeof v === 'boolean' ? v : (defaults[key] ?? false);
    }
    const logChannels: Partial<Record<string, string>> = {};
    for (const lc of raw.logChannels) if (lc.enabled) logChannels[lc.category] = lc.channelId;
    const brand = s?.brandColor ?? DEFAULT_BRAND_HEX;
    return {
      guildId: raw.id,
      kind: raw.kind,
      name: raw.name,
      defaultLanguage: s?.defaultLanguage === 'en' ? 'en' : 'fr',
      timezone: s?.timezone ?? 'Europe/Paris',
      brandColor: parseInt(brand.replace('#', ''), 16) || BRAND.colors.primary,
      adminRoleIds: asStringArray(s?.adminRoleIds),
      staffRoleIds: asStringArray(s?.staffRoleIds),
      modules,
      logChannels,
      footerText: s?.footerText ?? null,
      footerIconUrl: s?.footerIconUrl ?? null,
      autoTranslate,
      raw,
    };
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
    this.emit('update', guildId);
  }

  async isModuleEnabled(guildId: string, module: ModuleKey): Promise<boolean> {
    const cfg = await this.get(guildId);
    return cfg?.modules[module] ?? false;
  }

  async setModule(guildId: string, module: ModuleKey, enabled: boolean): Promise<void> {
    const cfg = await this.get(guildId);
    const modules = { ...(cfg?.modules ?? {}), [module]: enabled };
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, modules }, update: { modules } });
    this.invalidate(guildId);
    log.info({ guildId, module, enabled }, 'Module mis à jour');
  }

  async setKind(guildId: string, kind: GuildKind): Promise<void> {
    const cfg = await this.get(guildId);
    const defaults = DEFAULT_MODULES_BY_KIND[kind];
    // Active les modules par défaut du type sans désactiver ceux explicitement activés
    const modules = { ...defaults, ...(cfg?.modules ?? {}) };
    for (const [k, v] of Object.entries(defaults)) if (v) (modules as Record<string, boolean>)[k] = true;
    await prisma.guild.update({ where: { id: guildId }, data: { kind } });
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, modules }, update: { modules } });
    this.invalidate(guildId);
  }

  async updateSettings(guildId: string, data: Prisma.GuildSettingsUpdateInput): Promise<void> {
    await prisma.guildSettings.upsert({ where: { guildId }, create: { ...(data as Omit<Prisma.GuildSettingsUncheckedCreateInput, 'guildId'>), guildId }, update: data });
    this.invalidate(guildId);
  }

  async setLogChannel(guildId: string, category: LogChannel['category'], channelId: string | null): Promise<void> {
    if (!channelId) await prisma.logChannel.deleteMany({ where: { guildId, category } });
    else
      await prisma.logChannel.upsert({
        where: { guildId_category: { guildId, category } },
        create: { guildId, category, channelId },
        update: { channelId, enabled: true },
      });
    this.invalidate(guildId);
  }
}

export const guildConfigService = new GuildConfigService();
