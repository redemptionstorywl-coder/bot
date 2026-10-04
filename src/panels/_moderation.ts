import { ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputStyle, UserSelectMenuBuilder, type Guild } from 'discord.js';
import type { ModuleKey } from '../config/constants';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp, formatDuration, parseDuration } from '../utils/time';
import { embedService } from '../services/EmbedService';
import { guildConfigService } from '../services/GuildConfigService';
import { honeypotService } from '../services/HoneypotService';
import {
  ANTI_NUKE_ACTIONS,
  ANTI_NUKE_PUNISHMENTS,
  moderationService,
  type AntiNukeConfig,
  type AntiRaidConfig,
  type AntiRaidConfigInput,
  type ResolvedModerationConfig,
  type WarnThreshold,
} from '../services/ModerationService';
import type { Translator } from '../services/TranslationService';
import {
  btn,
  channelList,
  existingChannels,
  existingRoles,
  fieldLines,
  labelled,
  modal,
  moduleBtn,
  moduleWarning,
  option,
  roleList,
  row,
  stateLabel,
  textInput,
  toggleBtn,
  truncate,
  userList,
  withNotice,
  type PanelNotice,
  type PanelPayload,
  type Row,
} from './_coreKit';

/**
 * Panneau `/config moderation` (namespace `cfg-mod`, admin), 5 onglets : Sanctions · Anti-raid · Anti-nuke · Lockdown · Piège.
 *  - boutons : `cfg-mod:tab:<tab>` · `cfg-mod:module:<tab>` · `cfg-mod:thadd` (modal) · `cfg-mod:threset` · `cfg-mod:dm`
 *              `cfg-mod:arset` (modal) · `cfg-mod:ardom` (modal) · `cfg-mod:nk:<option>` · `cfg-mod:nkth` (modal)
 *              `cfg-mod:lock:<on|off>` (confirmation) · `cfg-mod:lockok:<on|off>`
 *              `cfg-mod:hpcreate` · `cfg-mod:hptoggle` · `cfg-mod:hpwin` (modal) · `cfg-mod:hpremove` (confirmation) · `cfg-mod:hpremoveok`
 *  - menus   : `cfg-mod:muterole` · `cfg-mod:thdel` · `cfg-mod:arprot` · `cfg-mod:arroles` · `cfg-mod:archans` · `cfg-mod:nkpun` · `cfg-mod:nkwl` · `cfg-mod:hpchan`
 *  - modals  : `cfg-mod:thadd` · `cfg-mod:arset` · `cfg-mod:ardom` · `cfg-mod:nkth` · `cfg-mod:hpwin`
 * Les fonctions `parse*` sont pures (testées) ; le rendu relit la config en base après chaque action.
 */

export const CFG_MOD = 'cfg-mod';
export const mid = (...parts: string[]): string => buildCustomId(CFG_MOD, ...parts);

export type ModTab = 'sanctions' | 'antiraid' | 'antinuke' | 'lockdown' | 'honeypot';
export const MOD_TABS: readonly ModTab[] = ['sanctions', 'antiraid', 'antinuke', 'lockdown', 'honeypot'];
export const isModTab = (v: string | undefined): v is ModTab => MOD_TABS.includes(v as ModTab);
/** Module du serveur lié à chaque onglet (l'anti-nuke dépend du module anti-raid ; le salon piège n'a pas de module). */
export const TAB_MODULE: Record<ModTab, ModuleKey | null> = { sanctions: 'moderation', antiraid: 'antiraid', antinuke: 'antiraid', lockdown: 'moderation', honeypot: null };
const TAB_EMOJI: Record<ModTab, string> = { sanctions: '⚖️', antiraid: '🚨', antinuke: '🛑', lockdown: '🔒', honeypot: '🍯' };

export const MAX_THRESHOLDS = 25;
export const WARN_ACTIONS = ['TIMEOUT', 'KICK', 'BAN', 'TEMPBAN'] as const;
export type WarnAction = (typeof WARN_ACTIONS)[number];
export const MAX_TIMEOUT_SECONDS = 28 * 86400;
/** Fenêtre de suppression des messages récents de l'auteur pris au piège (minutes). */
export const HONEYPOT_WINDOW = { min: 5, max: 1440 } as const;
const MAX_TEMPBAN_SECONDS = 365 * 86400;
const DEFAULT_ACTION_DURATION: Partial<Record<WarnAction, number>> = { TIMEOUT: 3600, TEMPBAN: 86400 };

/** Protections cochables dans le menu « protections actives ». */
export const PROTECTIONS = ['spam', 'mentions', 'invites', 'links', 'new_account', 'bots', 'mass_join', 'raid_lockdown'] as const;
export type Protection = (typeof PROTECTIONS)[number];

/** Options bascule de l'anti-nuke : segment de customId → champ de la config. */
export const NUKE_TOGGLES = {
  enabled: 'enabled',
  botadd: 'botAddProtection',
  lockdown: 'lockdownOnTrigger',
  restore: 'restoreBans',
  team: 'exemptTeamRoles',
  dm: 'dmExecutor',
} as const satisfies Record<string, keyof AntiNukeConfig>;
export type NukeToggle = keyof typeof NUKE_TOGGLES;
export const isNukeToggle = (v: string | undefined): v is NukeToggle => v !== undefined && v in NUKE_TOGGLES;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; field?: string; error: string };

// ─────────────────────────── Parsing (pur) ───────────────────────────

const normalize = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const ACTION_ALIASES: Record<string, WarnAction> = {
  timeout: 'TIMEOUT',
  to: 'TIMEOUT',
  mute: 'TIMEOUT',
  exclusion: 'TIMEOUT',
  exclure: 'TIMEOUT',
  kick: 'KICK',
  expulsion: 'KICK',
  expulser: 'KICK',
  ban: 'BAN',
  bannir: 'BAN',
  bannissement: 'BAN',
  tempban: 'TEMPBAN',
  bantemp: 'TEMPBAN',
  bantemporaire: 'TEMPBAN',
};

export function parseWarnAction(raw: string | undefined): WarnAction | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if ((WARN_ACTIONS as readonly string[]).includes(upper)) return upper as WarnAction;
  return ACTION_ALIASES[normalize(raw)] ?? null;
}

/** Seuil d'avertissements saisi dans le modal : nombre (1–100), action, durée (timeout ≤ 28 j, tempban ≤ 365 j). */
export function parseWarnThreshold(input: { count?: string; action?: string; duration?: string }): ParseResult<WarnThreshold> {
  const countRaw = (input.count ?? '').trim();
  if (!/^\d{1,3}$/.test(countRaw) || Number(countRaw) < 1 || Number(countRaw) > 100) return { ok: false, field: 'count', error: countRaw || '—' };
  const action = parseWarnAction(input.action);
  if (!action) return { ok: false, field: 'action', error: (input.action ?? '').trim() || '—' };
  const durationRaw = (input.duration ?? '').trim();
  let duration: number | undefined;
  if (action === 'TIMEOUT' || action === 'TEMPBAN') {
    if (durationRaw) {
      const sec = parseDuration(durationRaw);
      const max = action === 'TIMEOUT' ? MAX_TIMEOUT_SECONDS : MAX_TEMPBAN_SECONDS;
      if (!sec || sec < 60 || sec > max) return { ok: false, field: 'duration', error: durationRaw };
      duration = sec;
    } else duration = DEFAULT_ACTION_DURATION[action];
  }
  return { ok: true, value: { count: Number(countRaw), action, ...(duration ? { duration } : {}) } };
}

/** Ajoute (ou remplace, même nombre) un seuil ; liste triée, 25 seuils max. */
export function addThreshold(list: readonly WarnThreshold[], threshold: WarnThreshold): ParseResult<WarnThreshold[]> {
  const next = [...list.filter((th) => th.count !== threshold.count), threshold].sort((a, b) => a.count - b.count);
  if (next.length > MAX_THRESHOLDS) return { ok: false, error: String(MAX_THRESHOLDS) };
  return { ok: true, value: next };
}

/** « 6/5 », « 6 / 5 », « 6 5s » → [6, 5] ; null si invalide. */
export function parsePair(raw: string): [number, number] | null {
  const m = raw.trim().match(/^(\d{1,4})\s*(?:[/,;:|x]|\s)\s*(\d{1,4})\s*s?$/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

/**
 * Réglages anti-raid du modal (champ vide = inchangé) :
 * spam « messages/secondes » (2–50 / 1–120), mentions max (2–100), âge minimum en jours (1–365),
 * raid « arrivées/secondes » (2–500 / 1–600), durée des timeouts (1 min – 28 j, spam + mentions + liens).
 */
export function parseAntiRaidSettings(input: { spam?: string; mentions?: string; age?: string; joins?: string; timeout?: string }, cfg: AntiRaidConfig): ParseResult<Partial<AntiRaidConfigInput>> {
  const patch: Partial<AntiRaidConfigInput> = {};
  const spam = input.spam?.trim();
  if (spam) {
    const pair = parsePair(spam);
    if (!pair || !inRange(pair[0], 2, 50) || !inRange(pair[1], 1, 120)) return { ok: false, field: 'spam', error: spam };
    patch.antiSpam = { ...cfg.antiSpam, maxMessages: pair[0], intervalSeconds: pair[1] };
  }
  const mentions = input.mentions?.trim();
  if (mentions) {
    if (!/^\d{1,3}$/.test(mentions) || !inRange(Number(mentions), 2, 100)) return { ok: false, field: 'mentions', error: mentions };
    patch.antiMassMention = { ...cfg.antiMassMention, maxMentions: Number(mentions) };
  }
  const age = input.age?.trim();
  if (age) {
    const m = age.match(/^(\d{1,3})\s*[dj]?$/i);
    if (!m || !inRange(Number(m[1]), 1, 365)) return { ok: false, field: 'age', error: age };
    patch.antiNewAccount = { ...cfg.antiNewAccount, minAgeDays: Number(m[1]) };
  }
  const joins = input.joins?.trim();
  if (joins) {
    const pair = parsePair(joins);
    if (!pair || !inRange(pair[0], 2, 500) || !inRange(pair[1], 1, 600)) return { ok: false, field: 'joins', error: joins };
    patch.antiMassJoin = { ...cfg.antiMassJoin, maxJoins: pair[0], intervalSeconds: pair[1] };
  }
  const timeout = input.timeout?.trim();
  if (timeout) {
    const sec = parseDuration(timeout);
    if (!sec || sec < 60 || sec > MAX_TIMEOUT_SECONDS) return { ok: false, field: 'timeout', error: timeout };
    patch.antiSpam = { ...cfg.antiSpam, ...patch.antiSpam, timeoutSeconds: sec };
    patch.antiMassMention = { ...cfg.antiMassMention, ...patch.antiMassMention, timeoutSeconds: sec };
    patch.antiLink = { ...cfg.antiLink, timeoutSeconds: sec };
  }
  return { ok: true, value: patch };
}

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Domaines autorisés (un par ligne, ou séparés par virgules / espaces) ; vide = aucun. 100 max. */
export function parseDomains(raw: string | undefined): ParseResult<string[]> {
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[\s,;]+/)) {
    if (!part) continue;
    const domain = part
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/^www\./, '');
    if (!DOMAIN_RE.test(domain) || domain.length > 253) return { ok: false, error: part.slice(0, 100) };
    if (!out.includes(domain)) out.push(domain);
  }
  if (out.length > 100) return { ok: false, error: `> 100` };
  return { ok: true, value: out };
}

export function serializeNukeThresholds(thresholds: AntiNukeConfig['thresholds']): string {
  return ANTI_NUKE_ACTIONS.map((a) => `${a} | ${thresholds[a].max} | ${thresholds[a].intervalSeconds}`).join('\n');
}

/** Lignes « action | max | secondes » (max 1–100, fenêtre 1–600 s) ; les actions absentes gardent leur seuil. */
export function parseNukeThresholds(raw: string | undefined, current: AntiNukeConfig['thresholds']): ParseResult<AntiNukeConfig['thresholds']> {
  const next = Object.fromEntries(ANTI_NUKE_ACTIONS.map((a) => [a, { ...current[a] }])) as AntiNukeConfig['thresholds'];
  for (const line of (raw ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = (trimmed.includes('|') || trimmed.includes(';') || trimmed.includes(',') ? trimmed.split(/[|;,]/) : trimmed.split(/\s+/)).map((p) => p.trim());
    const [name = '', maxRaw = '', secondsRaw = ''] = parts;
    const action = ANTI_NUKE_ACTIONS.find((a) => a.toLowerCase() === name.toLowerCase());
    const max = Number(maxRaw);
    const seconds = Number(secondsRaw.replace(/s$/i, ''));
    if (parts.length !== 3 || !action || !/^\d+$/.test(maxRaw) || !inRange(max, 1, 100) || !/^\d+s?$/i.test(secondsRaw) || !inRange(seconds, 1, 600)) return { ok: false, error: trimmed.slice(0, 100) };
    next[action] = { max, intervalSeconds: seconds };
  }
  return { ok: true, value: next };
}

/** Fenêtre de suppression du salon piège, en minutes (5–1440). */
export function parseWindowMinutes(raw: string | undefined): ParseResult<number> {
  const v = (raw ?? '').trim().replace(/\s*(min|m)$/i, '');
  if (!/^\d{1,4}$/.test(v) || !inRange(Number(v), HONEYPOT_WINDOW.min, HONEYPOT_WINDOW.max)) return { ok: false, error: (raw ?? '').trim() || '—' };
  return { ok: true, value: Number(v) };
}

/** Protections actuellement actives (valeurs du menu). */
export function activeProtections(cfg: AntiRaidConfig): Protection[] {
  const on: Record<Protection, boolean> = {
    spam: cfg.antiSpam.enabled,
    mentions: cfg.antiMassMention.enabled,
    invites: cfg.antiLink.enabled && cfg.antiLink.blockInvites,
    links: cfg.antiLink.enabled && cfg.antiLink.blockLinks,
    new_account: cfg.antiNewAccount.enabled,
    bots: cfg.antiBot.enabled,
    mass_join: cfg.antiMassJoin.enabled,
    raid_lockdown: cfg.antiMassJoin.lockdown,
  };
  return PROTECTIONS.filter((p) => on[p]);
}

/** Valeurs cochées → patch anti-raid (une protection non cochée est désactivée). */
export function protectionsPatch(values: readonly string[], cfg: AntiRaidConfig): Partial<AntiRaidConfigInput> {
  const on = (p: Protection) => values.includes(p);
  return {
    antiSpam: { ...cfg.antiSpam, enabled: on('spam') },
    antiMassMention: { ...cfg.antiMassMention, enabled: on('mentions') },
    antiLink: { ...cfg.antiLink, enabled: on('invites') || on('links'), blockInvites: on('invites'), blockLinks: on('links') },
    antiNewAccount: { ...cfg.antiNewAccount, enabled: on('new_account') },
    antiBot: { ...cfg.antiBot, enabled: on('bots') },
    antiMassJoin: { ...cfg.antiMassJoin, enabled: on('mass_join'), lockdown: on('raid_lockdown') },
  };
}

// ─────────────────────────── Rendu ───────────────────────────

/** Configuration du salon piège (ligne HoneypotChannel) utile au rendu. */
export interface HoneypotState {
  channelId: string;
  enabled: boolean;
  deleteWindowMinutes: number;
}

export interface ModRenderOptions {
  guild: Guild;
  t: Translator;
  lang: string;
  /** Modules du serveur (absent = considéré actif) */
  modules: Partial<Record<ModuleKey, boolean>>;
  cfg: ResolvedModerationConfig;
  tab: ModTab;
  /** Salon piège (onglet honeypot ; null = non configuré) */
  honeypot?: HoneypotState | null;
  notice?: PanelNotice;
}

function tabsRow(tab: ModTab, t: Translator): Row {
  return row(...MOD_TABS.map((k) => btn(mid('tab', k), t(`panels_core.moderation.tab_${k}`), k === tab ? ButtonStyle.Primary : ButtonStyle.Secondary, TAB_EMOJI[k])));
}

/** Bouton d'activation du module lié à l'onglet (ajouté à la dernière rangée d'actions). */
function tabModuleBtn(opts: ModRenderOptions) {
  const module = TAB_MODULE[opts.tab];
  return module ? moduleBtn(mid('module', opts.tab), opts.modules[module] ?? true, opts.t) : null;
}

function withModule(opts: ModRenderOptions, ...buttons: ReturnType<typeof btn>[]): Row {
  const m = tabModuleBtn(opts);
  return row(...buttons, ...(m ? [m] : []));
}

export function describeThreshold(th: WarnThreshold, t: Translator, lang: string): string {
  return `**${th.count}** → ${t(`moderation.actions.${th.action}`)}${th.duration ? ` (${formatDuration(th.duration, lang)})` : ''}`;
}

export function renderModeration(opts: ModRenderOptions): PanelPayload {
  const { guild, t, tab, notice } = opts;
  const module = TAB_MODULE[tab];
  const warning = module ? moduleWarning(module, opts.modules[module] ?? true, t) : null;
  const embed = embedService.brand(t('panels_core.moderation.title', { server: guild.name })).setDescription(withNotice(notice, warning, t(`panels_core.moderation.hint_${tab}`)));
  const tabs = tabsRow(tab, t);
  switch (tab) {
    case 'honeypot':
      return { embeds: [embed], components: [tabs, ...honeypotView(opts, embed)] };
    case 'antiraid':
      return { embeds: [embed], components: [tabs, ...antiRaidView(opts, embed)] };
    case 'antinuke':
      return { embeds: [embed], components: [tabs, ...antiNukeView(opts, embed)] };
    case 'lockdown':
      return { embeds: [embed], components: [tabs, ...lockdownView(opts, embed)] };
    default:
      return { embeds: [embed], components: [tabs, ...sanctionsView(opts, embed)] };
  }
}

type Embed = ReturnType<typeof embedService.brand>;

function sanctionsView(opts: ModRenderOptions, embed: Embed): Row[] {
  const { guild, t, lang, cfg } = opts;
  embed.addFields(
    { name: t('moderation.config.thresholds_title'), value: fieldLines(cfg.warnThresholds.map((th) => describeThreshold(th, t, lang)), t('moderation.config.no_thresholds')) },
    { name: t('moderation.config.mute_role'), value: cfg.muteRoleId ? `<@&${cfg.muteRoleId}>` : t('core.none'), inline: true },
    { name: t('moderation.config.dm'), value: stateLabel(cfg.dmOnSanction, t), inline: true },
  );
  const mute = new RoleSelectMenuBuilder().setCustomId(mid('muterole')).setPlaceholder(t('panels_core.moderation.mute_role_placeholder')).setMinValues(0).setMaxValues(1);
  const muteDefault = existingRoles(guild, cfg.muteRoleId ? [cfg.muteRoleId] : [], 1);
  if (muteDefault.length) mute.setDefaultRoles(muteDefault);
  const rows: Row[] = [row(mute)];
  if (cfg.warnThresholds.length) {
    const del = new StringSelectMenuBuilder()
      .setCustomId(mid('thdel'))
      .setPlaceholder(t('panels_core.moderation.th_delete_placeholder'))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        cfg.warnThresholds.slice(0, 25).map((th) =>
          option(t('panels_core.moderation.th_option', { count: th.count, action: t(`moderation.actions.${th.action}`) }), String(th.count), { description: th.duration ? formatDuration(th.duration, lang) : null, emoji: '🗑️' }),
        ),
      );
    rows.push(row(del));
  }
  rows.push(
    withModule(
      opts,
      btn(mid('thadd'), t('panels_core.moderation.btn_th_add'), ButtonStyle.Success, '➕', cfg.warnThresholds.length >= MAX_THRESHOLDS),
      btn(mid('threset'), t('panels_core.moderation.btn_th_reset'), ButtonStyle.Secondary, '♻️'),
      toggleBtn(mid('dm'), t('panels_core.moderation.btn_dm', { state: cfg.dmOnSanction ? t('panels_core.common.on') : t('panels_core.common.off') }), cfg.dmOnSanction, '💬'),
    ),
  );
  return rows;
}

function antiRaidView(opts: ModRenderOptions, embed: Embed): Row[] {
  const { guild, t, lang, cfg } = opts;
  const ar = cfg.antiRaid;
  const yesNo = (v: boolean) => (v ? t('core.yes') : t('core.no'));
  const name = (enabled: boolean, key: string) => `${enabled ? '🟢' : '🔴'} ${t(`moderation.antiraid.names.${key}`)}`;
  embed.addFields(
    { name: name(ar.antiSpam.enabled, 'spam'), value: t('moderation.antiraid.desc.spam', { max: ar.antiSpam.maxMessages, seconds: ar.antiSpam.intervalSeconds, timeout: formatDuration(ar.antiSpam.timeoutSeconds, lang) }) },
    { name: name(ar.antiMassMention.enabled, 'mentions'), value: t('moderation.antiraid.desc.mentions', { max: ar.antiMassMention.maxMentions, timeout: formatDuration(ar.antiMassMention.timeoutSeconds, lang) }) },
    {
      name: name(ar.antiLink.enabled, 'links'),
      value: truncate(
        t('moderation.antiraid.desc.links', {
          invites: yesNo(ar.antiLink.blockInvites),
          links: yesNo(ar.antiLink.blockLinks),
          action: t(`moderation.antiraid.link_actions.${ar.antiLink.action}`),
          whitelist: ar.antiLink.whitelistDomains.join(', ') || t('core.none'),
        }),
        1024,
      ),
    },
    {
      name: name(ar.antiNewAccount.enabled, 'new_account'),
      value: t('moderation.antiraid.desc.new_account', { days: ar.antiNewAccount.minAgeDays, action: t(`moderation.antiraid.account_actions.${ar.antiNewAccount.action}`), role: ar.antiNewAccount.quarantineRoleId ? `<@&${ar.antiNewAccount.quarantineRoleId}>` : '' }),
    },
    { name: name(ar.antiBot.enabled, 'bots'), value: truncate(t('moderation.antiraid.desc.bots', { allowed: userList(ar.antiBot.allowedBotIds, t('core.none')) }), 1024) },
    { name: name(ar.antiMassJoin.enabled, 'mass_join'), value: t('moderation.antiraid.desc.mass_join', { max: ar.antiMassJoin.maxJoins, seconds: ar.antiMassJoin.intervalSeconds, lockdown: yesNo(ar.antiMassJoin.lockdown) }) },
    { name: t('moderation.antiraid.names.exempt'), value: truncate(t('moderation.antiraid.desc.exempt', { roles: roleList(ar.exemptRoleIds, t('core.none')), channels: channelList(ar.exemptChannelIds, t('core.none')) }), 1024) },
  );

  const active = activeProtections(ar);
  const protections = new StringSelectMenuBuilder()
    .setCustomId(mid('arprot'))
    .setPlaceholder(t('panels_core.moderation.protections_placeholder'))
    .setMinValues(0)
    .setMaxValues(PROTECTIONS.length)
    .addOptions(PROTECTIONS.map((p) => option(t(`panels_core.moderation.prot.${p}`), p, { description: t(`panels_core.moderation.prot_desc.${p}`), default: active.includes(p) })));
  const roles = new RoleSelectMenuBuilder().setCustomId(mid('arroles')).setPlaceholder(t('panels_core.moderation.exempt_roles_placeholder')).setMinValues(0).setMaxValues(25);
  const roleDefaults = existingRoles(guild, ar.exemptRoleIds);
  if (roleDefaults.length) roles.setDefaultRoles(roleDefaults);
  const exemptTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice] as const;
  const channels = new ChannelSelectMenuBuilder()
    .setCustomId(mid('archans'))
    .setPlaceholder(t('panels_core.moderation.exempt_channels_placeholder'))
    .addChannelTypes(...exemptTypes)
    .setMinValues(0)
    .setMaxValues(25);
  const channelDefaults = existingChannels(guild, ar.exemptChannelIds, 25, exemptTypes);
  if (channelDefaults.length) channels.setDefaultChannels(channelDefaults);

  return [
    row(protections),
    row(roles),
    row(channels),
    withModule(opts, btn(mid('arset'), t('panels_core.moderation.btn_settings'), ButtonStyle.Primary, '⚙️'), btn(mid('ardom'), t('panels_core.moderation.btn_domains'), ButtonStyle.Secondary, '🔗')),
  ];
}

function antiNukeView(opts: ModRenderOptions, embed: Embed): Row[] {
  const { t, cfg } = opts;
  const nk = cfg.antiRaid.antiNuke;
  const yesNo = (v: boolean) => (v ? t('core.yes') : t('core.no'));
  embed.addFields(
    { name: t('panels_core.moderation.field_state'), value: stateLabel(nk.enabled, t), inline: true },
    { name: t('moderation.antinuke.names.punishment'), value: t(`moderation.antinuke.punishments.${nk.punishment}`), inline: true },
    { name: t('moderation.antinuke.names.bot_add'), value: yesNo(nk.botAddProtection), inline: true },
    { name: t('moderation.antinuke.names.lockdown'), value: yesNo(nk.lockdownOnTrigger), inline: true },
    { name: t('moderation.antinuke.names.restore_bans'), value: yesNo(nk.restoreBans), inline: true },
    { name: t('moderation.antinuke.names.dm'), value: yesNo(nk.dmExecutor), inline: true },
    { name: t('moderation.antinuke.names.exempt_team'), value: yesNo(nk.exemptTeamRoles), inline: true },
    { name: t('moderation.antinuke.names.thresholds'), value: ANTI_NUKE_ACTIONS.map((a) => `• ${t(`moderation.antinuke.actions.${a}`)} : **${nk.thresholds[a].max}** / ${nk.thresholds[a].intervalSeconds}s`).join('\n') },
    { name: t('moderation.antinuke.names.whitelist'), value: truncate(t('moderation.antinuke.desc.whitelist', { users: userList(nk.whitelistUserIds, t('core.none')) }), 1024) },
  );

  const punishment = new StringSelectMenuBuilder()
    .setCustomId(mid('nkpun'))
    .setPlaceholder(t('panels_core.moderation.punishment_placeholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(ANTI_NUKE_PUNISHMENTS.map((p) => option(t(`moderation.antinuke.punishments.${p}`), p, { default: p === nk.punishment })));
  const whitelist = new UserSelectMenuBuilder().setCustomId(mid('nkwl')).setPlaceholder(t('panels_core.moderation.whitelist_placeholder')).setMinValues(0).setMaxValues(25);
  if (nk.whitelistUserIds.length) whitelist.setDefaultUsers(nk.whitelistUserIds.slice(0, 25));
  const toggle = (key: NukeToggle, label: string, emoji: string) => toggleBtn(mid('nk', key), label, nk[NUKE_TOGGLES[key]] as boolean, emoji);

  return [
    row(punishment),
    row(whitelist),
    row(
      toggle('enabled', t('panels_core.moderation.btn_nuke', { state: nk.enabled ? t('panels_core.common.on') : t('panels_core.common.off') }), nk.enabled ? '🟢' : '🔴'),
      toggle('botadd', t('panels_core.moderation.btn_bot_add'), '🤖'),
      toggle('lockdown', t('panels_core.moderation.btn_lockdown_auto'), '🔒'),
      toggle('restore', t('panels_core.moderation.btn_restore_bans'), '♻️'),
      toggle('team', t('panels_core.moderation.btn_exempt_team'), '🛡️'),
    ),
    withModule(opts, btn(mid('nkth'), t('panels_core.moderation.btn_thresholds'), ButtonStyle.Primary, '⏱️'), toggle('dm', t('panels_core.moderation.btn_dm_executor'), '💬')),
  ];
}

function lockdownView(opts: ModRenderOptions, embed: Embed): Row[] {
  const { t, cfg } = opts;
  const state = cfg.lockdownState;
  const status = cfg.lockdownActive
    ? t('moderation.lockdown.status_on', {
        since: state ? discordTimestamp(new Date(state.at), 'R') : '—',
        actor: state ? `<@${state.actorId}>` : '—',
        channels: state ? Object.keys(state.channels).length : 0,
        reason: state?.reason ?? t('core.no_reason'),
      })
    : t('moderation.lockdown.status_off');
  embed.addFields({ name: t('moderation.lockdown.status_title'), value: status });
  return [
    withModule(
      opts,
      cfg.lockdownActive
        ? btn(mid('lock', 'off'), t('panels_core.moderation.btn_lock_off'), ButtonStyle.Success, '🔓')
        : btn(mid('lock', 'on'), t('panels_core.moderation.btn_lock_on'), ButtonStyle.Danger, '🔒'),
    ),
  ];
}

function honeypotView({ guild, t, lang, honeypot }: ModRenderOptions, embed: Embed): Row[] {
  const configured = Boolean(honeypot);
  embed.addFields(
    { name: t('core.channel'), value: honeypot ? `<#${honeypot.channelId}>` : t('panels_core.moderation.hp_not_configured'), inline: true },
    { name: t('panels_core.moderation.field_state'), value: honeypot ? stateLabel(honeypot.enabled, t) : '—', inline: true },
    { name: t('panels_core.moderation.hp_field_window'), value: honeypot ? formatDuration(honeypot.deleteWindowMinutes * 60, lang) : '—', inline: true },
  );
  const select = new ChannelSelectMenuBuilder().setCustomId(mid('hpchan')).setPlaceholder(t('panels_core.moderation.hp_channel_placeholder')).addChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  const current = existingChannels(guild, honeypot ? [honeypot.channelId] : [], 1, [ChannelType.GuildText]);
  if (current.length) select.setDefaultChannels(current);
  return [
    row(select),
    row(
      configured
        ? btn(mid('hpcreate'), t('panels_core.moderation.hp_btn_republish'), ButtonStyle.Secondary, '🔄')
        : btn(mid('hpcreate'), t('panels_core.moderation.hp_btn_create'), ButtonStyle.Success, '🍯'),
      toggleBtn(mid('hptoggle'), honeypot?.enabled ? t('core.enabled') : t('core.disabled'), honeypot?.enabled ?? false).setDisabled(!configured),
      btn(mid('hpwin'), t('panels_core.moderation.hp_btn_window'), ButtonStyle.Primary, '⏱️', !configured),
      btn(mid('hpremove'), t('panels_core.moderation.hp_btn_remove'), ButtonStyle.Danger, '🗑️', !configured),
    ),
  ];
}

/** Confirmation avant de retirer le salon piège (le salon est conservé). */
export function renderHoneypotRemoveConfirm(opts: { t: Translator; channelId: string | null }): PanelPayload {
  const { t, channelId } = opts;
  return {
    embeds: [embedService.warning(t('panels_core.moderation.hp_remove_confirm', { channel: channelId ? `<#${channelId}>` : '—' }), t('panels_core.moderation.hp_remove_title'))],
    components: [row(btn(mid('hpremoveok'), t('core.confirm'), ButtonStyle.Danger, '🗑️'), btn(mid('tab', 'honeypot'), t('core.cancel'), ButtonStyle.Secondary))],
  };
}

/** Confirmation avant d'activer / lever le lockdown. */
export function renderLockdownConfirm(opts: { t: Translator; enable: boolean }): PanelPayload {
  const { t, enable } = opts;
  const embed = embedService.warning(enable ? t('moderation.lockdown.confirm_on', { reason: t('core.no_reason') }) : t('moderation.lockdown.confirm_off'), t('moderation.lockdown.confirm_title'));
  return {
    embeds: [embed],
    components: [
      row(
        btn(mid('lockok', enable ? 'on' : 'off'), t('core.confirm'), enable ? ButtonStyle.Danger : ButtonStyle.Success, enable ? '🔒' : '🔓'),
        btn(mid('tab', 'lockdown'), t('core.cancel'), ButtonStyle.Secondary),
      ),
    ],
  };
}

/** Relit la config (modération + modules) et rend l'onglet demandé. */
export async function loadModerationPanel(opts: { guild: Guild; t: Translator; lang: string; tab: ModTab; notice?: PanelNotice }): Promise<PanelPayload> {
  const [cfg, gcfg, honeypot] = await Promise.all([
    moderationService.getConfig(opts.guild.id),
    guildConfigService.get(opts.guild.id),
    opts.tab === 'honeypot' ? honeypotService.getConfig(opts.guild.id) : Promise.resolve(null),
  ]);
  return renderModeration({ ...opts, cfg, modules: gcfg?.modules ?? {}, honeypot });
}

// ─────────────────────────── Modals ───────────────────────────

export function buildThresholdModal(t: Translator) {
  const action = new StringSelectMenuBuilder()
    .setCustomId('action')
    .setPlaceholder(t('panels_core.moderation.modal_th_action'))
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true)
    .addOptions(WARN_ACTIONS.map((a) => option(t(`moderation.actions.${a}`), a, { default: a === 'TIMEOUT' })));
  return modal(
    mid('thadd'),
    t('panels_core.moderation.modal_th_title'),
    labelled(t('panels_core.moderation.modal_th_count'), textInput('count', TextInputStyle.Short, { placeholder: '3', required: true, max: 3 })),
    labelled(t('panels_core.moderation.modal_th_action'), action),
    labelled(t('panels_core.moderation.modal_th_duration'), textInput('duration', TextInputStyle.Short, { placeholder: '1h', max: 20 }), t('panels_core.moderation.modal_th_duration_help')),
  );
}

export function buildAntiRaidSettingsModal(cfg: AntiRaidConfig, t: Translator, lang: string) {
  return modal(
    mid('arset'),
    t('panels_core.moderation.modal_settings_title'),
    labelled(t('panels_core.moderation.modal_spam'), textInput('spam', TextInputStyle.Short, { value: `${cfg.antiSpam.maxMessages}/${cfg.antiSpam.intervalSeconds}`, placeholder: '6/5', max: 12 })),
    labelled(t('panels_core.moderation.modal_mentions'), textInput('mentions', TextInputStyle.Short, { value: String(cfg.antiMassMention.maxMentions), placeholder: '5', max: 3 })),
    labelled(t('panels_core.moderation.modal_age'), textInput('age', TextInputStyle.Short, { value: String(cfg.antiNewAccount.minAgeDays), placeholder: '7', max: 4 })),
    labelled(t('panels_core.moderation.modal_joins'), textInput('joins', TextInputStyle.Short, { value: `${cfg.antiMassJoin.maxJoins}/${cfg.antiMassJoin.intervalSeconds}`, placeholder: '10/10', max: 12 })),
    labelled(t('panels_core.moderation.modal_timeout'), textInput('timeout', TextInputStyle.Short, { value: formatDuration(cfg.antiSpam.timeoutSeconds, lang), placeholder: '10m', max: 20 }), t('panels_core.moderation.modal_timeout_help')),
  );
}

export function buildDomainsModal(cfg: AntiRaidConfig, t: Translator) {
  return modal(
    mid('ardom'),
    t('panels_core.moderation.modal_domains_title'),
    labelled(t('panels_core.moderation.modal_domains_label'), textInput('domains', TextInputStyle.Paragraph, { value: cfg.antiLink.whitelistDomains.join('\n'), placeholder: 'youtube.com\ntwitch.tv', max: 4000 }), t('panels_core.moderation.modal_domains_help')),
  );
}

export function buildHoneypotWindowModal(current: number | null, t: Translator) {
  return modal(
    mid('hpwin'),
    t('panels_core.moderation.hp_modal_title'),
    labelled(t('panels_core.moderation.hp_modal_label'), textInput('minutes', TextInputStyle.Short, { value: current ? String(current) : '60', placeholder: '60', required: true, max: 4 }), t('panels_core.moderation.hp_modal_help', { min: HONEYPOT_WINDOW.min, max: HONEYPOT_WINDOW.max })),
  );
}

export function buildNukeThresholdsModal(cfg: AntiNukeConfig, t: Translator) {
  return modal(
    mid('nkth'),
    t('panels_core.moderation.modal_nuke_title'),
    labelled(t('panels_core.moderation.modal_nuke_label'), textInput('thresholds', TextInputStyle.Paragraph, { value: serializeNukeThresholds(cfg.thresholds), required: true, max: 1000 }), t('panels_core.moderation.modal_nuke_help')),
  );
}
