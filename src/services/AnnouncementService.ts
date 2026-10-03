import type { Client, Message, MessageCreateOptions } from 'discord.js';
import { AnnouncementStatus, ScheduleStatus, type Announcement, type Prisma, type ScheduledAnnouncement } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { buttonSpecSchema, colorToHex, embedService, embedSpecSchema, type ButtonSpec, type EmbedSpec, type MessageSpec } from './EmbedService';
import { guildConfigService, type ResolvedGuildConfig } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { translationService } from './TranslationService';
import { machineTranslationService, sha256, TranslationUnavailableError } from './MachineTranslationService';
import { LANGUAGE_CODES, getLanguage } from '../config/constants';
import type { TemplateContext } from '../utils/variables';
import { discordTimestamp } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('AnnouncementService');

// ───────────────────────── Types & schémas ─────────────────────────

/**
 * Traduction d'une annonce : un EmbedSpec partiel (seules les clés définies remplacent la langue source)
 * + un `content` optionnel (texte au-dessus de l'embed).
 * `auto: true` marque une traduction générée automatiquement (régénérée quand `sourceHash` ne correspond
 * plus au texte source) ; une traduction saisie à la main n'a pas ce marqueur et n'est jamais écrasée.
 */
export const announcementTranslationSchema = embedSpecSchema.extend({
  content: z.string().max(2000).optional(),
  auto: z.boolean().optional(),
  sourceHash: z.string().max(64).optional(),
});
export type AnnouncementTranslation = z.infer<typeof announcementTranslationSchema>;
/** { lang: AnnouncementTranslation } */
export const announcementTranslationsSchema = z.record(z.string().min(2).max(8), announcementTranslationSchema);
export type AnnouncementTranslations = z.infer<typeof announcementTranslationsSchema>;

export const announcementMessageRefSchema = z.object({ channelId: z.string(), messageId: z.string(), language: z.string() });
export type AnnouncementMessageRef = z.infer<typeof announcementMessageRefSchema>;

export const targetLanguagesSchema = z.union([z.literal('*'), z.array(z.string().min(2).max(8))]);
export type TargetLanguages = z.infer<typeof targetLanguagesSchema>;

export interface AnnouncementInput {
  title?: string;
  content?: string | null;
  spec: EmbedSpec;
  translations?: AnnouncementTranslations;
  sourceLanguage?: string;
  targetLanguages?: TargetLanguages;
  channelId?: string | null;
  mentionRoleIds?: string[];
  mentionEveryone?: boolean;
  buttons?: ButtonSpec[];
}

/** Ligne Announcement avec ses colonnes JSON typées. */
export interface AnnouncementData {
  id: number;
  guildId: string;
  title: string;
  content: string | null;
  spec: EmbedSpec;
  translations: AnnouncementTranslations;
  sourceLanguage: string;
  targetLanguages: TargetLanguages;
  channelId: string | null;
  mentionRoleIds: string[];
  mentionEveryone: boolean;
  buttons: ButtonSpec[];
  status: AnnouncementStatus;
  messages: AnnouncementMessageRef[];
  createdById: string;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AnnouncementErrorCode = 'not_found' | 'already_published' | 'no_channel' | 'no_targets' | 'send_failed' | 'invalid_status' | 'no_client' | 'invalid_spec' | 'past_date';

export class AnnouncementError extends Error {
  constructor(
    public readonly code: AnnouncementErrorCode,
    public readonly details?: string,
  ) {
    super(`${code}${details ? `: ${details}` : ''}`);
    this.name = 'AnnouncementError';
  }
}

export interface PublicationItem {
  channelId: string;
  /** Langue du contenu envoyé */
  language: string;
  /** Langues « couvertes » par ce message (ex. langues sans salon dédié → message source) */
  coveredLanguages: string[];
  /** Préfixer le message par le drapeau / libellé de la langue (mode PERMISSIONS) */
  languageHeader: boolean;
  /** Inclure les mentions (@everyone / rôles) dans ce message */
  includeMentions: boolean;
}

export interface RenderOptions {
  languageHeader?: boolean;
  includeMentions?: boolean;
}

// ───────────────────────── Fonctions pures ─────────────────────────

function safeArray<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S>[] {
  const r = z.array(schema).safeParse(value);
  return r.success ? (r.data as z.infer<S>[]) : [];
}

/** Applique la couleur par défaut du serveur si l'embed n'en définit pas. */
export function withDefaultColor(spec: EmbedSpec, brandColor: number | undefined): EmbedSpec {
  if (spec.color || brandColor === undefined) return spec;
  return { ...spec, color: colorToHex(brandColor) };
}

/** Construit le message Discord d'un MessageSpec en appliquant la couleur par défaut du serveur. */
export function buildMessageWithBrand(spec: MessageSpec, ctx: TemplateContext, brandColor: number | undefined) {
  return embedService.buildMessage({ ...spec, embeds: (spec.embeds ?? []).map((e) => withDefaultColor(e, brandColor)) }, ctx);
}

export function parseAnnouncement(row: Announcement): AnnouncementData {
  const spec = embedSpecSchema.safeParse(row.spec);
  const translations = announcementTranslationsSchema.safeParse(row.translations);
  const targets = targetLanguagesSchema.safeParse(row.targetLanguages);
  return {
    id: row.id,
    guildId: row.guildId,
    title: row.title,
    content: row.content,
    spec: spec.success ? spec.data : {},
    translations: translations.success ? translations.data : {},
    sourceLanguage: row.sourceLanguage,
    targetLanguages: targets.success ? (targets.data.length === 0 ? '*' : targets.data) : '*',
    channelId: row.channelId,
    mentionRoleIds: safeArray(z.string(), row.mentionRoleIds),
    mentionEveryone: row.mentionEveryone,
    buttons: safeArray(buttonSpecSchema, row.buttons),
    status: row.status,
    messages: safeArray(announcementMessageRefSchema, row.messages),
    createdById: row.createdById,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Langues cibles effectives : '*' → toutes les langues activées ; sinon la liste filtrée sur les langues
 * activées. La langue source est toujours incluse. Ordre = ordre de LANGUAGES (source en premier).
 */
export function resolveTargetLanguages(ann: { targetLanguages: TargetLanguages; sourceLanguage: string }, enabledLanguages: string[]): string[] {
  const enabled = enabledLanguages.length ? enabledLanguages : [ann.sourceLanguage];
  const wanted = ann.targetLanguages === '*' ? enabled : ann.targetLanguages.filter((l) => enabled.includes(l));
  const set = new Set<string>([ann.sourceLanguage, ...wanted]);
  const ordered = LANGUAGE_CODES.filter((c) => set.has(c));
  for (const c of set) if (!ordered.includes(c)) ordered.push(c);
  return [ann.sourceLanguage, ...ordered.filter((c) => c !== ann.sourceLanguage)];
}

/** Une traduction est « présente » si elle définit au moins un titre, une description ou un contenu. */
export function hasTranslation(ann: { translations: AnnouncementTranslations }, lang: string): boolean {
  const tr = ann.translations[lang];
  return !!tr && (!!tr.title || !!tr.description || !!tr.content || !!(tr.fields && tr.fields.length));
}

/**
 * Résout le contenu à envoyer pour une langue : clés définies dans la traduction → sinon langue source.
 * `translated` indique si une traduction a été appliquée.
 */
export function resolveTranslation(ann: { spec: EmbedSpec; content?: string | null; translations: AnnouncementTranslations; sourceLanguage: string }, lang: string): { spec: EmbedSpec; content: string | undefined; translated: boolean } {
  const base = { spec: ann.spec, content: ann.content ?? undefined, translated: false };
  if (lang === ann.sourceLanguage) return base;
  const tr = ann.translations[lang];
  if (!tr || !hasTranslation(ann, lang)) return base;
  const { content, auto: _auto, sourceHash: _hash, ...specPatch } = tr;
  const merged: EmbedSpec = { ...ann.spec };
  for (const [k, v] of Object.entries(specPatch)) if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  return { spec: merged, content: content ?? ann.content ?? undefined, translated: true };
}

export type TranslationKind = 'manual' | 'auto' | 'missing';

/** État d'une traduction : saisie à la main, générée automatiquement, ou absente. */
export function translationKind(ann: { translations: AnnouncementTranslations }, lang: string): TranslationKind {
  if (!hasTranslation(ann, lang)) return 'missing';
  return ann.translations[lang]?.auto ? 'auto' : 'manual';
}

/** Empreinte des textes traduisibles de la langue source (titre, description, contenu, champs, footer, auteur). */
export function sourceContentHash(ann: { spec: EmbedSpec; content?: string | null }): string {
  const s = ann.spec;
  return sha256(JSON.stringify([s.title ?? '', s.description ?? '', ann.content ?? '', s.footer?.text ?? '', s.author?.name ?? '', (s.fields ?? []).map((f) => [f.name, f.value])]));
}

/**
 * Une traduction automatique doit être (re)générée si la langue n'a aucune traduction, ou si sa traduction
 * est automatique et que la source a changé depuis (`sourceHash` différent). Une traduction manuelle
 * n'est jamais régénérée.
 */
export function needsAutoTranslation(ann: { translations: AnnouncementTranslations }, lang: string, hash: string): boolean {
  const kind = translationKind(ann, lang);
  if (kind === 'missing') return true;
  if (kind === 'manual') return false;
  return ann.translations[lang]?.sourceHash !== hash;
}

/**
 * Insère une traduction générée dans la map sans jamais écraser une traduction manuelle.
 * Retourne une nouvelle map (fonction pure).
 */
export function applyAutoTranslation(translations: AnnouncementTranslations, lang: string, generated: Omit<AnnouncementTranslation, 'auto' | 'sourceHash'>, hash: string): AnnouncementTranslations {
  if (translationKind({ translations }, lang) === 'manual') return translations;
  return { ...translations, [lang]: { ...generated, auto: true, sourceHash: hash } };
}

/** Patch de traduction (titre, description, champs, footer, auteur, contenu) extrait d'un spec traduit. */
export function translationPatch(translated: EmbedSpec, source: EmbedSpec, content: string | undefined): Omit<AnnouncementTranslation, 'auto' | 'sourceHash'> {
  const patch: Omit<AnnouncementTranslation, 'auto' | 'sourceHash'> = {};
  if (source.title !== undefined && translated.title) patch.title = translated.title;
  if (source.description !== undefined && translated.description) patch.description = translated.description;
  if (source.fields?.length && translated.fields?.length) patch.fields = translated.fields;
  if (source.footer && translated.footer) patch.footer = translated.footer;
  if (source.author && translated.author) patch.author = translated.author;
  if (content) patch.content = content;
  return patch;
}

/**
 * Répartition des messages à envoyer selon le mode multilingue du serveur.
 *
 *  - CHANNELS : chaque langue cible disposant d'un salon dans `config.languageChannels` reçoit sa version
 *    dans ce salon ; les langues sans salon dédié sont couvertes par UN message dans `channelId`
 *    (langue source).
 *  - PERMISSIONS : un message par langue cible dans `channelId`, chacun préfixé par le drapeau / libellé
 *    de la langue. Discord ne permet pas de masquer un message à certains rôles au sein d'un même salon :
 *    ce mode repose donc soit sur l'affichage multi-messages (tout le monde voit toutes les langues),
 *    soit sur une configuration côté serveur où `channelId` est un salon visible uniquement du rôle
 *    langue correspondant (un salon par rôle langue, chacun configuré comme salon d'annonce).
 *
 * Fonction pure : aucune I/O, testable unitairement.
 */
export function planPublication(
  ann: { channelId: string | null; sourceLanguage: string; targetLanguages: TargetLanguages },
  config: Pick<ResolvedGuildConfig, 'translationMode' | 'languageChannels' | 'enabledLanguages'>,
): PublicationItem[] {
  const targets = resolveTargetLanguages(ann, config.enabledLanguages);
  const items: PublicationItem[] = [];

  if (config.translationMode === 'PERMISSIONS') {
    if (!ann.channelId) return items;
    targets.forEach((lang, i) => items.push({ channelId: ann.channelId!, language: lang, coveredLanguages: [lang], languageHeader: targets.length > 1, includeMentions: i === 0 }));
    return items;
  }

  const uncovered: string[] = [];
  for (const lang of targets) {
    const channel = config.languageChannels[lang];
    if (channel) items.push({ channelId: channel, language: lang, coveredLanguages: [lang], languageHeader: false, includeMentions: true });
    else uncovered.push(lang);
  }
  if (uncovered.length && ann.channelId) {
    const duplicate = items.find((i) => i.channelId === ann.channelId && i.language === ann.sourceLanguage);
    if (duplicate) duplicate.coveredLanguages.push(...uncovered.filter((l) => !duplicate.coveredLanguages.includes(l)));
    else items.push({ channelId: ann.channelId, language: ann.sourceLanguage, coveredLanguages: uncovered, languageHeader: false, includeMentions: true });
  }
  return items;
}

/** Ligne de mentions (@everyone + rôles) placée au-dessus de l'embed. */
export function mentionLine(ann: { mentionEveryone: boolean; mentionRoleIds: string[] }): string {
  return [ann.mentionEveryone ? '@everyone' : null, ...ann.mentionRoleIds.map((r) => `<@&${r}>`)].filter(Boolean).join(' ');
}

/** En-tête de langue (mode PERMISSIONS) : drapeau + libellé natif, traduit dans la langue concernée. */
export function languageHeader(lang: string, guildId?: string | null): string {
  const def = getLanguage(lang);
  return translationService.translate(lang, 'announcements.language_header', { flag: def?.flag ?? '🌐', language: def?.nativeLabel ?? lang }, guildId);
}

/**
 * Construit le MessageSpec (non rendu : variables `{server}`… intactes) d'une annonce pour une langue.
 */
export function renderAnnouncement(ann: AnnouncementData, lang: string, opts: RenderOptions = {}): MessageSpec {
  const resolved = resolveTranslation(ann, lang);
  const parts: string[] = [];
  if (opts.languageHeader) parts.push(languageHeader(lang, ann.guildId));
  if (opts.includeMentions ?? true) {
    const m = mentionLine(ann);
    if (m) parts.push(m);
  }
  if (resolved.content) parts.push(resolved.content);
  const content = parts.join('\n').slice(0, 2000);
  return { content: content || undefined, embeds: [resolved.spec], buttons: ann.buttons.length ? ann.buttons : undefined };
}

/** Une programmation est due si elle est PENDING et que sa date est passée. */
export function isScheduleDue(schedule: Pick<ScheduledAnnouncement, 'status' | 'scheduledAt'>, now: Date = new Date()): boolean {
  return schedule.status === ScheduleStatus.PENDING && schedule.scheduledAt.getTime() <= now.getTime();
}

// ───────────────────────── Service ─────────────────────────

export interface ListOptions {
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  items: AnnouncementData[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export class AnnouncementService {
  private client: Client | null = null;

  attach(client: Client): void {
    this.client = client;
  }

  private requireClient(): Client {
    if (!this.client) throw new AnnouncementError('no_client');
    return this.client;
  }

  private toJson(input: Partial<AnnouncementInput>): Prisma.AnnouncementUncheckedUpdateInput {
    const data: Prisma.AnnouncementUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title.trim().slice(0, 190);
    if (input.content !== undefined) data.content = input.content ? input.content.slice(0, 2000) : null;
    if (input.spec !== undefined) {
      const r = embedSpecSchema.safeParse(input.spec);
      if (!r.success) throw new AnnouncementError('invalid_spec', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      data.spec = r.data as Prisma.InputJsonValue;
    }
    if (input.translations !== undefined) {
      const r = announcementTranslationsSchema.safeParse(input.translations);
      if (!r.success) throw new AnnouncementError('invalid_spec', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      data.translations = r.data as Prisma.InputJsonValue;
    }
    if (input.sourceLanguage !== undefined) data.sourceLanguage = input.sourceLanguage;
    if (input.targetLanguages !== undefined) data.targetLanguages = (input.targetLanguages === '*' ? '*' : input.targetLanguages) as Prisma.InputJsonValue;
    if (input.channelId !== undefined) data.channelId = input.channelId;
    if (input.mentionRoleIds !== undefined) data.mentionRoleIds = input.mentionRoleIds as Prisma.InputJsonValue;
    if (input.mentionEveryone !== undefined) data.mentionEveryone = input.mentionEveryone;
    if (input.buttons !== undefined) {
      const r = z.array(buttonSpecSchema).max(25).safeParse(input.buttons);
      if (!r.success) throw new AnnouncementError('invalid_spec', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      data.buttons = r.data as Prisma.InputJsonValue;
    }
    return data;
  }

  private async t(guildId: string) {
    const cfg = await guildConfigService.get(guildId);
    return translationService.bind(cfg?.defaultLanguage ?? 'fr', guildId);
  }

  // ───── CRUD ─────

  async list(guildId: string, status?: AnnouncementStatus, opts: ListOptions = {}): Promise<ListResult> {
    const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 50);
    const where: Prisma.AnnouncementWhereInput = { guildId, ...(status ? { status } : {}) };
    const total = await prisma.announcement.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(opts.page ?? 1, 1), pages);
    const rows = await prisma.announcement.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize });
    return { items: rows.map(parseAnnouncement), total, page, pageSize, pages };
  }

  /** Recherche rapide (autocomplete) : titre contenant `query`. */
  async search(guildId: string, query: string, limit = 25): Promise<AnnouncementData[]> {
    const rows = await prisma.announcement.findMany({
      where: { guildId, ...(query ? { title: { contains: query } } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
    });
    return rows.map(parseAnnouncement);
  }

  async get(id: number): Promise<AnnouncementData | null> {
    const row = await prisma.announcement.findUnique({ where: { id } });
    return row ? parseAnnouncement(row) : null;
  }

  private async require(id: number): Promise<AnnouncementData> {
    const ann = await this.get(id);
    if (!ann) throw new AnnouncementError('not_found', String(id));
    return ann;
  }

  async create(guildId: string, data: AnnouncementInput, createdById: string): Promise<AnnouncementData> {
    const json = this.toJson(data);
    const row = await prisma.announcement.create({
      data: {
        guildId,
        createdById,
        title: (json.title as string | undefined) ?? data.spec.title?.slice(0, 190) ?? '',
        content: (json.content as string | null | undefined) ?? null,
        spec: (json.spec as Prisma.InputJsonValue | undefined) ?? ({} as Prisma.InputJsonValue),
        translations: (json.translations as Prisma.InputJsonValue | undefined) ?? {},
        sourceLanguage: data.sourceLanguage ?? 'fr',
        targetLanguages: (json.targetLanguages as Prisma.InputJsonValue | undefined) ?? '*',
        channelId: data.channelId ?? null,
        mentionRoleIds: data.mentionRoleIds ?? [],
        mentionEveryone: data.mentionEveryone ?? false,
        buttons: (json.buttons as Prisma.InputJsonValue | undefined) ?? [],
      },
    });
    return parseAnnouncement(row);
  }

  /**
   * Met à jour une annonce. Si elle est publiée et `sync` (défaut true), chaque message Discord
   * enregistré est ré-édité avec le nouveau contenu dans sa langue.
   */
  async update(id: number, data: Partial<AnnouncementInput>, opts: { actorId?: string; sync?: boolean } = {}): Promise<AnnouncementData> {
    const current = await this.require(id);
    const row = await prisma.announcement.update({ where: { id }, data: this.toJson(data) });
    let ann = parseAnnouncement(row);
    if ((opts.sync ?? true) && current.status === AnnouncementStatus.PUBLISHED && ann.messages.length) {
      ann = await this.syncMessages(ann, opts.actorId);
    }
    return ann;
  }

  /** Ré-édite tous les messages publiés d'une annonce avec son contenu actuel. */
  async syncMessages(ann: AnnouncementData, actorId?: string, opts: { autoTranslate?: boolean } = {}): Promise<AnnouncementData> {
    const client = this.requireClient();
    const config = await guildConfigService.get(ann.guildId);
    if (config && (opts.autoTranslate ?? true)) ann = (await this.ensureAutoTranslations(ann, config)).ann;
    const guild = client.guilds.cache.get(ann.guildId) ?? null;
    const multi = ann.messages.length > 1 && config?.translationMode === 'PERMISSIONS';
    let edited = 0;
    const kept: AnnouncementMessageRef[] = [];
    for (const [index, ref] of ann.messages.entries()) {
      const message = await this.fetchMessage(ref).catch(() => null);
      if (!message) continue;
      const spec = renderAnnouncement(ann, ref.language, { languageHeader: multi, includeMentions: !multi || index === 0 });
      const built = buildMessageWithBrand(spec, this.templateContext(guild, ref.language), config?.brandColor);
      await message
        .edit({ content: built.content || null, embeds: built.embeds, components: built.components, allowedMentions: this.allowedMentions(ann) })
        .then(() => {
          edited++;
          kept.push(ref);
        })
        .catch((err) => log.warn({ err, ref }, 'Édition d’un message d’annonce impossible'));
    }
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.update',
      title: t('announcements.log.updated_title'),
      description: t('announcements.log.updated_desc', { id: ann.id, title: ann.title, count: edited }),
      actorId,
      targetId: String(ann.id),
    });
    return ann;
  }

  async delete(id: number, actorId?: string): Promise<void> {
    const ann = await this.require(id);
    let deleted = 0;
    for (const ref of ann.messages) {
      const message = await this.fetchMessage(ref).catch(() => null);
      if (message) await message.delete().then(() => deleted++).catch((err) => log.warn({ err, ref }, 'Suppression message annonce impossible'));
    }
    await prisma.announcement.delete({ where: { id } });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.delete',
      title: t('announcements.log.deleted_title'),
      description: t('announcements.log.deleted_desc', { id: ann.id, title: ann.title, count: deleted }),
      actorId,
      targetId: String(ann.id),
    });
  }

  /** Copie une annonce en brouillon (sans messages ni programmation). */
  async duplicate(id: number, actorId: string): Promise<AnnouncementData> {
    const ann = await this.require(id);
    const t = await this.t(ann.guildId);
    const row = await prisma.announcement.create({
      data: {
        guildId: ann.guildId,
        createdById: actorId,
        title: `${ann.title} ${t('announcements.duplicate_suffix')}`.slice(0, 190),
        content: ann.content,
        spec: ann.spec as Prisma.InputJsonValue,
        translations: ann.translations as Prisma.InputJsonValue,
        sourceLanguage: ann.sourceLanguage,
        targetLanguages: ann.targetLanguages as Prisma.InputJsonValue,
        channelId: ann.channelId,
        mentionRoleIds: ann.mentionRoleIds,
        mentionEveryone: ann.mentionEveryone,
        buttons: ann.buttons as Prisma.InputJsonValue,
        status: AnnouncementStatus.DRAFT,
        messages: [],
      },
    });
    return parseAnnouncement(row);
  }

  /** Archive : conserve les messages publiés, annule toute programmation en attente. */
  async archive(id: number, actorId?: string): Promise<AnnouncementData> {
    const ann = await this.require(id);
    await prisma.scheduledAnnouncement.updateMany({ where: { announcementId: id, status: ScheduleStatus.PENDING }, data: { status: ScheduleStatus.CANCELLED } });
    const row = await prisma.announcement.update({ where: { id }, data: { status: AnnouncementStatus.ARCHIVED, archivedAt: new Date() } });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.archive',
      title: t('announcements.log.archived_title'),
      description: t('announcements.log.archived_desc', { id: ann.id, title: ann.title }),
      actorId,
      targetId: String(ann.id),
    });
    return parseAnnouncement(row);
  }

  // ───── Programmation ─────

  getPendingSchedule(id: number): Promise<ScheduledAnnouncement | null> {
    return prisma.scheduledAnnouncement.findFirst({ where: { announcementId: id, status: ScheduleStatus.PENDING }, orderBy: { scheduledAt: 'asc' } });
  }

  async schedule(id: number, date: Date, actorId?: string): Promise<ScheduledAnnouncement> {
    const ann = await this.require(id);
    if (ann.status === AnnouncementStatus.PUBLISHED) throw new AnnouncementError('already_published', String(id));
    if (date.getTime() <= Date.now()) throw new AnnouncementError('past_date');
    const config = await guildConfigService.get(ann.guildId);
    if (config && planPublication(ann, config).length === 0) throw new AnnouncementError('no_channel');
    await prisma.scheduledAnnouncement.updateMany({ where: { announcementId: id, status: ScheduleStatus.PENDING }, data: { status: ScheduleStatus.CANCELLED } });
    const schedule = await prisma.scheduledAnnouncement.create({ data: { announcementId: id, scheduledAt: date } });
    await prisma.announcement.update({ where: { id }, data: { status: AnnouncementStatus.SCHEDULED } });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: 'announcement.schedule',
      title: t('announcements.log.scheduled_title'),
      description: t('announcements.log.scheduled_desc', { id: ann.id, title: ann.title, date: discordTimestamp(date, 'F') }),
      actorId,
      targetId: String(ann.id),
    });
    return schedule;
  }

  /** Annule les programmations en attente ; l'annonce repasse en brouillon si elle n'est pas publiée. */
  async cancelSchedule(id: number): Promise<number> {
    const ann = await this.require(id);
    const r = await prisma.scheduledAnnouncement.updateMany({ where: { announcementId: id, status: ScheduleStatus.PENDING }, data: { status: ScheduleStatus.CANCELLED } });
    if (ann.status === AnnouncementStatus.SCHEDULED) await prisma.announcement.update({ where: { id }, data: { status: AnnouncementStatus.DRAFT } });
    return r.count;
  }

  /** Publie les programmations dues. Appelé par la tâche `announcements:scheduled`. */
  async processDue(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const due = await prisma.scheduledAnnouncement.findMany({ where: { status: ScheduleStatus.PENDING, scheduledAt: { lte: now } }, include: { announcement: true }, take: 20, orderBy: { scheduledAt: 'asc' } });
    let sent = 0;
    let failed = 0;
    for (const schedule of due) {
      if (!isScheduleDue(schedule, now)) continue;
      try {
        await this.publish(schedule.announcementId, { actorId: schedule.announcement.createdById, scheduled: true });
        await prisma.scheduledAnnouncement.update({ where: { id: schedule.id }, data: { status: ScheduleStatus.SENT, sentAt: new Date() } });
        sent++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, scheduleId: schedule.id, announcementId: schedule.announcementId }, 'Publication programmée en échec');
        await prisma.scheduledAnnouncement.update({ where: { id: schedule.id }, data: { status: ScheduleStatus.FAILED, error: message.slice(0, 2000) } }).catch(() => null);
        await prisma.announcement.updateMany({ where: { id: schedule.announcementId, status: AnnouncementStatus.SCHEDULED }, data: { status: AnnouncementStatus.DRAFT } }).catch(() => null);
        const t = await this.t(schedule.announcement.guildId);
        await loggingService.log({
          guildId: schedule.announcement.guildId,
          category: 'ANNOUNCEMENT',
          action: 'announcement.schedule_failed',
          title: t('announcements.log.failed_title'),
          description: t('announcements.log.failed_desc', { id: schedule.announcementId, title: schedule.announcement.title, error: message.slice(0, 500) }),
          color: 0xef4444,
          targetId: String(schedule.announcementId),
        });
      }
    }
    return { sent, failed };
  }

  // ───── Traduction automatique ─────

  /**
   * Génère (sans I/O base) les traductions automatiques manquantes ou périmées pour les langues cibles.
   * Les traductions manuelles sont conservées. `failed` liste les langues dont la traduction a échoué
   * (fournisseurs indisponibles) : la langue source sera utilisée pour celles-ci.
   */
  async buildAutoTranslations(
    ann: { spec: EmbedSpec; content?: string | null; translations: AnnouncementTranslations; sourceLanguage: string; targetLanguages: TargetLanguages },
    enabledLanguages: string[],
    opts: { force?: boolean } = {},
  ): Promise<{ translations: AnnouncementTranslations; generated: string[]; failed: string[] }> {
    const hash = sourceContentHash(ann);
    const targets = resolveTargetLanguages(ann, enabledLanguages).filter((l) => l !== ann.sourceLanguage);
    let translations = ann.translations;
    const generated: string[] = [];
    const failed: string[] = [];
    for (const lang of targets) {
      const kind = translationKind({ translations }, lang);
      if (kind === 'manual') continue;
      if (!opts.force && !needsAutoTranslation({ translations }, lang, hash)) continue;
      try {
        const spec = await machineTranslationService.translateEmbedSpec(ann.spec, ann.sourceLanguage, lang);
        const content = ann.content ? await machineTranslationService.translate(ann.content, ann.sourceLanguage, lang) : undefined;
        const patch = translationPatch(spec, ann.spec, content);
        if (!Object.keys(patch).length) continue;
        translations = applyAutoTranslation(translations, lang, patch, hash);
        generated.push(lang);
      } catch (err) {
        failed.push(lang);
        if (err instanceof TranslationUnavailableError) log.warn({ lang, err: err.message }, 'Traduction automatique indisponible');
        else log.error({ err, lang }, 'Traduction automatique en échec');
      }
    }
    return { translations, generated, failed };
  }

  /** Génère et enregistre les traductions automatiques d'une annonce (bouton « Traduire automatiquement »). */
  async autoTranslate(id: number, opts: { force?: boolean } = {}): Promise<{ ann: AnnouncementData; generated: string[]; failed: string[] }> {
    const ann = await this.require(id);
    const config = await guildConfigService.get(ann.guildId);
    return this.ensureAutoTranslations(ann, { enabledLanguages: config?.enabledLanguages ?? [], autoTranslate: true }, opts);
  }

  /** Applique buildAutoTranslations puis persiste les traductions générées (si le réglage serveur l'autorise). */
  private async ensureAutoTranslations(ann: AnnouncementData, config: Pick<ResolvedGuildConfig, 'enabledLanguages' | 'autoTranslate'>, opts: { force?: boolean } = {}): Promise<{ ann: AnnouncementData; generated: string[]; failed: string[] }> {
    if (!config.autoTranslate || !machineTranslationService.isAvailable()) return { ann, generated: [], failed: [] };
    const r = await this.buildAutoTranslations(ann, config.enabledLanguages, opts);
    if (!r.generated.length) return { ann, generated: [], failed: r.failed };
    const row = await prisma.announcement.update({ where: { id: ann.id }, data: { translations: r.translations as Prisma.InputJsonValue } });
    return { ann: parseAnnouncement(row), generated: r.generated, failed: r.failed };
  }

  // ───── Publication ─────

  private templateContext(guild: TemplateContext['guild'], language: string): TemplateContext {
    return { guild, language };
  }

  private allowedMentions(ann: Pick<AnnouncementData, 'mentionEveryone' | 'mentionRoleIds'>): MessageCreateOptions['allowedMentions'] {
    return { parse: ann.mentionEveryone ? ['everyone'] : [], roles: ann.mentionRoleIds.slice(0, 100) };
  }

  private async fetchMessage(ref: AnnouncementMessageRef): Promise<Message | null> {
    const client = this.requireClient();
    const channel = await client.channels.fetch(ref.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
    return channel.messages.fetch(ref.messageId).catch(() => null);
  }

  /**
   * Publie l'annonce : un message par élément du plan (voir planPublication), enregistre les
   * références de messages, passe le statut à PUBLISHED et journalise (catégorie ANNOUNCEMENT).
   */
  async publish(id: number, opts: { actorId?: string; scheduled?: boolean; autoTranslate?: boolean } = {}): Promise<AnnouncementData> {
    const client = this.requireClient();
    let ann = await this.require(id);
    if (ann.status === AnnouncementStatus.PUBLISHED) throw new AnnouncementError('already_published', String(id));
    const config = await guildConfigService.get(ann.guildId);
    if (!config) throw new AnnouncementError('not_found', ann.guildId);
    const errors: string[] = [];
    if (opts.autoTranslate ?? true) {
      const auto = await this.ensureAutoTranslations(ann, config);
      ann = auto.ann;
      if (auto.failed.length) errors.push(`auto-translation unavailable: ${auto.failed.join(', ')}`);
    }
    const plan = planPublication(ann, config);
    if (!plan.length) throw new AnnouncementError('no_channel');
    const guild = client.guilds.cache.get(ann.guildId) ?? null;

    const sentRefs: AnnouncementMessageRef[] = [];
    for (const item of plan) {
      const channel = await client.channels.fetch(item.channelId).catch(() => null);
      if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) {
        errors.push(`${item.channelId}: invalid channel`);
        continue;
      }
      const spec = renderAnnouncement(ann, item.language, { languageHeader: item.languageHeader, includeMentions: item.includeMentions });
      const built = buildMessageWithBrand(spec, this.templateContext(guild, item.language), config.brandColor);
      try {
        const message = await channel.send({
          content: built.content || undefined,
          embeds: built.embeds,
          components: built.components.length ? built.components : undefined,
          allowedMentions: this.allowedMentions(ann),
        });
        sentRefs.push({ channelId: item.channelId, messageId: message.id, language: item.language });
      } catch (err) {
        errors.push(`${item.channelId}: ${(err as Error).message}`);
        log.warn({ err, announcementId: id, channelId: item.channelId }, 'Envoi d’une annonce impossible');
      }
    }

    if (!sentRefs.length) throw new AnnouncementError('send_failed', errors.join(' | '));

    const row = await prisma.announcement.update({
      where: { id },
      data: { status: AnnouncementStatus.PUBLISHED, publishedAt: new Date(), messages: sentRefs as unknown as Prisma.InputJsonValue },
    });
    const t = await this.t(ann.guildId);
    await loggingService.log({
      guildId: ann.guildId,
      category: 'ANNOUNCEMENT',
      action: opts.scheduled ? 'announcement.publish_scheduled' : 'announcement.publish',
      title: t('announcements.log.published_title'),
      description: t('announcements.log.published_desc', { id: ann.id, title: ann.title }),
      fields: [
        { name: t('announcements.log.messages'), value: sentRefs.map((r) => `${r.language} → https://discord.com/channels/${ann.guildId}/${r.channelId}/${r.messageId}`).join('\n').slice(0, 1024) },
        ...(errors.length ? [{ name: t('announcements.log.errors'), value: errors.join('\n').slice(0, 1024) }] : []),
      ],
      actorId: opts.actorId,
      targetId: String(ann.id),
    });
    return parseAnnouncement(row);
  }

  /** MessageSpec rendu (variables remplacées) d'une annonce dans une langue — pour /announce preview et le dashboard. */
  async preview(id: number, lang: string): Promise<MessageSpec> {
    let ann = await this.require(id);
    const config = await guildConfigService.get(ann.guildId);
    if (config && lang !== ann.sourceLanguage) ann = (await this.ensureAutoTranslations(ann, config)).ann;
    const guild = this.client?.guilds.cache.get(ann.guildId) ?? null;
    const spec = renderAnnouncement(ann, lang, { languageHeader: config?.translationMode === 'PERMISSIONS', includeMentions: true });
    const built = buildMessageWithBrand(spec, this.templateContext(guild, lang), config?.brandColor);
    return {
      content: built.content,
      embeds: built.embeds.map((e) => embedService.fromApiEmbed(e.toJSON())),
      buttons: spec.buttons,
    };
  }
}

export const announcementService = new AnnouncementService();
