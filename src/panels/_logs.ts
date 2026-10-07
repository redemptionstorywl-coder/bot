import { ButtonStyle, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder, type Guild, type TextChannel } from 'discord.js';
import { LogCategory } from '@prisma/client';
import { buildCustomId } from '../utils/customId';
import { privateChannelOverwrites } from '../utils/permissions';
import { embedService } from '../services/EmbedService';
import { guildConfigService, type ResolvedGuildConfig } from '../services/GuildConfigService';
import { logHubService } from '../services/LogHubService';
import type { Translator } from '../services/TranslationService';
import { btn, existingChannels, fieldLines, moduleBtn, moduleWarning, option, row, withNotice, type PanelNotice, type PanelPayload } from './_coreKit';

/**
 * Panneau `/config logs` (namespace `cfg-logs`, admin) :
 *  - menus   : `cfg-logs:pick` (catégorie) · `cfg-logs:set:<CAT>` (salon de la catégorie) · `cfg-logs:allset` (salon unique)
 *  - boutons : `cfg-logs:off:<CAT>` · `cfg-logs:view:<main|all>` · `cfg-logs:alloff` · `cfg-logs:create` · `cfg-logs:module`
 */

export const CFG_LOGS = 'cfg-logs';
export const lid = (...parts: string[]): string => buildCustomId(CFG_LOGS, ...parts);

export const LOG_CATEGORIES = Object.values(LogCategory) as LogCategory[];
/** « Tout dans un salon » / salon privé : toutes les catégories sauf Jeu (kills, connexions… : volume trop élevé, salon dédié). */
export const ALL_IN_ONE_CATEGORIES = LOG_CATEGORIES.filter((c) => c !== LogCategory.GAME);
export const isLogCategory = (v: string | undefined): v is LogCategory => LOG_CATEGORIES.includes(v as LogCategory);
export type LogsView = 'main' | 'all';

const LOG_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export const categoryLabel = (c: LogCategory, t: Translator): string => t(`panels_core.log_categories.${c}`);

function channelName(guild: Guild, id: string): string {
  const cache = (guild as Partial<Guild>).channels?.cache;
  return cache?.get(id)?.name ?? id;
}

export interface LogsRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  view?: LogsView;
  /** Catégorie sélectionnée (vue principale) : affiche son menu salon */
  picked?: LogCategory;
  notice?: PanelNotice;
  /** Serveur de logs central : lien de ce serveur (source) ou nombre de sources (hub) */
  hub?: LogsHubInfo;
  /** Demande de confirmation « Délier du hub » */
  confirmUnlink?: boolean;
}

export interface LogsHubInfo {
  /** Ce serveur est une source reliée à un hub */
  linkedTo: { hubGuildId: string; name: string; keepLocal: boolean } | null;
  /** Ce serveur est un hub : nombre de sources */
  hubSources: number | null;
}

/** Lien hub de ce serveur (pour le panneau). */
export async function loadHubInfo(guild: Guild): Promise<LogsHubInfo> {
  const link = await logHubService.getSourceLink(guild.id).catch(() => null);
  const hub = await logHubService.getHub(guild.id).catch(() => null);
  return {
    linkedTo: link ? { hubGuildId: link.hubGuildId, name: guild.client.guilds.cache.get(link.hubGuildId)?.name ?? link.hubGuildId, keepLocal: link.keepLocal } : null,
    hubSources: hub ? (await logHubService.listSources(guild.id).catch(() => [])).length : null,
  };
}

export function renderLogs(opts: LogsRenderOptions): PanelPayload {
  return opts.view === 'all' ? renderAll(opts) : renderMain(opts);
}

function renderMain({ guild, config, t, picked, notice, hub, confirmUnlink }: LogsRenderOptions): PanelPayload {
  const enabled = config.modules.logs;
  const system = config.logChannels.SYSTEM;
  const lines = LOG_CATEGORIES.map((c) => {
    const ch = config.logChannels[c];
    const target = ch ? `<#${ch}>` : system ? t('panels_core.logs.via_system') : t('panels_core.common.none_set');
    return `${c === picked ? '▶️ ' : ''}${categoryLabel(c, t)} → ${target}`;
  });

  const embed = embedService
    .brand(t('panels_core.logs.title', { server: guild.name }))
    .setDescription(withNotice(notice, moduleWarning('logs', enabled, t), t('panels_core.logs.hint')))
    .addFields({ name: t('panels_core.logs.field_channels', { count: Object.keys(config.logChannels).length, total: LOG_CATEGORIES.length }), value: fieldLines(lines, '—') });
  if (hub?.linkedTo) embed.addFields({ name: t('panels_core.logs.hub_title'), value: t('panels_core.logs.hub_linked', { hub: hub.linkedTo.name, local: t(hub.linkedTo.keepLocal ? 'core.yes' : 'core.no') }) });
  else if (hub?.hubSources !== null && hub?.hubSources !== undefined) embed.addFields({ name: t('panels_core.logs.hub_title'), value: t('panels_core.logs.hub_is_hub', { count: hub.hubSources }) });

  const pick = new StringSelectMenuBuilder()
    .setCustomId(lid('pick'))
    .setPlaceholder(t('panels_core.logs.pick_placeholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      LOG_CATEGORIES.slice(0, 25).map((c) => {
        const ch = config.logChannels[c];
        return option(categoryLabel(c, t), c, { description: ch ? t('panels_core.logs.option_current', { channel: channelName(guild, ch) }) : t('panels_core.logs.option_none'), default: c === picked });
      }),
    );

  const components = [row(pick)];
  if (picked) {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(lid('set', picked))
      .setPlaceholder(t('panels_core.logs.channel_placeholder', { category: categoryLabel(picked, t) }).slice(0, 150))
      .addChannelTypes(...LOG_CHANNEL_TYPES)
      .setMinValues(1)
      .setMaxValues(1);
    const current = existingChannels(guild, config.logChannels[picked] ? [config.logChannels[picked]!] : [], 1, LOG_CHANNEL_TYPES);
    if (current.length) select.setDefaultChannels(current);
    components.push(row(select));
  }
  const buttons = [
    btn(lid('view', 'all'), t('panels_core.logs.btn_all'), ButtonStyle.Primary, '📦'),
    btn(lid('create'), t('panels_core.logs.btn_create'), ButtonStyle.Success, '➕'),
    moduleBtn(lid('module'), enabled, t),
  ];
  if (picked) buttons.unshift(btn(lid('off', picked), t('panels_core.logs.btn_disable'), ButtonStyle.Danger, '🚫', !config.logChannels[picked]));
  components.push(row(...buttons));
  if (hub?.linkedTo) {
    components.push(
      row(
        btn(lid('hubkeep'), t(hub.linkedTo.keepLocal ? 'panels_core.logs.btn_hub_local_off' : 'panels_core.logs.btn_hub_local_on'), ButtonStyle.Secondary, '📥'),
        confirmUnlink ? btn(lid('hubunlinkok'), t('panels_core.logs.btn_hub_unlink_confirm'), ButtonStyle.Danger, '⚠️') : btn(lid('hubunlink'), t('panels_core.logs.btn_hub_unlink'), ButtonStyle.Danger, '🔗'),
      ),
    );
  }
  return { embeds: [embed], components };
}

function renderAll({ guild, config, t, notice }: LogsRenderOptions): PanelPayload {
  const embed = embedService
    .brand(t('panels_core.logs.all_title'))
    .setDescription(withNotice(notice, t('panels_core.logs.all_hint', { count: ALL_IN_ONE_CATEGORIES.length })));
  const channels = [...new Set(Object.values(config.logChannels).filter((c): c is string => Boolean(c)))];
  const select = new ChannelSelectMenuBuilder().setCustomId(lid('allset')).setPlaceholder(t('panels_core.logs.all_placeholder')).addChannelTypes(...LOG_CHANNEL_TYPES).setMinValues(1).setMaxValues(1);
  const single = channels.length === 1 && ALL_IN_ONE_CATEGORIES.every((c) => config.logChannels[c]) ? existingChannels(guild, channels, 1, LOG_CHANNEL_TYPES) : [];
  if (single.length) select.setDefaultChannels(single);
  return {
    embeds: [embed],
    components: [
      row(select),
      row(btn(lid('alloff'), t('panels_core.logs.btn_all_off'), ButtonStyle.Danger, '🚫', !channels.length), btn(lid('view', 'main'), t('core.back'), ButtonStyle.Secondary, '↩️')),
    ],
  };
}

// ───── Actions ─────

/** Assigne un salon à toutes les catégories sauf Jeu, ou retire (`null`) tous les salons (Jeu compris). */
export async function setAllLogChannels(guildId: string, channelId: string | null): Promise<void> {
  for (const category of channelId ? ALL_IN_ONE_CATEGORIES : LOG_CATEGORIES) await guildConfigService.setLogChannel(guildId, category, channelId);
}

/** Permissions du salon de logs privé : invisible pour @everyone, lisible par les rôles admin / staff / équipe, écrit par le bot. */
export const privateLogOverwrites = privateChannelOverwrites;

/** Crée le salon `📜・logs` privé et y envoie toutes les catégories. */
export async function createPrivateLogChannel(guild: Guild, config: ResolvedGuildConfig, t: Translator): Promise<TextChannel> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const channel = await guild.channels.create({
    name: t('panels_core.logs.channel_name'),
    type: ChannelType.GuildText,
    topic: t('panels_core.logs.channel_topic'),
    permissionOverwrites: privateLogOverwrites(guild, config, me.id),
    reason: t('panels_core.logs.channel_topic'),
  });
  await setAllLogChannels(guild.id, channel.id);
  return channel;
}
