import { ChannelType, type Client, type Guild, type GuildBasedChannel, type OverwriteResolvable, type TextChannel } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { prisma } from '../database/client';
import { guildConfigService } from './GuildConfigService';
import { logHubService, LogHubError } from './LogHubService';
import { translationService, type Translator } from './TranslationService';
import { privateChannelOverwrites } from '../utils/permissions';
import { buildSummaryEmbed, planTemplate, type HubChannelInfo, type PlanItem, type TemplatePlan, type TemplateGameInput, type TemplateSourceInput } from './logs/template';
import { GLOBAL_SOURCE_KEY } from './logs/routes';
import { childLogger } from '../utils/logger';

const log = childLogger('LogTemplate');

/** Pause entre deux créations de salon (Discord limite fortement la création de salons). */
export const CREATE_PACING_MS = 400;

export interface TemplateProgress {
  done: number;
  total: number;
  current: string;
}

export interface TemplateResult {
  ok: boolean;
  error?: 'guild_limit' | 'running' | 'no_hub' | 'missing_permissions';
  plan: TemplatePlan;
  created: number;
  reused: number;
  skipped: number;
  failed: { name: string; error: string }[];
  summaryChannelId: string | null;
}

/** État lisible du hub pour l'aperçu (`/template logs`, dashboard). */
export interface HubState {
  hubGuildId: string;
  exists: boolean;
  sources: TemplateSourceInput[];
  games: (TemplateGameInput & { sourceGuildId: string })[];
  plan: TemplatePlan;
}

/**
 * Applique la structure du serveur de logs central (`/template logs`, bouton « Réparer » du dashboard) :
 * crée les catégories / salons manquants (privés : @everyone sans accès, le bot garde l'accès), enregistre les routes,
 * publie et épingle le sommaire. Une seule exécution à la fois par hub.
 */
export class LogTemplateService {
  private readonly running = new Set<string>();

  isRunning(hubGuildId: string): boolean {
    return this.running.has(hubGuildId);
  }

  /** Sources et jeux du hub, avec ce qu'il faut pour planifier. */
  async loadInputs(hubGuildId: string): Promise<{ sources: TemplateSourceInput[]; games: (TemplateGameInput & { sourceGuildId: string })[] }> {
    const links = await logHubService.listSources(hubGuildId);
    const sources: TemplateSourceInput[] = [];
    for (const l of links) {
      const cfg = await guildConfigService.get(l.sourceGuildId);
      const fivem = await prisma.fiveMServer.count({ where: { guildId: l.sourceGuildId } });
      sources.push({ guildId: l.sourceGuildId, label: l.label, emoji: l.emoji, kind: cfg?.kind ?? GuildKind.GENERIC, modules: cfg?.modules ?? {}, hasFiveM: (fivem ?? 0) > 0 });
    }
    const games = (await logHubService.listGames(hubGuildId)).filter((g) => g.server).map((g) => ({ serverId: g.fivemServerId, name: g.server!.name, chat: g.chat, sourceGuildId: g.server!.guildId }));
    return { sources, games };
  }

  /** Salons actuels du hub (type simplifié + catégorie parente). */
  hubChannels(guild: Guild): Map<string, HubChannelInfo> {
    const out = new Map<string, HubChannelInfo>();
    for (const c of guild.channels.cache.values()) {
      if (typeof c.isThread === 'function' && c.isThread()) continue; // les fils ne comptent pas dans la limite de 500 salons
      const type = c.type === ChannelType.GuildCategory ? 'category' : c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement ? 'text' : 'other';
      out.set(c.id, { type, parentId: 'parentId' in c ? (c.parentId ?? null) : null });
    }
    return out;
  }

  async translator(guildId: string): Promise<Translator> {
    const cfg = await guildConfigService.get(guildId);
    return translationService.bind(cfg?.defaultLanguage ?? 'fr', guildId);
  }

  /** Plan actuel (aperçu, salons manquants). */
  async state(guild: Guild, extra?: { sources?: TemplateSourceInput[]; games?: (TemplateGameInput & { sourceGuildId: string })[] }): Promise<HubState> {
    const hub = await logHubService.getHub(guild.id);
    const loaded = hub ? await this.loadInputs(guild.id) : { sources: [], games: [] };
    const sources = extra?.sources ?? loaded.sources;
    const games = extra?.games ?? loaded.games;
    logHubService.invalidate(guild.id);
    const plan = planTemplate({ sources, games, routes: hub ? await logHubService.getRoutes(guild.id) : {}, channels: this.hubChannels(guild), t: await this.translator(guild.id) });
    return { hubGuildId: guild.id, exists: !!hub, sources, games, plan };
  }

  /** Crée les salons manquants, enregistre les routes, met à jour le sommaire. */
  async apply(client: Client, guild: Guild, opts: { onProgress?: (p: TemplateProgress) => Promise<unknown> | void; pacingMs?: number } = {}): Promise<TemplateResult> {
    const empty: TemplatePlan = { items: [], toCreate: 0, reused: 0, skipped: 0, channelsAfter: 0, guildLimitExceeded: false };
    if (this.running.has(guild.id)) return { ok: false, error: 'running', plan: empty, created: 0, reused: 0, skipped: 0, failed: [], summaryChannelId: null };
    if (!(await logHubService.getHub(guild.id))) return { ok: false, error: 'no_hub', plan: empty, created: 0, reused: 0, skipped: 0, failed: [], summaryChannelId: null };
    this.running.add(guild.id);
    try {
      const { plan } = await this.state(guild);
      if (plan.guildLimitExceeded) return { ok: false, error: 'guild_limit', plan, created: 0, reused: plan.reused, skipped: plan.skipped, failed: [], summaryChannelId: null };
      const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      if (!me?.permissions.has(['ManageChannels', 'ManageRoles'])) return { ok: false, error: 'missing_permissions', plan, created: 0, reused: plan.reused, skipped: plan.skipped, failed: [], summaryChannelId: null };
      const hubConfig = await guildConfigService.getOrCreate(guild);
      const overwrites: OverwriteResolvable[] = privateChannelOverwrites(guild, hubConfig, me.id);
      const pacing = opts.pacingMs ?? CREATE_PACING_MS;
      const categoryIds = new Map<string, string>();
      for (const item of plan.items) if (item.kind === 'category' && item.existingId) categoryIds.set(`${item.sourceKey}|${item.route}`, item.existingId);

      const failed: { name: string; error: string }[] = [];
      let created = 0;
      let done = 0;
      const toCreate = plan.items.filter((i) => i.status === 'create');
      for (const item of toCreate) {
        await opts.onProgress?.({ done, total: toCreate.length, current: item.name });
        try {
          const channel = await this.createItem(guild, item, overwrites, item.parent ? categoryIds.get(`${item.sourceKey}|${item.parent}`) : undefined);
          if (item.kind === 'category') categoryIds.set(`${item.sourceKey}|${item.route}`, channel.id);
          await logHubService.setRoute(guild.id, item.sourceKey, item.route, channel.id);
          created++;
        } catch (err) {
          log.warn({ err, hub: guild.id, item: item.name }, 'Création de salon du hub impossible');
          failed.push({ name: item.name, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
        }
        done++;
        if (pacing > 0 && done < toCreate.length) await new Promise((r) => setTimeout(r, pacing));
      }
      await opts.onProgress?.({ done, total: toCreate.length, current: '' });
      logHubService.invalidate(guild.id);
      const summaryChannelId = await this.publishSummary(client, guild).catch((err) => {
        log.warn({ err, hub: guild.id }, 'Sommaire du hub non publié');
        return null;
      });
      return { ok: failed.length === 0, plan, created, reused: plan.reused, skipped: plan.skipped, failed, summaryChannelId };
    } finally {
      this.running.delete(guild.id);
    }
  }

  private async createItem(guild: Guild, item: PlanItem, overwrites: OverwriteResolvable[], parentId?: string): Promise<GuildBasedChannel> {
    if (item.kind === 'category') return guild.channels.create({ name: item.name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: 'Serveur de logs central (/template logs)' });
    if (item.parent && !parentId) throw new LogHubError('not_found');
    return guild.channels.create({ name: item.name, type: ChannelType.GuildText, parent: parentId, topic: item.topic, permissionOverwrites: overwrites, reason: 'Serveur de logs central (/template logs)' });
  }

  /** Publie (ou met à jour) et épingle le sommaire dans `📌・sommaire`. */
  async publishSummary(client: Client, guild: Guild): Promise<string | null> {
    const hub = await logHubService.getHub(guild.id);
    const routes = await logHubService.getRoutes(guild.id);
    const channelId = routes[GLOBAL_SOURCE_KEY]?.['global.summary'];
    if (!hub || !channelId) return null;
    const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (!channel?.isTextBased()) return null;
    const t = await this.translator(guild.id);
    const links = await logHubService.listSources(guild.id);
    const games = await logHubService.listGames(guild.id);
    const embed = buildSummaryEmbed({
      t,
      routes,
      sources: links.map((l) => ({ label: l.label, emoji: l.emoji, guildName: client.guilds.cache.get(l.sourceGuildId)?.name ?? l.sourceGuildId, keepLocal: l.keepLocal })),
      games: games.filter((g) => g.server).map((g) => ({ name: g.server!.name, sourceName: client.guilds.cache.get(g.server!.guildId)?.name ?? g.server!.guildId, chat: g.chat })),
      color: (await guildConfigService.get(guild.id))?.brandColor,
    });
    if (hub.summaryMessageId) {
      const existing = await channel.messages.fetch(hub.summaryMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed] });
        if (!existing.pinned) await existing.pin().catch(() => null);
        return channelId;
      }
    }
    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await message.pin().catch(() => null);
    await logHubService.setSummaryMessage(guild.id, message.id);
    return channelId;
  }
}

export const logTemplateService = new LogTemplateService();
