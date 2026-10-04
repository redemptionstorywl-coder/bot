import { ButtonStyle, ComponentType, type Client, type Message, type MessageCreateOptions, type MessageEditOptions, type TextBasedChannel } from 'discord.js';
import type { EmbedTemplate, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/client';
import { buttonSpecSchema, embedService, embedSpecSchema, messageSpecSchema, type ButtonSpec, type EmbedSpec, type MessageSpec } from './EmbedService';
import type { TemplateContext } from '../utils/variables';
import { childLogger } from '../utils/logger';

const log = childLogger('EmbedTemplateService');

export type EmbedTemplateErrorCode = 'not_found' | 'duplicate_name' | 'invalid_channel' | 'message_not_found' | 'not_bot_message' | 'no_embed' | 'no_client' | 'invalid_spec';

export class EmbedTemplateError extends Error {
  constructor(
    public readonly code: EmbedTemplateErrorCode,
    public readonly details?: string,
  ) {
    super(`${code}${details ? `: ${details}` : ''}`);
    this.name = 'EmbedTemplateError';
  }
}

export interface EmbedTemplateInput {
  name: string;
  description?: string | null;
  spec: EmbedSpec;
  buttons?: ButtonSpec[];
}

/** Contexte d'envoi : variables de template + client Discord (optionnel si attach() a été appelé). */
export interface SendContext extends TemplateContext {
  client?: Client;
}

export interface MessageReference {
  channelId?: string;
  messageId: string;
}

/** Accepte soit un EmbedSpec seul, soit un MessageSpec { content, embeds, buttons }. */
const importSchema = z.union([messageSpecSchema.strict(), embedSpecSchema.strict()]);

function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((i) => `• \`${i.path.join('.') || 'root'}\` : ${i.message}`)
    .join('\n');
}

function isSendable(channel: unknown): channel is TextBasedChannel & { send: (o: MessageCreateOptions) => Promise<Message> } {
  return !!channel && typeof channel === 'object' && 'send' in channel && typeof (channel as { send?: unknown }).send === 'function' && 'messages' in channel;
}

/**
 * Templates d'embeds réutilisables + envoi / édition de messages construits depuis un MessageSpec.
 * Utilisé par /embed, le builder interactif et le dashboard.
 */
export class EmbedTemplateService {
  private client: Client | null = null;

  attach(client: Client): void {
    this.client = client;
  }

  private resolveClient(ctx?: SendContext): Client {
    const client = ctx?.client ?? this.client;
    if (!client) throw new EmbedTemplateError('no_client');
    return client;
  }

  // ───── CRUD ─────

  list(guildId: string): Promise<EmbedTemplate[]> {
    return prisma.embedTemplate.findMany({ where: { guildId }, orderBy: { name: 'asc' } });
  }

  get(id: number): Promise<EmbedTemplate | null> {
    return prisma.embedTemplate.findUnique({ where: { id } });
  }

  getByName(guildId: string, name: string): Promise<EmbedTemplate | null> {
    return prisma.embedTemplate.findUnique({ where: { guildId_name: { guildId, name } } });
  }

  async create(guildId: string, data: EmbedTemplateInput, createdById: string): Promise<EmbedTemplate> {
    const spec = this.validateSpec(data.spec);
    const buttons = this.validateButtons(data.buttons ?? []);
    const existing = await this.getByName(guildId, data.name);
    if (existing) throw new EmbedTemplateError('duplicate_name', data.name);
    return prisma.embedTemplate.create({
      data: { guildId, name: data.name.trim().slice(0, 100), description: data.description ?? null, spec: spec as Prisma.InputJsonValue, buttons: buttons as Prisma.InputJsonValue, createdById },
    });
  }

  async update(id: number, data: Partial<EmbedTemplateInput>): Promise<EmbedTemplate> {
    const current = await this.get(id);
    if (!current) throw new EmbedTemplateError('not_found', String(id));
    const patch: Prisma.EmbedTemplateUpdateInput = {};
    if (data.name !== undefined) {
      const dup = await this.getByName(current.guildId, data.name);
      if (dup && dup.id !== id) throw new EmbedTemplateError('duplicate_name', data.name);
      patch.name = data.name.trim().slice(0, 100);
    }
    if (data.description !== undefined) patch.description = data.description;
    if (data.spec !== undefined) patch.spec = this.validateSpec(data.spec) as Prisma.InputJsonValue;
    if (data.buttons !== undefined) patch.buttons = this.validateButtons(data.buttons) as Prisma.InputJsonValue;
    return prisma.embedTemplate.update({ where: { id }, data: patch });
  }

  /** Crée ou remplace un template par son nom (utilisé par « Sauver comme template »). */
  async upsertByName(guildId: string, data: EmbedTemplateInput, createdById: string): Promise<{ template: EmbedTemplate; created: boolean }> {
    const existing = await this.getByName(guildId, data.name);
    if (existing) return { template: await this.update(existing.id, data), created: false };
    return { template: await this.create(guildId, data, createdById), created: true };
  }

  async delete(id: number): Promise<void> {
    const current = await this.get(id);
    if (!current) throw new EmbedTemplateError('not_found', String(id));
    await prisma.embedTemplate.delete({ where: { id } });
  }

  // ───── Validation / conversion ─────

  validateSpec(spec: unknown): EmbedSpec {
    const r = embedSpecSchema.safeParse(spec);
    if (!r.success) throw new EmbedTemplateError('invalid_spec', formatZodError(r.error));
    return r.data;
  }

  validateButtons(buttons: unknown): ButtonSpec[] {
    const r = z.array(buttonSpecSchema).max(25).safeParse(buttons);
    if (!r.success) throw new EmbedTemplateError('invalid_spec', formatZodError(r.error));
    return r.data;
  }

  /** Lit les colonnes JSON d'un template de façon sûre. */
  toMessageSpec(template: Pick<EmbedTemplate, 'spec' | 'buttons'>): MessageSpec {
    const spec = embedSpecSchema.safeParse(template.spec);
    const buttons = z.array(buttonSpecSchema).safeParse(template.buttons);
    return { embeds: [spec.success ? spec.data : {}], buttons: buttons.success ? buttons.data : [] };
  }

  /**
   * Parse un JSON collé par l'utilisateur (« Importer JSON »). Accepte un EmbedSpec ou un MessageSpec.
   * Retourne une erreur lisible (chemin + message) en cas d'échec.
   */
  parseImport(raw: string): { success: true; data: MessageSpec } | { success: false; error: string } {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    // Un MessageSpec se reconnaît à ses clés embeds/buttons/content ; sinon on tente un EmbedSpec.
    const r = importSchema.safeParse(json);
    if (!r.success) return { success: false, error: formatZodError(r.error) };
    const data = r.data;
    if ('embeds' in data || 'buttons' in data || ('content' in data && !('title' in data) && !('description' in data))) return { success: true, data: data as MessageSpec };
    return { success: true, data: { embeds: [data as EmbedSpec] } };
  }

  /** Sérialise un MessageSpec pour l'export (sans clés undefined). */
  exportJson(spec: MessageSpec): string {
    return JSON.stringify(spec, (_k, v: unknown) => (v === undefined ? undefined : v), 2);
  }

  /**
   * Parse un lien de message (`https://discord.com/channels/g/c/m`), un couple `channelId-messageId`
   * ou un simple ID de message.
   */
  parseMessageReference(input: string, fallbackChannelId?: string): MessageReference | null {
    const raw = input.trim();
    const link = raw.match(/channels\/(\d{15,22})\/(\d{15,22})\/(\d{15,22})/);
    if (link) return { channelId: link[2]!, messageId: link[3]! };
    const pair = raw.match(/^(\d{15,22})-(\d{15,22})$/);
    if (pair) return { channelId: pair[1]!, messageId: pair[2]! };
    if (/^\d{15,22}$/.test(raw)) return { channelId: fallbackChannelId, messageId: raw };
    return null;
  }

  /** Reconstruit les ButtonSpec depuis les composants d'un message existant. */
  buttonsFromMessage(message: Message): ButtonSpec[] {
    const out: ButtonSpec[] = [];
    for (const rowComp of message.components) {
      if (rowComp.type !== ComponentType.ActionRow) continue;
      for (const c of rowComp.components) {
        if (c.type !== ComponentType.Button) continue;
        const label = c.label ?? c.emoji?.name ?? '•';
        if (c.style === ButtonStyle.Link && c.url) out.push({ label, style: 'link', url: c.url, emoji: c.emoji?.id ?? c.emoji?.name ?? undefined, disabled: c.disabled || undefined });
        else if (c.customId) {
          const style = c.style === ButtonStyle.Primary ? 'primary' : c.style === ButtonStyle.Success ? 'success' : c.style === ButtonStyle.Danger ? 'danger' : 'secondary';
          out.push({ label, style, customId: c.customId, emoji: c.emoji?.id ?? c.emoji?.name ?? undefined, disabled: c.disabled || undefined });
        }
      }
    }
    return out.slice(0, 25);
  }

  // ───── Discord ─────

  private async fetchChannel(channelId: string, ctx?: SendContext) {
    const client = this.resolveClient(ctx);
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !isSendable(channel)) throw new EmbedTemplateError('invalid_channel', channelId);
    return channel;
  }

  /** Récupère un message envoyé par le bot (pour /embed edit). */
  async fetchBotMessage(channelId: string, messageId: string, ctx?: SendContext): Promise<Message> {
    const client = this.resolveClient(ctx);
    const channel = await this.fetchChannel(channelId, ctx);
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) throw new EmbedTemplateError('message_not_found', messageId);
    if (message.author.id !== client.user?.id) throw new EmbedTemplateError('not_bot_message', messageId);
    return message;
  }

  /** Envoie un MessageSpec dans un salon (variables rendues avec `ctx`). */
  async sendSpec(guildId: string, channelId: string, spec: MessageSpec, ctx: SendContext = {}): Promise<Message> {
    const client = this.resolveClient(ctx);
    const channel = await this.fetchChannel(channelId, ctx);
    const guild = ctx.guild ?? client.guilds.cache.get(guildId) ?? null;
    const built = embedService.buildMessage(spec, { ...ctx, guild });
    const payload: MessageCreateOptions = {
      content: built.content || undefined,
      embeds: built.embeds.length ? built.embeds : undefined,
      components: built.components.length ? built.components : undefined,
      allowedMentions: { parse: ['roles', 'everyone'] },
    };
    const message = await channel.send(payload);
    log.info({ guildId, channelId, messageId: message.id }, 'Embed envoyé');
    return message;
  }

  /** Met à jour un message existant du bot avec un MessageSpec. */
  async editMessage(channelId: string, messageId: string, spec: MessageSpec, ctx: SendContext = {}): Promise<Message> {
    const message = await this.fetchBotMessage(channelId, messageId, ctx);
    const built = embedService.buildMessage(spec, { ...ctx, guild: ctx.guild ?? message.guild ?? null });
    const payload: MessageEditOptions = {
      content: built.content || null,
      embeds: built.embeds,
      components: built.components,
      allowedMentions: { parse: ['roles', 'everyone'] },
    };
    return message.edit(payload);
  }
}

export const embedTemplateService = new EmbedTemplateService();
