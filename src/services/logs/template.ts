import type { APIEmbed } from 'discord.js';
import type { GuildKind } from '@prisma/client';
import { BRAND, DEFAULT_MODULES_BY_KIND, type ModuleKey } from '../../config/constants';
import type { Translator } from '../TranslationService';
import { GLOBAL_SOURCE_KEY, gameSourceKey, type AnyRouteKey, type CategoryRouteKey, type GameRouteKey, type GlobalRouteKey, type SourceRouteKey } from './routes';
import type { RouteTable } from './delivery';

/**
 * Structure du serveur de logs central créée par `/template logs` (fonctions pures, testées dans tests/logs/template.test.ts).
 *
 *  🌐 GÉNÉRAL                       📌・sommaire · 🔨・sanctions-globales · 🚨・alertes-sécurité · 🤖・bot-système
 *  <emoji> <SOURCE> · MODÉRATION    sanctions · clear-salons · sécurité · sync-fivem
 *  <emoji> <SOURCE> · MESSAGES & MEMBRES   messages-supprimés · messages-modifiés · suppressions-en-masse · arrivées · départs
 *                                   · pseudos · rôles-membres · invitations · vocal
 *  <emoji> <SOURCE> · SERVEUR & ACTIVITÉ   salons · rôles · paramètres · tickets · whitelist · annonces · événements · boutique
 *                                   · battle-royale · school-rp · config-bot
 *  🎮 JEU · <serveur de jeu>        connexions · comptes-pseudos · kills · parties · sanctions-jeu · actions-admin · chat-jeu
 *                                   · anticheat · serveur-jeu
 *
 * Salons de modules inutiles pour une source omis : un salon « module » n'est créé que si l'un de ses modules est actif sur
 * la source ou recommandé pour son type de serveur (DEFAULT_MODULES_BY_KIND) ; `sync-fivem` aussi si la source a un serveur FiveM.
 * Les logs d'un salon omis retombent sur la route de leur catégorie, puis sur `config-bot` (voir delivery.ts).
 * Idempotence : un salon déjà enregistré (LogRoute) et encore présent est réutilisé ; manquant → recréé ; jamais de doublon.
 */

export const DISCORD_MAX_GUILD_CHANNELS = 500;
export const DISCORD_MAX_CATEGORY_CHILDREN = 50;

interface LayoutChannel<R extends AnyRouteKey> {
  route: R;
  /** Modules dont l'un au moins doit être pertinent pour la source */
  modules?: ModuleKey[];
}

interface LayoutCategory<R extends AnyRouteKey> {
  category: CategoryRouteKey;
  channels: LayoutChannel<R>[];
}

export const GLOBAL_LAYOUT: LayoutCategory<GlobalRouteKey> = {
  category: 'category.general',
  channels: [{ route: 'global.summary' }, { route: 'global.sanctions' }, { route: 'global.security' }, { route: 'global.system' }],
};

export const SOURCE_LAYOUT: LayoutCategory<SourceRouteKey>[] = [
  {
    category: 'category.moderation',
    channels: [{ route: 'mod.sanctions' }, { route: 'mod.clear' }, { route: 'security.alerts' }, { route: 'fivem.sync', modules: ['fivem'] }],
  },
  {
    category: 'category.activity',
    channels: [
      { route: 'message.deleted' },
      { route: 'message.edited' },
      { route: 'message.bulk' },
      { route: 'member.join' },
      { route: 'member.leave' },
      { route: 'member.nickname' },
      { route: 'member.roles' },
      { route: 'member.invites' },
      { route: 'voice' },
    ],
  },
  {
    category: 'category.server',
    channels: [
      { route: 'server.channels' },
      { route: 'server.roles' },
      { route: 'server.settings' },
      { route: 'tickets', modules: ['tickets'] },
      { route: 'whitelist', modules: ['whitelist'] },
      { route: 'announcements', modules: ['announcements', 'embeds'] },
      { route: 'events', modules: ['events', 'giveaways', 'polls'] },
      { route: 'shop', modules: ['shop'] },
      { route: 'battleroyale', modules: ['battleRoyale'] },
      { route: 'school', modules: ['school'] },
      { route: 'bot.config' },
    ],
  },
];

export const GAME_LAYOUT: LayoutCategory<GameRouteKey> = {
  category: 'category.game',
  channels: [
    { route: 'game.connections' },
    { route: 'game.accounts' },
    { route: 'game.kills' },
    { route: 'game.matches' },
    { route: 'game.sanctions' },
    { route: 'game.admin' },
    { route: 'game.chat' },
    { route: 'game.anticheat' },
    { route: 'game.server' },
  ],
};

export interface TemplateSourceInput {
  guildId: string;
  /** Nom de section (LogHubSource.label) */
  label: string;
  emoji: string;
  kind: GuildKind;
  modules: Partial<Record<ModuleKey, boolean>>;
  /** Au moins un serveur FiveM déclaré sur la source */
  hasFiveM: boolean;
}

export interface TemplateGameInput {
  serverId: number;
  name: string;
  chat: boolean;
}

export interface HubChannelInfo {
  type: 'category' | 'text' | 'other';
  parentId: string | null;
}

export interface TemplatePlanInput {
  sources: TemplateSourceInput[];
  games: TemplateGameInput[];
  /** Routes déjà enregistrées pour ce hub */
  routes: RouteTable;
  /** Salons actuels du hub */
  channels: ReadonlyMap<string, HubChannelInfo>;
  /** Traducteur de la langue du hub (noms des salons) */
  t: Translator;
}

export type PlanStatus = 'reuse' | 'create' | 'skip';

export interface PlanItem {
  sourceKey: string;
  route: AnyRouteKey;
  kind: 'category' | 'text';
  name: string;
  topic?: string;
  /** Catégorie parente (même sourceKey) */
  parent?: CategoryRouteKey;
  existingId: string | null;
  status: PlanStatus;
  reason?: 'category_full';
}

export interface TemplatePlan {
  items: PlanItem[];
  toCreate: number;
  reused: number;
  skipped: number;
  /** Total de salons du hub après création */
  channelsAfter: number;
  /** Limite de 500 salons dépassée : rien n'est créé */
  guildLimitExceeded: boolean;
}

/** Module pertinent pour une source : actif, ou recommandé pour son type de serveur. */
export function moduleRelevant(source: Pick<TemplateSourceInput, 'kind' | 'modules'>, module: ModuleKey): boolean {
  return source.modules[module] === true || DEFAULT_MODULES_BY_KIND[source.kind]?.[module] === true;
}

/** Salon de la structure à créer pour cette source ? */
export function channelWanted(source: TemplateSourceInput, channel: LayoutChannel<SourceRouteKey>): boolean {
  if (!channel.modules?.length) return true;
  if (channel.route === 'fivem.sync' && source.hasFiveM) return true;
  return channel.modules.some((m) => moduleRelevant(source, m));
}

const upper = (s: string): string => s.toLocaleUpperCase('fr-FR');
const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Nom d'une catégorie du hub (100 caractères max). */
export function categoryName(t: Translator, category: CategoryRouteKey, section: { emoji?: string; label: string } | null): string {
  if (category === 'category.general') return cut(t('loghub.layout.general'), 100);
  if (category === 'category.game') return cut(`🎮 ${t('loghub.layout.game')} · ${section?.label ?? ''}`, 100);
  const part = t(`loghub.layout.${category === 'category.moderation' ? 'moderation' : category === 'category.activity' ? 'activity' : 'server'}`);
  const suffix = ` · ${part}`;
  const head = `${section?.emoji ? `${section.emoji} ` : ''}${upper(section?.label ?? '')}`;
  return `${cut(head, 100 - suffix.length)}${suffix}`;
}

/** Nom d'un salon du hub (minuscules, emoji en préfixe : `🔨・sanctions`). */
export const channelName = (t: Translator, route: SourceRouteKey | GameRouteKey | GlobalRouteKey): string => cut(t(`loghub.channels.${route}`), 100);

const channelTopic = (t: Translator, route: SourceRouteKey | GameRouteKey | GlobalRouteKey, section: string): string => cut(t('loghub.topic', { section, content: t(`loghub.routes.${route}`) }), 1024);

/** Plan de création / réutilisation des salons du hub. */
export function planTemplate(input: TemplatePlanInput): TemplatePlan {
  const { t } = input;
  const items: PlanItem[] = [];
  const existing = (sourceKey: string, route: AnyRouteKey, kind: 'category' | 'text'): string | null => {
    const id = input.routes[sourceKey]?.[route];
    const info = id ? input.channels.get(id) : undefined;
    return id && info && info.type === kind ? id : null;
  };
  const add = (sourceKey: string, layout: LayoutCategory<AnyRouteKey>, section: { emoji?: string; label: string } | null, wanted: (c: LayoutChannel<AnyRouteKey>) => boolean, sectionLabel: string) => {
    const catId = existing(sourceKey, layout.category, 'category');
    items.push({ sourceKey, route: layout.category, kind: 'category', name: categoryName(t, layout.category, section), existingId: catId, status: catId ? 'reuse' : 'create' });
    for (const c of layout.channels) {
      if (!wanted(c)) continue;
      const route = c.route as SourceRouteKey | GameRouteKey | GlobalRouteKey;
      const id = existing(sourceKey, route, 'text');
      items.push({ sourceKey, route, kind: 'text', name: channelName(t, route), topic: channelTopic(t, route, sectionLabel), parent: layout.category, existingId: id, status: id ? 'reuse' : 'create' });
    }
  };

  add(GLOBAL_SOURCE_KEY, GLOBAL_LAYOUT, null, () => true, t('loghub.layout.general'));
  for (const source of input.sources) {
    for (const layout of SOURCE_LAYOUT) add(source.guildId, layout, { emoji: source.emoji, label: source.label }, (c) => channelWanted(source, c as LayoutChannel<SourceRouteKey>), `${source.emoji} ${source.label}`);
  }
  for (const game of input.games) add(gameSourceKey(game.serverId), GAME_LAYOUT, { label: game.name }, (c) => c.route !== 'game.chat' || game.chat, `🎮 ${game.name}`);

  // Limite de 50 salons par catégorie : salons existants de la catégorie + nouveaux salons prévus
  for (const cat of items.filter((i) => i.kind === 'category')) {
    let used = cat.existingId ? [...input.channels.values()].filter((c) => c.parentId === cat.existingId).length : 0;
    for (const child of items.filter((i) => i.kind === 'text' && i.sourceKey === cat.sourceKey && i.parent === cat.route && i.status === 'create')) {
      if (used >= DISCORD_MAX_CATEGORY_CHILDREN) {
        child.status = 'skip';
        child.reason = 'category_full';
      } else used++;
    }
  }

  const toCreate = items.filter((i) => i.status === 'create').length;
  const channelsAfter = input.channels.size + toCreate;
  return {
    items,
    toCreate,
    reused: items.filter((i) => i.status === 'reuse').length,
    skipped: items.filter((i) => i.status === 'skip').length,
    channelsAfter,
    guildLimitExceeded: channelsAfter > DISCORD_MAX_GUILD_CHANNELS,
  };
}

// ───────────── Sommaire épinglé ─────────────

export interface SummaryInput {
  t: Translator;
  sources: { label: string; emoji: string; guildName: string; keepLocal: boolean }[];
  games: { name: string; sourceName: string; chat: boolean }[];
  routes: RouteTable;
  color?: number;
}

const mention = (id: string | undefined): string => (id ? `<#${id}>` : '—');

/** Embed du salon « 📌・sommaire » : une section par serveur, ce qu'elle reçoit et où. */
export function buildSummaryEmbed(input: SummaryInput): APIEmbed {
  const { t, routes } = input;
  const g = routes[GLOBAL_SOURCE_KEY] ?? {};
  const fields: { name: string; value: string; inline?: boolean }[] = [
    {
      name: cut(t('loghub.layout.general'), 256),
      value: cut(
        t('loghub.summary.general', { sanctions: mention(g['global.sanctions']), security: mention(g['global.security']), system: mention(g['global.system']) }),
        1024,
      ),
    },
  ];
  for (const s of input.sources) {
    fields.push({
      name: cut(`${s.emoji} ${upper(s.label)}`, 256),
      value: cut(t('loghub.summary.source', { server: s.guildName, local: t(s.keepLocal ? 'loghub.summary.local_on' : 'loghub.summary.local_off') }), 1024),
    });
  }
  for (const game of input.games) {
    fields.push({ name: cut(`🎮 ${t('loghub.layout.game')} · ${game.name}`, 256), value: cut(t('loghub.summary.game', { server: game.sourceName, chat: t(game.chat ? 'loghub.summary.chat_on' : 'loghub.summary.chat_off') }), 1024) });
  }
  return {
    color: input.color ?? BRAND.colors.primary,
    title: t('loghub.summary.title'),
    description: cut(t('loghub.summary.description'), 4096),
    fields: fields.slice(0, 25),
    footer: { text: t('loghub.summary.footer') },
    timestamp: new Date().toISOString(),
  };
}
