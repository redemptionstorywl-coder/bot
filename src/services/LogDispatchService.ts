import type { APIEmbed, Client } from 'discord.js';
import { scheduler } from './SchedulerService';
import { childLogger } from '../utils/logger';
import { FLUSH_INTERVAL_MS, LogSendQueue, type QueueWarning } from './logs/sendQueue';

const log = childLogger('LogDispatch');

/** Erreur « salon introuvable / non textuel » (traitée comme définitive par la file). */
class UnusableChannelError extends Error {
  readonly code = 10003;
  constructor(channelId: string) {
    super(`Salon de logs inutilisable : ${channelId}`);
  }
}

/**
 * Envoi groupé des embeds de logs (salons locaux et hub) : une file par salon, vidée toutes les 2 s par la tâche
 * `logs:dispatch` du scheduler (jusqu'à 10 embeds par message). Voir src/services/logs/sendQueue.ts.
 */
export class LogDispatchService {
  private client: Client | null = null;
  private readonly warned = new Map<string, number>();
  readonly queue = new LogSendQueue((channelId, embeds) => this.send(channelId, embeds), { onWarning: (w) => this.warn(w) });

  attach(client: Client): void {
    this.client = client;
    if (!scheduler.registered.includes('logs:dispatch')) {
      scheduler.register({ name: 'logs:dispatch', intervalMs: FLUSH_INTERVAL_MS, run: async () => void (await this.queue.flush()) });
    }
  }

  enqueue(channelId: string, embed: APIEmbed): void {
    this.queue.enqueue(channelId, embed);
  }

  /** Vide la file (arrêt du bot) : quelques passes, sans attendre les nouvelles tentatives lointaines. */
  async drain(passes = 3): Promise<void> {
    for (let i = 0; i < passes && this.queue.pending(); i++) await this.queue.flush(Number.MAX_SAFE_INTEGER);
  }

  private async send(channelId: string, embeds: APIEmbed[]): Promise<void> {
    if (!this.client) throw new Error('Client Discord non attaché');
    const channel = await this.client.channels.fetch(channelId).catch((err: { code?: number }) => {
      if (err?.code === 10003 || err?.code === 50001) return null;
      throw err;
    });
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) throw new UnusableChannelError(channelId);
    await channel.send({ embeds, allowedMentions: { parse: [] } });
  }

  private warn(w: QueueWarning): void {
    const key = `${w.type}:${w.channelId}`;
    const last = this.warned.get(key) ?? 0;
    if (Date.now() - last < 60_000) return;
    this.warned.set(key, Date.now());
    if (this.warned.size > 1000) this.warned.clear();
    log.warn({ channelId: w.channelId, count: w.count, type: w.type, err: w.error }, w.type === 'dropped_overflow' ? 'File de logs pleine : anciens logs abandonnés' : 'Logs abandonnés (salon inaccessible ou erreurs répétées)');
  }
}

export const logDispatchService = new LogDispatchService();
