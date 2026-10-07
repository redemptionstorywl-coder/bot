import type { APIEmbed } from 'discord.js';

/**
 * File d'envoi des logs par salon (fonctions pures + classe sans dépendance Discord, testées dans tests/logs/sendQueue.test.ts).
 *  - regroupe jusqu'à 10 embeds par message (limite Discord) et 6000 caractères au total ;
 *  - vidée toutes les ~2 s par la tâche `logs:dispatch` du scheduler (au plus MAX_MESSAGES_PER_FLUSH messages par salon) ;
 *  - 429 (rate limit) : le lot reste en tête de file, nouvel essai après `retry_after` (sinon backoff exponentiel) ;
 *  - salon supprimé / accès perdu (10003, 50001, 50013) : la file du salon est abandonnée ;
 *  - autre erreur : backoff exponentiel, lot abandonné après MAX_ATTEMPTS ;
 *  - file > MAX_QUEUE embeds : les plus anciens sont abandonnés (avertissement).
 */

export const MAX_EMBEDS_PER_MESSAGE = 10;
export const MAX_CHARS_PER_MESSAGE = 6000;
export const MAX_QUEUE = 500;
export const MAX_ATTEMPTS = 5;
export const MAX_MESSAGES_PER_FLUSH = 2;
export const BASE_BACKOFF_MS = 2_000;
export const MAX_BACKOFF_MS = 60_000;
export const FLUSH_INTERVAL_MS = 2_000;

/** Codes Discord définitifs : inutile de réessayer. */
const FATAL_CODES = new Set([10003, 50001, 50013, 10004]);

const len = (s: string | null | undefined): number => (s ? s.length : 0);

/** Nombre de caractères comptés par Discord pour un embed (titre, description, champs, pied de page, auteur). */
export function embedLength(embed: APIEmbed): number {
  let n = len(embed.title) + len(embed.description) + len(embed.footer?.text) + len(embed.author?.name);
  for (const f of embed.fields ?? []) n += len(f.name) + len(f.value);
  return n;
}

/** Ramène un embed sous `max` caractères (champs retirés depuis la fin, puis description raccourcie). */
export function clampEmbed(embed: APIEmbed, max = MAX_CHARS_PER_MESSAGE): APIEmbed {
  if (embedLength(embed) <= max) return embed;
  const out: APIEmbed = { ...embed, fields: [...(embed.fields ?? [])] };
  while (out.fields!.length && embedLength(out) > max) out.fields!.pop();
  if (embedLength(out) > max && out.description) {
    const excess = embedLength(out) - max;
    out.description = `${out.description.slice(0, Math.max(0, out.description.length - excess - 1))}…`;
  }
  if (!out.fields!.length) delete out.fields;
  return out;
}

/** Nombre d'embeds de tête formant un message valide (≥ 1 dès que la file n'est pas vide). */
export function takeBatch(embeds: readonly APIEmbed[], maxEmbeds = MAX_EMBEDS_PER_MESSAGE, maxChars = MAX_CHARS_PER_MESSAGE): number {
  let chars = 0;
  let count = 0;
  for (const e of embeds) {
    if (count >= maxEmbeds) break;
    const l = embedLength(e);
    if (count > 0 && chars + l > maxChars) break;
    chars += l;
    count++;
  }
  return count;
}

export interface SendFailure {
  kind: 'rate_limited' | 'fatal' | 'retry';
  retryAfterMs?: number;
}

/** Classe une erreur d'envoi (DiscordAPIError, RateLimitError de @discordjs/rest, HTTPError…). */
export function classifySendError(err: unknown): SendFailure {
  const e = (err ?? {}) as { status?: number; code?: number | string; name?: string; retryAfter?: number; timeToReset?: number; rawError?: { retry_after?: number } };
  if (e.status === 429 || e.name === 'RateLimitError') {
    // RateLimitError : retryAfter / timeToReset en ms ; corps brut Discord : retry_after en secondes
    const ms = typeof e.retryAfter === 'number' ? e.retryAfter : typeof e.timeToReset === 'number' ? e.timeToReset : typeof e.rawError?.retry_after === 'number' ? e.rawError.retry_after * 1000 : undefined;
    return { kind: 'rate_limited', retryAfterMs: ms !== undefined && ms > 0 ? Math.ceil(ms) : undefined };
  }
  if (typeof e.code === 'number' && FATAL_CODES.has(e.code)) return { kind: 'fatal' };
  if (e.status === 403 || e.status === 404) return { kind: 'fatal' };
  return { kind: 'retry' };
}

export const backoffMs = (attempts: number): number => Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));

export type EmbedSender = (channelId: string, embeds: APIEmbed[]) => Promise<void>;

export interface QueueWarning {
  type: 'dropped_overflow' | 'dropped_fatal' | 'dropped_attempts';
  channelId: string;
  count: number;
  error?: unknown;
}

interface ChannelQueue {
  items: APIEmbed[];
  attempts: number;
  retryAt: number;
  sending: boolean;
}

export interface QueueOptions {
  maxQueue?: number;
  maxAttempts?: number;
  maxMessagesPerFlush?: number;
  onWarning?: (w: QueueWarning) => void;
}

export class LogSendQueue {
  private readonly queues = new Map<string, ChannelQueue>();
  private readonly maxQueue: number;
  private readonly maxAttempts: number;
  private readonly maxMessages: number;

  constructor(
    private readonly sender: EmbedSender,
    private readonly opts: QueueOptions = {},
  ) {
    this.maxQueue = opts.maxQueue ?? MAX_QUEUE;
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.maxMessages = opts.maxMessagesPerFlush ?? MAX_MESSAGES_PER_FLUSH;
  }

  enqueue(channelId: string, embed: APIEmbed): void {
    let q = this.queues.get(channelId);
    if (!q) this.queues.set(channelId, (q = { items: [], attempts: 0, retryAt: 0, sending: false }));
    q.items.push(clampEmbed(embed));
    if (q.items.length > this.maxQueue) {
      // Le lot en cours d'envoi est en tête : on ne retire que ce qui suit (sinon il serait retiré deux fois à l'accusé).
      const protectedHead = q.sending ? Math.min(q.items.length, MAX_EMBEDS_PER_MESSAGE * this.maxMessages) : 0;
      const excess = q.items.length - this.maxQueue;
      q.items.splice(protectedHead, excess);
      this.opts.onWarning?.({ type: 'dropped_overflow', channelId, count: excess });
    }
  }

  /** Embeds en attente (tous salons, ou un salon). */
  pending(channelId?: string): number {
    if (channelId) return this.queues.get(channelId)?.items.length ?? 0;
    let n = 0;
    for (const q of this.queues.values()) n += q.items.length;
    return n;
  }

  /** Envoie ce qui est prêt. Retourne le nombre de messages envoyés. */
  async flush(now = Date.now()): Promise<number> {
    const work: Promise<number>[] = [];
    for (const [channelId, q] of this.queues) {
      if (q.sending) continue;
      if (!q.items.length) {
        this.queues.delete(channelId);
        continue;
      }
      if (q.retryAt > now) continue;
      work.push(this.flushChannel(channelId, q, now));
    }
    const sent = await Promise.all(work);
    return sent.reduce((a, b) => a + b, 0);
  }

  private async flushChannel(channelId: string, q: ChannelQueue, now: number): Promise<number> {
    q.sending = true;
    let sent = 0;
    try {
      for (let i = 0; i < this.maxMessages && q.items.length; i++) {
        const n = takeBatch(q.items);
        const batch = q.items.slice(0, n);
        try {
          await this.sender(channelId, batch);
          q.items.splice(0, n);
          q.attempts = 0;
          sent++;
        } catch (err) {
          const failure = classifySendError(err);
          if (failure.kind === 'fatal') {
            const count = q.items.length;
            q.items.length = 0;
            this.opts.onWarning?.({ type: 'dropped_fatal', channelId, count, error: err });
            break;
          }
          q.attempts++;
          if (failure.kind === 'retry' && q.attempts >= this.maxAttempts) {
            q.items.splice(0, n);
            q.attempts = 0;
            this.opts.onWarning?.({ type: 'dropped_attempts', channelId, count: n, error: err });
            break;
          }
          q.retryAt = now + (failure.retryAfterMs ?? backoffMs(q.attempts));
          break;
        }
      }
    } finally {
      q.sending = false;
    }
    return sent;
  }
}
