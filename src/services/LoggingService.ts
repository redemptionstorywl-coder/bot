import { EmbedBuilder, type Client, type ColorResolvable } from 'discord.js';
import { LogCategory, Prisma } from '@prisma/client';
import { prisma } from '../database/client';
import { guildConfigService } from './GuildConfigService';
import { BRAND } from '../config/constants';
import { childLogger } from '../utils/logger';

const log = childLogger('LoggingService');

export interface LogEntry {
  guildId: string;
  category: LogCategory;
  /** Identifiant d'action court : "message.delete", "ticket.open"… */
  action: string;
  title: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  actorId?: string | null;
  targetId?: string | null;
  color?: number;
  thumbnail?: string;
  data?: Record<string, unknown>;
  /** Ne pas écrire en base (logs très fréquents) */
  skipDatabase?: boolean;
}

/**
 * Service de logs : envoie un embed dans le salon configuré pour la catégorie
 * et conserve une trace en base (table Log) consultable dans le dashboard.
 */
export class LoggingService {
  private client: Client | null = null;
  private queue: LogEntry[] = [];
  private flushing = false;

  attach(client: Client): void {
    this.client = client;
  }

  async log(entry: LogEntry): Promise<void> {
    this.queue.push(entry);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 20);
        await Promise.all(batch.map((e) => this.process(e).catch((err) => log.error({ err, action: e.action }, 'Log failed'))));
      }
    } finally {
      this.flushing = false;
    }
  }

  private async process(entry: LogEntry): Promise<void> {
    const cfg = await guildConfigService.get(entry.guildId);
    if (!entry.skipDatabase) {
      await prisma.log.create({
        data: {
          guildId: entry.guildId,
          category: entry.category,
          action: entry.action,
          actorId: entry.actorId ?? null,
          targetId: entry.targetId ?? null,
          data: (entry.data ?? { title: entry.title, description: entry.description }) as Prisma.InputJsonValue,
        },
      });
    }
    if (!cfg || !cfg.modules.logs) return;
    const channelId = cfg.logChannels[entry.category] ?? cfg.logChannels.SYSTEM;
    if (!channelId || !this.client) return;
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
    const embed = new EmbedBuilder()
      .setColor((entry.color ?? BRAND.colors.anthracite) as ColorResolvable)
      .setTitle(entry.title)
      .setTimestamp()
      .setFooter({ text: `${entry.category} • ${entry.action}` });
    if (entry.description) embed.setDescription(entry.description.slice(0, 4096));
    if (entry.fields?.length) embed.addFields(entry.fields.slice(0, 25).map((f) => ({ ...f, value: f.value.slice(0, 1024) || '—' })));
    if (entry.thumbnail) embed.setThumbnail(entry.thumbnail);
    if ('send' in channel) await channel.send({ embeds: [embed] }).catch((err) => log.warn({ err, channelId }, 'Impossible d’envoyer le log'));
  }

  /** Nettoie les logs plus vieux que `days` jours. */
  async prune(days = 90): Promise<number> {
    const r = await prisma.log.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400_000) } } });
    return r.count;
  }
}

export const loggingService = new LoggingService();
