import { ChannelType, PermissionFlagsBits, type Guild, type GuildTextBasedChannel, type Message, type NewsChannel, type OverwriteResolvable, type Role, type TextChannel } from 'discord.js';
import { AutoRoleType, PanelStyle, type LogCategory } from '@prisma/client';
import { BRAND, DEFAULT_TEAM_ROLE_NAMES, LANGUAGE_CODES, getLanguage } from '../config/constants';
import { SERVER_TEMPLATES, getTemplate, type Bilingual, type BilingualEmbed, type ServerTemplate, type StructureCategory, type StructureCategoryAccess, type StructureChannel, type StructurePreset, type TemplateInfoMessage, type TemplateQuestion, type TemplateTicketType } from '../templates';
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
  /** Salon qui n'existe pas encore (sera créé par l'étape `structure`). */
  pending?: boolean;
}

/** Élément de la structure : salon ou catégorie à créer (`create`) ou déjà présent (`reuse`). */
export interface StructureItem {
  category: string;
  key: string;
  name: string;
  kind: 'channel' | 'category';
  status: 'create' | 'reuse';
  /** ID Discord si existant. */
  id?: string;
}

export interface PlanStep {
  id: string;
  label: StepMessage;
  status: 'ready' | 'skipped';
  reason?: StepMessage;
  targets: StepTarget[];
  /** Informations complémentaires (déjà traduites ou mentions Discord). */
  detail?: string;
  /** Étape `structure` : détail par salon. */
  items?: StructureItem[];
}

export interface ReportStep {
  id: string;
  label: StepMessage;
  status: 'done' | 'skipped' | 'failed';
  reason?: StepMessage;
  detail?: string;
  targets: StepTarget[];
  items?: StructureItem[];
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

/** Catégorie de la structure résolue : existante ou à créer, avec ses salons. */
export interface ResolvedStructureCategory {
  spec: StructureCategory;
  existing: ChannelLike | null;
  /** Catégorie existante ou virtuelle (`pending:…`). */
  channel: ChannelLike;
  channels: { spec: StructureChannel; existing: ChannelLike | null; channel: ChannelLike }[];
}

export interface ResolvedStructure {
  categories: ResolvedStructureCategory[];
  items: StructureItem[];
  /** Salons et catégories virtuels (créés par l'étape `structure`) ajoutés à la vue du serveur pour la résolution. */
  pending: ChannelLike[];
  /** Rôles (staff, admin, 🛡️ RS Team) autorisés sur les salons `staff` / `tickets`. */
  staffRoles: RoleLike[];
}

export interface PlanOptions {
  /** Créer les catégories et salons manquants de la structure (défaut : true). */
  createMissing?: boolean;
}

export interface ApplyOptions extends PlanOptions {
  dryRun?: boolean;
}

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const KIND_TYPES: Record<ChannelKind, number[]> = {
  text: TEXT_TYPES,
  category: [ChannelType.GuildCategory],
  forum: [ChannelType.GuildForum, ChannelType.GuildMedia],
  voice: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
};
const HISTORY_SCAN = 20;
const PENDING_PREFIX = 'pending:';
/** Vocaux « support » : visibles par tous mais limités à quelques participants. */
export const SUPPORT_VOICE_USER_LIMIT = 3;
const STRUCTURE_TYPES: Record<StructureChannel['type'], number> = {
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
  voice: ChannelType.GuildVoice,
  forum: ChannelType.GuildForum,
};

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

/** Vrai pour un salon virtuel (pas encore créé). */
export function isPending(channel: Pick<ChannelLike, 'id'>): boolean {
  return channel.id.startsWith(PENDING_PREFIX);
}

const P = PermissionFlagsBits;
const READ = [P.ViewChannel, P.ReadMessageHistory];
const WRITE = [...READ, P.SendMessages, P.SendMessagesInThreads, P.AttachFiles, P.EmbedLinks, P.AddReactions];
const STAFF_WRITE = [...WRITE, P.ManageMessages, P.ManageThreads];
const BOT_WRITE = [...STAFF_WRITE, P.MentionEveryone, P.ManageChannels];
const VOICE = [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD];

export interface OverwriteContext {
  everyoneId: string;
  botId: string;
  staffRoleIds: string[];
}

/**
 * Overwrites d'un salon créé par la structure, à partir de l'accès de sa catégorie et de son preset (fonction pure).
 *  - catégorie `staff` / `tickets` : @everyone ne voit rien, staff + bot voient et écrivent ;
 *  - `readonly` : @everyone lit, n'écrit pas ; staff et bot écrivent ;
 *  - `staff` : comme une catégorie staff ;
 *  - `chat` / `voice` : héritent (aucun overwrite hors catégorie staff) ;
 *  - `support-voice` : vocal visible par tous (la limite d'utilisateurs est posée à la création).
 */
export function presetOverwrites(preset: StructurePreset, access: StructureCategoryAccess, ctx: OverwriteContext): OverwriteResolvable[] {
  const staff = [...new Set(ctx.staffRoleIds)];
  const restricted = access === 'staff' || access === 'tickets' || preset === 'staff';
  if (restricted) {
    return [
      { id: ctx.everyoneId, deny: [P.ViewChannel] },
      ...staff.map((id) => ({ id, allow: preset === 'voice' || preset === 'support-voice' ? [...VOICE, ...STAFF_WRITE] : STAFF_WRITE })),
      { id: ctx.botId, allow: [...BOT_WRITE, P.Connect] },
    ];
  }
  switch (preset) {
    case 'readonly':
      return [
        { id: ctx.everyoneId, allow: READ, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] },
        ...staff.map((id) => ({ id, allow: STAFF_WRITE })),
        { id: ctx.botId, allow: BOT_WRITE },
      ];
    case 'support-voice':
      return [{ id: ctx.everyoneId, allow: VOICE }, ...staff.map((id) => ({ id, allow: [...VOICE, P.MuteMembers, P.MoveMembers] }))];
    case 'chat':
    case 'voice':
    default:
      return [];
  }
}

/** Overwrites d'une catégorie de la structure (publique : aucun ; staff / tickets : staff + bot uniquement). */
export function categoryOverwrites(access: StructureCategoryAccess, ctx: OverwriteContext): OverwriteResolvable[] {
  if (access !== 'staff' && access !== 'tickets') return [];
  return presetOverwrites('staff', access, ctx);
}

function structureKind(type: StructureChannel['type']): ChannelKind[] {
  return type === 'voice' ? ['voice'] : ['text', 'forum'];
}

/** Salon existant correspondant à un salon de la structure (nom + synonymes, texte et forum interchangeables). */
export function matchStructureChannel<T extends ChannelLike>(channels: Iterable<T>, spec: StructureChannel): T | null {
  const list = [...channels].filter((c) => structureKind(spec.type).some((k) => KIND_TYPES[k].includes(c.type)));
  return matchChannel(list, [spec.name, ...(spec.aliases ?? [])]);
}

/**
 * Résout la structure d'un modèle : pour chaque catégorie / salon, l'existant (par nom) ou un salon virtuel
 * `pending:<catégorie>/<clé>` qui sera créé par l'étape `structure`. Fonction pure.
 */
export function resolveStructure(guild: GuildLike, tpl: ServerTemplate): ResolvedStructure {
  const channels = [...guild.channels.cache.values()];
  const roles = [...guild.roles.cache.values()];
  const items: StructureItem[] = [];
  const pending: ChannelLike[] = [];
  const categories: ResolvedStructureCategory[] = tpl.structure.categories.map((spec) => {
    const existing = matchChannel(channels, [spec.name, ...(spec.aliases ?? [])], 'category');
    const channel: ChannelLike = existing ?? { id: `${PENDING_PREFIX}cat:${spec.key}`, name: spec.name, type: ChannelType.GuildCategory };
    if (!existing) pending.push(channel);
    items.push({ category: spec.name, key: spec.key, name: spec.name, kind: 'category', status: existing ? 'reuse' : 'create', id: existing?.id });
    const list = spec.roleAccess === 'languages' ? [] : spec.channels;
    return {
      spec,
      existing,
      channel,
      channels: list.map((c) => {
        const found = matchStructureChannel(channels, c);
        const ch: ChannelLike = found ?? { id: `${PENDING_PREFIX}${spec.key}/${c.key}`, name: c.name, type: c.type === 'announcement' ? ChannelType.GuildText : STRUCTURE_TYPES[c.type], parentId: channel.id };
        if (!found) pending.push(ch);
        items.push({ category: spec.name, key: c.key, name: c.name, kind: 'channel', status: found ? 'reuse' : 'create', id: found?.id });
        return { spec: c, existing: found, channel: ch };
      }),
    };
  });
  const staffRoles = [...matchRoles(roles, tpl.adminRoleNames), ...matchRoles(roles, tpl.staffRoleNames), ...matchRoles(roles, DEFAULT_TEAM_ROLE_NAMES)].filter((r, i, arr) => arr.indexOf(r) === i);
  return { categories, items, pending, staffRoles };
}

/** Vue du serveur enrichie des salons virtuels de la structure (pour résoudre les étapes suivantes). */
export function withPendingChannels(guild: GuildLike, pending: ChannelLike[]): GuildLike {
  if (!pending.length) return guild;
  const cache = new Map<string, ChannelLike>(guild.channels.cache);
  for (const c of pending) cache.set(c.id, c);
  return { ...guild, channels: { cache } };
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
  return isPending(x) ? { kind, id: x.id, name: x.name, pending: true } : { kind, id: x.id, name: x.name };
}

/** Mention d'un salon (`<#id>`), ou `🆕 #nom` pour un salon virtuel. */
export function channelMention(c: ChannelLike | null | undefined): string {
  if (!c) return '—';
  return isPending(c) ? `🆕 #${c.name}` : `<#${c.id}>`;
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
      info: tpl.infoMessages.map((message) => ({ message, channel: text(message.channelNames) })).filter((i) => i.channel || !i.message.optional),
      recommended: Object.entries(tpl.recommended).map(([key, names]) => ({ key, channel: text(names) })),
    };
  }

  // ───── Plan ─────

  /**
   * Liste les étapes résolues (✅ prête / ⚠️ ignorée + raison) sans rien modifier.
   * Avec `createMissing` (défaut), la structure du modèle est résolue en premier et les salons manquants sont
   * ajoutés comme salons virtuels (`🆕`) à la résolution : les étapes suivantes les trouvent.
   */
  async plan(guild: GuildLike, templateKey: string, opts: PlanOptions = {}): Promise<{ template: ServerTemplate; steps: PlanStep[]; resolution: Resolution; structure: ResolvedStructure | null }> {
    const tpl = getTemplate(templateKey);
    if (!tpl) throw new Error(`Unknown template: ${templateKey}`);
    const createMissing = opts.createMissing ?? true;
    const structure = createMissing ? resolveStructure(guild, tpl) : null;
    const r = this.resolve(structure ? withPendingChannels(guild, structure.pending) : guild, tpl);
    const steps: PlanStep[] = [];
    const notFound = (names: readonly string[]): StepMessage => ({ key: 'channel_not_found', vars: { names: names.slice(0, 3).join(', ') } });
    const channelStep = (id: string, label: StepMessage, channel: ChannelLike | null, names: readonly string[], detail?: string): PlanStep =>
      channel ? { id, label, status: 'ready', targets: [target('channel', channel)], detail } : { id, label, status: 'skipped', reason: notFound(names), targets: [] };

    steps.push({ id: 'kind', label: { key: 'kind' }, status: 'ready', targets: [], detail: `${tpl.kind} · ${tpl.enabledLanguages.map((c) => getLanguage(c)?.flag ?? c).join(' ')}` });
    if (structure) {
      steps.push({
        id: 'structure',
        label: { key: 'structure' },
        status: 'ready',
        targets: structure.items.filter((i) => i.status === 'reuse' && i.id).map((i) => ({ kind: i.kind, id: i.id!, name: i.name })),
        items: structure.items,
      });
    }

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
        ? { id: 'logs', label: { key: 'logs' }, status: 'ready', targets: r.logs.map((l) => target('channel', l.channel)), detail: r.logs.map((l) => `${l.category} → ${channelMention(l.channel)}`).join('\n') + (r.logsMissing.length ? `\n⚠️ ${r.logsMissing.join(', ')}` : '') }
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
      detail: r.tickets.map((t) => `${t.type.emoji} ${t.type.label.fr} → ${t.category ? channelMention(t.category) : t.type.createCategoryName ? `➕ ${t.type.createCategoryName}` : '—'}`).join('\n'),
    });
    steps.push(channelStep('ticket_panel', { key: 'ticket_panel' }, r.ticketPanelChannel, tpl.tickets.panel.channelNames));

    const langDetail = Object.entries(r.languageChannels).map(([code, ch]) => `${getLanguage(code)?.flag ?? code} ${channelMention(ch)}`).join(' ');
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
    return { template: tpl, steps, resolution: r, structure };
  }

  // ───── Application ─────

  /**
   * Applique un modèle. Ordre : `kind`, puis `structure` (création des salons manquants, si `createMissing`),
   * puis re-résolution sur les salons réels et exécution des autres étapes. Une étape en échec n'interrompt pas les suivantes.
   */
  async apply(guild: Guild, templateKey: string, actorId: string, opts: ApplyOptions = {}): Promise<TemplateReport> {
    const createMissing = opts.createMissing ?? true;
    const planned = await this.plan(guild, templateKey, { createMissing });
    const tpl = planned.template;
    const report: TemplateReport = { template: tpl, dryRun: !!opts.dryRun, steps: [], recommended: planned.resolution.recommended };
    const toReport = (s: PlanStep): ReportStep => ({ id: s.id, label: s.label, status: s.status === 'ready' ? 'done' : 'skipped', reason: s.reason, detail: s.detail, targets: s.targets, items: s.items });
    if (opts.dryRun) {
      report.steps = planned.steps.map(toReport);
      return report;
    }
    await guildConfigService.getOrCreate(guild);

    let steps = planned.steps;
    let r = planned.resolution;
    const head = steps.filter((s) => s.id === 'kind' || s.id === 'structure');
    for (const step of head) await this.execute(report, step, guild, tpl, r, actorId, planned.structure);
    if (planned.structure) {
      // Les salons créés (ou non, faute de permissions) sont désormais dans le cache : re-résolution sur l'existant.
      const replanned = await this.plan(guild, templateKey, { createMissing: false });
      steps = replanned.steps;
      r = replanned.resolution;
      report.recommended = r.recommended;
    }
    for (const step of steps.filter((s) => s.id !== 'kind' && s.id !== 'structure')) await this.execute(report, step, guild, tpl, r, actorId, null);
    log.info({ guild: guild.id, template: tpl.key, actorId, done: report.steps.filter((s) => s.status === 'done').length, failed: report.steps.filter((s) => s.status === 'failed').length }, 'Template appliqué');
    return report;
  }

  private async execute(report: TemplateReport, step: PlanStep, guild: Guild, tpl: ServerTemplate, r: Resolution, actorId: string, structure: ResolvedStructure | null): Promise<void> {
    if (step.status === 'skipped') {
      report.steps.push({ id: step.id, label: step.label, status: 'skipped', reason: step.reason, targets: step.targets });
      return;
    }
    try {
      if (step.id === 'structure') {
        const result = await this.applyStructure(guild, tpl, structure!);
        report.steps.push({ id: step.id, label: step.label, status: 'done', targets: result.items.filter((i) => i.id).map((i) => ({ kind: i.kind, id: i.id!, name: i.name })), items: result.items });
        return;
      }
      const detail = await this.run(step.id, guild, tpl, r, actorId);
      report.steps.push({ id: step.id, label: step.label, status: 'done', detail: detail ?? step.detail, targets: step.targets });
    } catch (err) {
      log.warn({ err, guild: guild.id, step: step.id, template: tpl.key }, 'Étape de template en échec');
      const code = (err as { code?: number }).code;
      report.steps.push({ id: step.id, label: step.label, status: 'failed', reason: { key: code === 50013 ? 'missing_permissions' : 'error', vars: { message: (err as Error).message?.slice(0, 200) ?? '' } }, targets: step.targets, items: step.items });
    }
  }

  /**
   * Étape `structure` : crée les catégories et salons manquants (overwrites du preset, topic FR/EN, limite des vocaux support).
   * Les salons existants sont réutilisés tels quels (ni déplacés ni modifiés). Exige ManageChannels pour le bot.
   */
  private async applyStructure(guild: Guild, tpl: ServerTemplate, structure: ResolvedStructure): Promise<{ items: StructureItem[]; created: number; reused: number }> {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      const err = new Error('Manage Channels') as Error & { code: number };
      err.code = 50013;
      throw err;
    }
    const community = guild.features.includes('COMMUNITY');
    const ctx: OverwriteContext = { everyoneId: guild.roles.everyone.id, botId: me.id, staffRoleIds: structure.staffRoles.map((x) => x.id).filter((id) => guild.roles.cache.has(id)) };
    const reason = `Redemption Story — template ${tpl.key}`;
    const items: StructureItem[] = [];
    let created = 0;
    let reused = 0;
    for (const cat of structure.categories) {
      let categoryId = cat.existing?.id ?? null;
      if (!categoryId) {
        const category = await guild.channels.create({ name: cat.spec.name, type: ChannelType.GuildCategory, permissionOverwrites: categoryOverwrites(cat.spec.roleAccess, ctx), reason });
        categoryId = category.id;
        created++;
      } else reused++;
      items.push({ category: cat.spec.name, key: cat.spec.key, name: cat.spec.name, kind: 'category', status: cat.existing ? 'reuse' : 'create', id: categoryId });
      for (const { spec, existing } of cat.channels) {
        if (existing) {
          reused++;
          items.push({ category: cat.spec.name, key: spec.key, name: spec.name, kind: 'channel', status: 'reuse', id: existing.id });
          continue;
        }
        const topic = spec.topic ? [spec.topic.fr, spec.topic.en].filter((x, i, a) => x && a.indexOf(x) === i).join(' | ').slice(0, 1024) : undefined;
        const overwrites = presetOverwrites(spec.preset, cat.spec.roleAccess, ctx);
        const base = { name: spec.name, parent: categoryId, permissionOverwrites: overwrites, reason };
        let channel;
        if (spec.type === 'voice') channel = await guild.channels.create({ ...base, type: ChannelType.GuildVoice, ...(spec.preset === 'support-voice' ? { userLimit: SUPPORT_VOICE_USER_LIMIT } : {}) });
        else if (spec.type === 'forum' && community) channel = await guild.channels.create({ ...base, type: ChannelType.GuildForum, topic });
        else if (spec.type === 'announcement' && community) channel = await guild.channels.create({ ...base, type: ChannelType.GuildAnnouncement, topic });
        else channel = await guild.channels.create({ ...base, type: ChannelType.GuildText, topic });
        created++;
        items.push({ category: cat.spec.name, key: spec.key, name: spec.name, kind: 'channel', status: 'create', id: channel.id });
      }
    }
    log.info({ guild: guild.id, template: tpl.key, created, reused }, 'Structure du template déployée');
    return { items, created, reused };
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
