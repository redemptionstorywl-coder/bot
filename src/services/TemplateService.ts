import { ChannelType, PermissionFlagsBits, type Guild, type GuildTextBasedChannel, type Message, type NewsChannel, type Role, type TextChannel } from 'discord.js';
import { AutoRoleType, PanelStyle, type LogCategory } from '@prisma/client';
import { BRAND, LANGUAGE_CODES, getLanguage } from '../config/constants';
import { SERVER_TEMPLATES, getTemplate, type Bilingual, type BilingualEmbed, type ServerTemplate, type TemplateInfoMessage, type TemplateQuestion, type TemplateTicketType } from '../templates';
import { childLogger } from '../utils/logger';
import { embedService, type EmbedSpec } from './EmbedService';
import { embedTemplateService } from './EmbedTemplateService';
import { fivemService } from './FiveMService';
import { guildConfigService } from './GuildConfigService';
import { languageService } from './LanguageService';
import { moderationService } from './ModerationService';
import { roleService } from './RoleService';
import { ticketService, type TicketQuestion } from './TicketService';
import { welcomeService } from './WelcomeService';

const log = childLogger('TemplateService');

// ───────────────────────── Types ─────────────────────────

export interface ChannelLike {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
}

export interface RoleLike {
  id: string;
  name: string;
}

/** Sous-ensemble de `Guild` nécessaire à la planification (permet des faux serveurs dans les tests). */
export interface GuildLike {
  id: string;
  name: string;
  channels: { cache: ReadonlyMap<string, ChannelLike> };
  roles: { cache: ReadonlyMap<string, RoleLike> };
}

export type ChannelKind = 'text' | 'category' | 'forum' | 'voice';

/** Message traduit côté commande : `t('template.<scope>.<key>', vars)`. */
export interface StepMessage {
  key: string;
  vars?: Record<string, string | number>;
}

export interface StepTarget {
  kind: 'channel' | 'category' | 'role';
  id: string;
  name: string;
}

export interface PlanStep {
  id: string;
  label: StepMessage;
  status: 'ready' | 'skipped';
  reason?: StepMessage;
  targets: StepTarget[];
  /** Informations complémentaires (déjà traduites ou mentions Discord). */
  detail?: string;
}

export interface ReportStep {
  id: string;
  label: StepMessage;
  status: 'done' | 'skipped' | 'failed';
  reason?: StepMessage;
  detail?: string;
  targets: StepTarget[];
}

export interface TemplateReport {
  template: ServerTemplate;
  dryRun: boolean;
  steps: ReportStep[];
  /** Salons recommandés (giveaways / sondages / événements) trouvés sur le serveur. */
  recommended: { key: string; channel: ChannelLike | null }[];
}

interface ResolvedTicket {
  type: TemplateTicketType;
  category: ChannelLike | null;
  staffRoles: RoleLike[];
}

interface Resolution {
  staffRoles: RoleLike[];
  adminRoles: RoleLike[];
  memberRoles: RoleLike[];
  botRoles: RoleLike[];
  muteRole: RoleLike | null;
  welcomeChannel: ChannelLike | null;
  leaveChannel: ChannelLike | null;
  rulesChannel: ChannelLike | null;
  ticketPanelChannel: ChannelLike | null;
  languagePanelChannel: ChannelLike | null;
  notificationPanelChannel: ChannelLike | null;
  fivemChannel: ChannelLike | null;
  logs: { category: LogCategory; channel: ChannelLike }[];
  logsMissing: LogCategory[];
  tickets: ResolvedTicket[];
  languageChannels: Record<string, ChannelLike>;
  /** Cibles nommées pour `{channel:<clé>}` */
  placeholders: Record<string, ChannelLike | null>;
  info: { message: TemplateInfoMessage; channel: ChannelLike | null }[];
  recommended: { key: string; channel: ChannelLike | null }[];
}

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const KIND_TYPES: Record<ChannelKind, number[]> = {
  text: TEXT_TYPES,
  category: [ChannelType.GuildCategory],
  forum: [ChannelType.GuildForum, ChannelType.GuildMedia],
  voice: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
};
const HISTORY_SCAN = 20;

// ───────────────────────── Fonctions pures ─────────────────────────

/**
 * Normalise un nom de salon / rôle pour la comparaison : minuscules, sans accents, sans emoji,
 * sans séparateurs (`・`, `-`, `_`, espaces, ponctuation). `👋・welcome` → `welcome`, `🛡️ RS Team` → `rsteam`.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Premier salon dont le nom normalisé correspond à l'un des noms (dans l'ordre de priorité des noms). */
export function matchChannel<T extends ChannelLike>(channels: Iterable<T>, names: readonly string[], kind?: ChannelKind): T | null {
  const list = [...channels].filter((c) => !kind || KIND_TYPES[kind].includes(c.type));
  for (const wanted of names.map(normalizeName).filter(Boolean)) {
    const found = list.find((c) => normalizeName(c.name) === wanted);
    if (found) return found;
  }
  return null;
}

/** Tous les rôles dont le nom normalisé correspond à l'un des noms (sans doublon, ordre des noms). */
export function matchRoles<T extends RoleLike>(roles: Iterable<T>, names: readonly string[]): T[] {
  const list = [...roles];
  const out: T[] = [];
  for (const wanted of names.map(normalizeName).filter(Boolean)) {
    for (const r of list) if (normalizeName(r.name) === wanted && !out.includes(r)) out.push(r);
  }
  return out;
}

export function matchRole<T extends RoleLike>(roles: Iterable<T>, names: readonly string[]): T | null {
  return matchRoles(roles, names)[0] ?? null;
}

/**
 * Remplace `{channel:<clé>}` par la mention du salon résolu (`<#id>`) ; si la cible est absente,
 * un libellé neutre `#<clé>` est utilisé pour ne jamais laisser un placeholder brut.
 */
export function substitutePlaceholders(text: string, channels: Record<string, ChannelLike | null | undefined>): string {
  return text.replace(/\{channel:([a-zA-Z0-9_-]+)\}/g, (_m, key: string) => {
    const ch = channels[key];
    return ch ? `<#${ch.id}>` : `#${key}`;
  });
}

/** Applique `substitutePlaceholders` à toutes les chaînes d'un objet (EmbedSpec…). */
export function substituteObject<T>(value: T, channels: Record<string, ChannelLike | null | undefined>): T {
  if (typeof value === 'string') return substitutePlaceholders(value, channels) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => substituteObject(v, channels)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = substituteObject(v, channels);
    return out as T;
  }
  return value;
}

function pick(b: Bilingual, lang: string): string {
  return lang === 'en' ? b.en : b.fr;
}

function toTicketQuestions(questions: TemplateQuestion[], lang: string): TicketQuestion[] {
  return questions.slice(0, 5).map((q) => ({
    id: q.id,
    label: pick(q.label, lang).slice(0, 45),
    placeholder: q.placeholder ? pick(q.placeholder, lang).slice(0, 100) : undefined,
    style: q.style ?? 'short',
    required: q.required ?? true,
    maxLength: q.style === 'paragraph' ? 1000 : 200,
  }));
}

function target(kind: StepTarget['kind'], x: ChannelLike | RoleLike): StepTarget {
  return { kind, id: x.id, name: x.name };
}

function channelMention(c: ChannelLike | null): string {
  return c ? `<#${c.id}>` : '—';
}

// ───────────────────────── Service ─────────────────────────

/**
 * Moteur de modèles de serveur : résout les cibles par nom, planifie les étapes, les applique via les
 * services existants. Idempotent : ré-exécutable sans republier les messages déjà postés par le bot
 * (footer `template:<étape>` cherché dans les 20 derniers messages du salon).
 */
export class TemplateService {
  listTemplates(): ServerTemplate[] {
    return SERVER_TEMPLATES;
  }

  getTemplate(key: string): ServerTemplate | undefined {
    return getTemplate(key);
  }

  // ───── Résolution (pure) ─────

  resolve(guild: GuildLike, tpl: ServerTemplate): Resolution {
    const channels = [...guild.channels.cache.values()];
    const roles = [...guild.roles.cache.values()];
    const text = (names: readonly string[]) => matchChannel(channels, names, 'text');

    const placeholders: Record<string, ChannelLike | null> = {};
    for (const [key, names] of Object.entries(tpl.channels)) placeholders[key] = matchChannel(channels, names) ?? null;
    const welcomeChannel = text(tpl.welcome.channelNames);
    const rulesChannel = text(tpl.rules.channelNames);
    const ticketPanelChannel = text(tpl.tickets.panel.channelNames);
    placeholders.welcome = welcomeChannel;
    placeholders.rules = rulesChannel;
    placeholders.ticket = ticketPanelChannel;

    const logs: Resolution['logs'] = [];
    const logsMissing: LogCategory[] = [];
    for (const [category, names] of Object.entries(tpl.logChannels) as [LogCategory, string[]][]) {
      const ch = text(names);
      if (ch) logs.push({ category, channel: ch });
      else logsMissing.push(category);
    }

    const tickets: ResolvedTicket[] = tpl.tickets.types.map((type) => ({
      type,
      category: matchChannel(channels, type.categoryNames, 'category'),
      staffRoles: matchRoles(roles, type.staffRoleNames),
    }));

    const languageChannels: Record<string, ChannelLike> = {};
    for (const [code, names] of Object.entries(tpl.language.channelNames ?? {})) {
      if (!tpl.enabledLanguages.includes(code)) continue;
      const ch = text(names);
      if (ch) languageChannels[code] = ch;
    }

    return {
      staffRoles: matchRoles(roles, tpl.staffRoleNames),
      adminRoles: matchRoles(roles, tpl.adminRoleNames),
      memberRoles: matchRoles(roles, tpl.memberRoleNames),
      botRoles: matchRoles(roles, tpl.botRoleNames),
      muteRole: tpl.muteRoleNames ? matchRole(roles, tpl.muteRoleNames) : null,
      welcomeChannel,
      leaveChannel: tpl.leave ? text(tpl.leave.channelNames) : null,
      rulesChannel,
      ticketPanelChannel,
      languagePanelChannel: text(tpl.language.panelChannelNames) ?? welcomeChannel,
      notificationPanelChannel: text(tpl.notifications.panelChannelNames),
      fivemChannel: tpl.fivem ? text(tpl.fivem.statusChannelNames) : null,
      logs,
      logsMissing,
      tickets,
      languageChannels,
      placeholders,
      info: tpl.infoMessages.map((message) => ({ message, channel: text(message.channelNames) })),
      recommended: Object.entries(tpl.recommended).map(([key, names]) => ({ key, channel: text(names) })),
    };
  }

  // ───── Plan ─────

  /** Liste les étapes résolues (✅ prête / ⚠️ ignorée + raison) sans rien modifier. */
  async plan(guild: GuildLike, templateKey: string): Promise<{ template: ServerTemplate; steps: PlanStep[]; resolution: Resolution }> {
    const tpl = getTemplate(templateKey);
    if (!tpl) throw new Error(`Unknown template: ${templateKey}`);
    const r = this.resolve(guild, tpl);
    const steps: PlanStep[] = [];
    const notFound = (names: readonly string[]): StepMessage => ({ key: 'channel_not_found', vars: { names: names.slice(0, 3).join(', ') } });
    const channelStep = (id: string, label: StepMessage, channel: ChannelLike | null, names: readonly string[], detail?: string): PlanStep =>
      channel ? { id, label, status: 'ready', targets: [target('channel', channel)], detail } : { id, label, status: 'skipped', reason: notFound(names), targets: [] };

    steps.push({ id: 'kind', label: { key: 'kind' }, status: 'ready', targets: [], detail: `${tpl.kind} · ${tpl.enabledLanguages.map((c) => getLanguage(c)?.flag ?? c).join(' ')}` });

    const teamRoles = [...r.adminRoles, ...r.staffRoles.filter((x) => !r.adminRoles.includes(x))];
    steps.push(
      teamRoles.length
        ? { id: 'roles', label: { key: 'roles' }, status: 'ready', targets: teamRoles.map((x) => target('role', x)) }
        : { id: 'roles', label: { key: 'roles' }, status: 'skipped', reason: { key: 'role_not_found', vars: { names: [...tpl.adminRoleNames, ...tpl.staffRoleNames].slice(0, 4).join(', ') } }, targets: [] },
    );

    const autoRoles = [...r.memberRoles.slice(0, 1), ...r.botRoles.slice(0, 1)];
    steps.push(
      autoRoles.length
        ? { id: 'autorole', label: { key: 'autorole' }, status: 'ready', targets: autoRoles.map((x) => target('role', x)) }
        : { id: 'autorole', label: { key: 'autorole' }, status: 'skipped', reason: { key: 'role_not_found', vars: { names: [...tpl.memberRoleNames, ...tpl.botRoleNames].slice(0, 4).join(', ') } }, targets: [] },
    );

    steps.push(
      r.logs.length
        ? { id: 'logs', label: { key: 'logs' }, status: 'ready', targets: r.logs.map((l) => target('channel', l.channel)), detail: r.logs.map((l) => `${l.category} → <#${l.channel.id}>`).join('\n') + (r.logsMissing.length ? `\n⚠️ ${r.logsMissing.join(', ')}` : '') }
        : { id: 'logs', label: { key: 'logs' }, status: 'skipped', reason: { key: 'channel_not_found', vars: { names: 'staff-chat, logs' } }, targets: [] },
    );

    steps.push({ id: 'moderation', label: { key: 'moderation' }, status: 'ready', targets: r.muteRole ? [target('role', r.muteRole)] : [] });
    steps.push({ id: 'embed_templates', label: { key: 'embed_templates' }, status: 'ready', targets: [] });
    steps.push(channelStep('welcome', { key: 'welcome' }, r.welcomeChannel, tpl.welcome.channelNames));
    if (tpl.leave) steps.push(channelStep('leave', { key: 'leave' }, r.leaveChannel, tpl.leave.channelNames));
    steps.push(channelStep('rules', { key: 'rules' }, r.rulesChannel, tpl.rules.channelNames));

    steps.push({
      id: 'tickets',
      label: { key: 'tickets' },
      status: 'ready',
      targets: r.tickets.filter((t) => t.category).map((t) => target('category', t.category!)),
      detail: r.tickets.map((t) => `${t.type.emoji} ${t.type.label.fr} → ${t.category ? `<#${t.category.id}>` : t.type.createCategoryName ? `➕ ${t.type.createCategoryName}` : '—'}`).join('\n'),
    });
    steps.push(channelStep('ticket_panel', { key: 'ticket_panel' }, r.ticketPanelChannel, tpl.tickets.panel.channelNames));

    const langDetail = Object.entries(r.languageChannels).map(([code, ch]) => `${getLanguage(code)?.flag ?? code} <#${ch.id}>`).join(' ');
    steps.push({ id: 'language', label: { key: 'language' }, status: 'ready', targets: Object.values(r.languageChannels).map((c) => target('channel', c)), detail: langDetail || undefined });
    steps.push(channelStep('language_panel', { key: 'language_panel' }, r.languagePanelChannel, [...tpl.language.panelChannelNames, ...tpl.welcome.channelNames]));

    steps.push({ id: 'notifications', label: { key: 'notifications' }, status: 'ready', targets: [], detail: tpl.notifications.items.map((n) => `${n.emoji} ${n.label.fr}`).join(' · ') });
    steps.push(channelStep('notification_panel', { key: 'notification_panel' }, r.notificationPanelChannel, tpl.notifications.panelChannelNames));

    if (tpl.fivem) {
      const servers = await fivemService.listServers(guild.id).catch(() => []);
      if (!servers.length) steps.push({ id: 'fivem', label: { key: 'fivem' }, status: 'skipped', reason: { key: 'no_fivem_server' }, targets: [] });
      else steps.push(channelStep('fivem', { key: 'fivem' }, r.fivemChannel, tpl.fivem.statusChannelNames, servers.map((s) => s.name).join(', ')));
    }

    for (const { message, channel } of r.info) {
      steps.push(channelStep(`info:${message.key}`, { key: 'info', vars: { name: message.key } }, channel, message.channelNames));
    }
    return { template: tpl, steps, resolution: r };
  }

  // ───── Application ─────

  async apply(guild: Guild, templateKey: string, actorId: string, opts: { dryRun?: boolean } = {}): Promise<TemplateReport> {
    const { template: tpl, steps, resolution: r } = await this.plan(guild, templateKey);
    const report: TemplateReport = { template: tpl, dryRun: !!opts.dryRun, steps: [], recommended: r.recommended };
    if (opts.dryRun) {
      report.steps = steps.map((s) => ({ id: s.id, label: s.label, status: s.status === 'ready' ? 'done' : 'skipped', reason: s.reason, detail: s.detail, targets: s.targets }));
      return report;
    }
    await guildConfigService.getOrCreate(guild);
    for (const step of steps) {
      if (step.status === 'skipped') {
        report.steps.push({ id: step.id, label: step.label, status: 'skipped', reason: step.reason, targets: step.targets });
        continue;
      }
      try {
        const detail = await this.run(step.id, guild, tpl, r, actorId);
        report.steps.push({ id: step.id, label: step.label, status: 'done', detail: detail ?? step.detail, targets: step.targets });
      } catch (err) {
        log.warn({ err, guild: guild.id, step: step.id, template: tpl.key }, 'Étape de template en échec');
        const code = (err as { code?: number }).code;
        report.steps.push({ id: step.id, label: step.label, status: 'failed', reason: { key: code === 50013 ? 'missing_permissions' : 'error', vars: { message: (err as Error).message?.slice(0, 200) ?? '' } }, targets: step.targets });
      }
    }
    log.info({ guild: guild.id, template: tpl.key, actorId, done: report.steps.filter((s) => s.status === 'done').length, failed: report.steps.filter((s) => s.status === 'failed').length }, 'Template appliqué');
    return report;
  }

  private async run(stepId: string, guild: Guild, tpl: ServerTemplate, r: Resolution, actorId: string): Promise<string | undefined> {
    const lang = tpl.defaultLanguage;
    switch (stepId) {
      case 'kind': {
        await guildConfigService.setKind(guild.id, tpl.kind);
        await guildConfigService.updateSettings(guild.id, { defaultLanguage: lang, enabledLanguages: tpl.enabledLanguages.filter((c) => LANGUAGE_CODES.includes(c)) });
        return undefined;
      }
      case 'roles': {
        const cfg = await guildConfigService.get(guild.id);
        const staffRoleIds = [...new Set([...(cfg?.staffRoleIds ?? []), ...r.staffRoles.map((x) => x.id)])];
        const adminRoleIds = [...new Set([...(cfg?.adminRoleIds ?? []), ...r.adminRoles.map((x) => x.id)])];
        await guildConfigService.updateSettings(guild.id, { staffRoleIds, adminRoleIds });
        return `${r.adminRoles.map((x) => `<@&${x.id}>`).join(' ') || '—'} / ${r.staffRoles.map((x) => `<@&${x.id}>`).join(' ') || '—'}`;
      }
      case 'autorole': {
        const parts: string[] = [];
        const member = r.memberRoles[0];
        const bot = r.botRoles[0];
        if (member) {
          await roleService.addAutoRole(guild.id, member.id, AutoRoleType.JOIN);
          parts.push(`JOIN → <@&${member.id}>`);
        }
        if (bot) {
          await roleService.addAutoRole(guild.id, bot.id, AutoRoleType.BOT);
          parts.push(`BOT → <@&${bot.id}>`);
        }
        return parts.join(' · ');
      }
      case 'logs': {
        for (const { category, channel } of r.logs) await guildConfigService.setLogChannel(guild.id, category, channel.id);
        return undefined;
      }
      case 'moderation': {
        await moderationService.updateConfig(guild.id, { dmOnSanction: true, ...(r.muteRole ? { muteRoleId: r.muteRole.id } : {}) });
        return r.muteRole ? `<@&${r.muteRole.id}>` : undefined;
      }
      case 'embed_templates': {
        embedTemplateService.invalidateDefaults(guild.id);
        const created = await embedTemplateService.ensureDefaults(guild.id, actorId, lang);
        return `+${created}`;
      }
      case 'welcome': {
        const ph = r.placeholders;
        await welcomeService.updateConfig(guild.id, {
          enabled: true,
          channelId: r.welcomeChannel!.id,
          message: substituteObject({ fr: tpl.welcome.message.fr, en: tpl.welcome.message.en }, ph),
          embed: substituteObject({ fr: tpl.welcome.embed.fr, en: tpl.welcome.embed.en }, ph),
          imageEnabled: tpl.welcome.image,
          ...(tpl.welcome.dm ? { dmEnabled: true, dmMessage: substituteObject({ fr: tpl.welcome.dm.fr, en: tpl.welcome.dm.en }, ph) } : {}),
        });
        return channelMention(r.welcomeChannel);
      }
      case 'leave': {
        await welcomeService.updateLeaveConfig(guild.id, { enabled: true, channelId: r.leaveChannel!.id, message: { fr: tpl.leave!.message.fr, en: tpl.leave!.message.en }, logEnabled: true });
        return channelMention(r.leaveChannel);
      }
      case 'rules':
        return this.postOnce(guild, r.rulesChannel!, 'rules', tpl.rules.embeds, r.placeholders);
      case 'tickets': {
        const created: string[] = [];
        const me = guild.members.me;
        for (const t of r.tickets) {
          let categoryId = t.category?.id ?? null;
          if (!categoryId && t.type.createCategoryName && me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && normalizeName(c.name) === normalizeName(t.type.createCategoryName!));
            const cat = existing ?? (await guild.channels.create({ name: t.type.createCategoryName, type: ChannelType.GuildCategory, reason: `Redemption Story — template ${tpl.key}` }));
            if (!existing) created.push(`<#${cat.id}>`);
            categoryId = cat.id;
            t.category = { id: cat.id, name: cat.name, type: cat.type };
          }
          await ticketService.upsertType(guild.id, {
            key: t.type.key,
            label: pick(t.type.label, lang),
            emoji: t.type.emoji,
            description: pick(t.type.description, lang).slice(0, 100),
            categoryId,
            staffRoleIds: t.staffRoles.map((x) => x.id).slice(0, 25),
            questions: toTicketQuestions(t.type.questions, lang),
            language: lang,
            enabled: true,
            order: r.tickets.indexOf(t),
          });
        }
        return `${r.tickets.length} types${created.length ? ` · ➕ ${created.join(' ')}` : ''}`;
      }
      case 'ticket_panel': {
        const channel = r.ticketPanelChannel!;
        const panels = await ticketService.listPanels(guild.id);
        if (panels.some((p) => p.channelId === channel.id)) return `${channelMention(channel)} (already)`;
        const types = await ticketService.listTypes(guild.id, { enabledOnly: true });
        const wanted = tpl.tickets.types.map((t) => t.key);
        const typeIds = types.filter((t) => wanted.includes(t.key)).map((t) => t.id);
        const cfg = await guildConfigService.get(guild.id);
        const discordChannel = await this.textChannel(guild, channel.id);
        await ticketService.createPanel({ guild, channel: discordChannel, style: tpl.tickets.panel.style === 'BUTTONS' ? PanelStyle.BUTTONS : PanelStyle.SELECT, typeIds, embed: substituteObject(tpl.tickets.panel.embed, r.placeholders), lang, brandColor: cfg?.brandColor ?? BRAND.colors.primary });
        return channelMention(channel);
      }
      case 'language': {
        const langs = tpl.enabledLanguages.filter((c) => getLanguage(c));
        const { createdRoles } = await languageService.ensureRoles(guild, langs);
        const parts: string[] = [];
        if (createdRoles.length) parts.push(`+${createdRoles.length} rôles`);
        const mapped = Object.keys(r.languageChannels);
        if (mapped.length) {
          const cfg = await guildConfigService.get(guild.id);
          const languageChannels = { ...(cfg?.languageChannels ?? {}) };
          for (const [code, ch] of Object.entries(r.languageChannels)) languageChannels[code] = ch.id;
          await guildConfigService.updateSettings(guild.id, { languageChannels, translationMode: 'CHANNELS' });
          parts.push(mapped.map((c) => `${getLanguage(c)?.flag ?? c} <#${r.languageChannels[c]!.id}>`).join(' '));
        }
        if (tpl.language.announcements) {
          const missing = langs.filter((c) => !r.languageChannels[c]);
          if (missing.length) {
            const res = await languageService.ensureAnnouncementChannels(guild, missing);
            if (res.created.length) parts.push(`➕ ${res.created.map((c) => getLanguage(c)?.flag ?? c).join(' ')}`);
          }
        }
        return parts.join(' · ') || undefined;
      }
      case 'language_panel': {
        const message = await languageService.publishPanel(guild, r.languagePanelChannel!.id, PanelStyle.BUTTONS);
        welcomeService.invalidate(guild.id);
        return message.url;
      }
      case 'notifications': {
        const existing = await roleService.listNotificationRoles(guild.id);
        const me = guild.members.me;
        let created = 0;
        for (const [index, item] of tpl.notifications.items.entries()) {
          const row = existing.find((x) => x.key === item.key);
          const label = pick(item.label, lang);
          let role: Role | undefined = row ? guild.roles.cache.get(row.roleId) : undefined;
          if (!role) role = matchRole<Role>(guild.roles.cache.values(), [`${item.emoji} ${label}`, `${item.emoji} ${item.label.en}`, label, item.label.en, item.label.fr]) ?? undefined;
          if (!role) {
            if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) continue;
            role = await guild.roles.create({ name: `${item.emoji} ${label}`, color: BRAND.colors.neutral, mentionable: false, permissions: [], reason: `Redemption Story — template ${tpl.key}` });
            created++;
          }
          await roleService.upsertNotificationRole(guild.id, { key: item.key, roleId: role.id, label, emoji: item.emoji, order: index });
        }
        return `${tpl.notifications.items.length} (+${created})`;
      }
      case 'notification_panel': {
        const channel = r.notificationPanelChannel!;
        const discordChannel = await this.textChannel(guild, channel.id);
        const existing = await this.findBotMessage(discordChannel, (m) => m.components.some((row) => 'components' in row && row.components.some((c) => 'customId' in c && typeof c.customId === 'string' && c.customId.startsWith('notif:'))));
        if (existing) return `${existing.url} (already)`;
        const message = await roleService.publishNotificationPanel(guild.id, channel.id, PanelStyle.SELECT);
        return message.url;
      }
      case 'fivem': {
        const servers = await fivemService.listServers(guild.id);
        for (const s of servers) await fivemService.setStatusChannel(guild.id, s.key, r.fivemChannel!.id);
        return `${servers.map((s) => s.name).join(', ')} → ${channelMention(r.fivemChannel)}`;
      }
      default: {
        if (stepId.startsWith('info:')) {
          const key = stepId.slice('info:'.length);
          const entry = r.info.find((i) => i.message.key === key);
          if (!entry?.channel) return undefined;
          return this.postOnce(guild, entry.channel, stepId, entry.message.embeds, r.placeholders);
        }
        throw new Error(`Unknown step: ${stepId}`);
      }
    }
  }

  // ───── Helpers Discord ─────

  private async textChannel(guild: Guild, channelId: string): Promise<TextChannel | NewsChannel> {
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !(channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) throw new Error(`Channel ${channelId} is not a text channel`);
    return channel as TextChannel | NewsChannel;
  }

  /** Cherche parmi les 20 derniers messages un message du bot vérifiant `predicate`. */
  private async findBotMessage(channel: GuildTextBasedChannel, predicate: (m: Message) => boolean): Promise<Message | null> {
    const botId = channel.client.user?.id;
    const messages = await channel.messages.fetch({ limit: HISTORY_SCAN }).catch(() => null);
    if (!messages) return null;
    return messages.find((m) => m.author.id === botId && predicate(m)) ?? null;
  }

  /** Publie un message (embed FR + EN) sauf si un message du bot portant `template:<stepId>` existe déjà. */
  private async postOnce(guild: Guild, channel: ChannelLike, stepId: string, embeds: BilingualEmbed, placeholders: Record<string, ChannelLike | null>): Promise<string> {
    const discordChannel = await this.textChannel(guild, channel.id);
    const marker = `template:${stepId}`;
    const existing = await this.findBotMessage(discordChannel, (m) => m.embeds.some((e) => e.footer?.text?.includes(marker)));
    if (existing) return `${existing.url} (already)`;
    const specs: EmbedSpec[] = [substituteObject(embeds.fr, placeholders), substituteObject(embeds.en, placeholders)];
    const message = await discordChannel.send({ embeds: specs.map((s) => embedService.build(s, { guild })) });
    return message.url;
  }
}

export const templateService = new TemplateService();
