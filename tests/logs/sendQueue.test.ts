import { describe, expect, it, vi } from 'vitest';
import type { APIEmbed } from 'discord.js';
import { LogSendQueue, MAX_CHARS_PER_MESSAGE, backoffMs, clampEmbed, classifySendError, embedLength, takeBatch } from '../../src/services/logs/sendQueue';
import { buildLogEmbed, toHubEmbed } from '../../src/services/logs/embeds';
import { tickFor } from '../../src/services/SchedulerService';

const e = (title: string, description = ''): APIEmbed => ({ title, description });
const big = (n: number): APIEmbed => ({ title: 't', description: 'x'.repeat(n - 1) });

describe('regroupement des embeds', () => {
  it('embedLength compte titre, description, champs, pied de page, auteur', () => {
    expect(embedLength({ title: 'ab', description: 'cde', footer: { text: 'f' }, author: { name: 'gh' }, fields: [{ name: 'i', value: 'jk' }] })).toBe(11);
  });

  it('au plus 10 embeds par message', () => {
    const list = Array.from({ length: 23 }, (_, i) => e(`log ${i}`));
    expect(takeBatch(list)).toBe(10);
    expect(takeBatch(list.slice(20))).toBe(3);
  });

  it('au plus 6000 caractères par message (au moins un embed par lot)', () => {
    expect(takeBatch([big(2500), big(2500), big(2500)])).toBe(2);
    expect(takeBatch([big(5999), big(10)])).toBe(1);
    expect(takeBatch([])).toBe(0);
  });

  it('clampEmbed ramène un embed trop long sous 6000 caractères', () => {
    const huge: APIEmbed = { title: 'x', description: 'd'.repeat(4096), fields: Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, value: 'v'.repeat(1024) })) };
    const c = clampEmbed(huge);
    expect(embedLength(c)).toBeLessThanOrEqual(MAX_CHARS_PER_MESSAGE);
    expect(c.title).toBe('x');
  });

  it('copie hub : auteur = serveur d’origine, couleur / champs / action (pied de page) conservés', () => {
    const base = buildLogEmbed({ category: 'MODERATION', action: 'mod.ban', title: 'Ban', fields: [{ name: 'Membre', value: '<@1>' }], color: 0xef4444 });
    const hub = toHubEmbed(base, { name: '🎯 RS BATTLE ROYALE', iconUrl: 'https://cdn/icon.png' });
    expect(hub.author).toEqual({ name: '🎯 RS BATTLE ROYALE', icon_url: 'https://cdn/icon.png' });
    expect(hub.color).toBe(0xef4444);
    expect(hub.fields).toEqual(base.fields);
    expect(hub.footer?.text).toBe('MODERATION • mod.ban');
  });
});

describe('LogSendQueue', () => {
  it('regroupe par salon : 23 logs → 3 messages (10 + 10 + 3) sur deux passes', async () => {
    const sent: { channel: string; count: number }[] = [];
    const q = new LogSendQueue(async (channel, embeds) => void sent.push({ channel, count: embeds.length }));
    for (let i = 0; i < 23; i++) q.enqueue('A', e(`a${i}`));
    q.enqueue('B', e('b'));
    expect(await q.flush(0)).toBe(3); // 2 messages max par salon et par passe : A×2, B×1
    expect(await q.flush(0)).toBe(1);
    expect(sent.filter((s) => s.channel === 'A').map((s) => s.count)).toEqual([10, 10, 3]);
    expect(sent.filter((s) => s.channel === 'B').map((s) => s.count)).toEqual([1]);
    expect(q.pending()).toBe(0);
  });

  it('429 : le lot reste en tête, nouvel essai après retry_after, puis envoyé dans l’ordre', async () => {
    const calls: string[][] = [];
    let fail = true;
    const q = new LogSendQueue(async (_c, embeds) => {
      calls.push(embeds.map((x) => x.title!));
      if (fail) {
        fail = false;
        throw Object.assign(new Error('rate limited'), { status: 429, retryAfter: 1500 });
      }
    });
    q.enqueue('A', e('1'));
    q.enqueue('A', e('2'));
    expect(await q.flush(1000)).toBe(0);
    expect(q.pending('A')).toBe(2);
    expect(await q.flush(2000)).toBe(0); // trop tôt (retry à 2500)
    expect(await q.flush(2600)).toBe(1);
    expect(calls).toEqual([['1', '2'], ['1', '2']]);
    expect(q.pending()).toBe(0);
  });

  it('salon supprimé / accès perdu : file du salon abandonnée (avertissement)', async () => {
    const onWarning = vi.fn();
    const q = new LogSendQueue(async () => {
      throw Object.assign(new Error('Unknown Channel'), { code: 10003, status: 404 });
    }, { onWarning });
    q.enqueue('A', e('1'));
    q.enqueue('A', e('2'));
    await q.flush(0);
    expect(q.pending('A')).toBe(0);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ type: 'dropped_fatal', channelId: 'A', count: 2 }));
  });

  it('erreurs répétées : backoff exponentiel puis lot abandonné après maxAttempts', async () => {
    const onWarning = vi.fn();
    const sender = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const q = new LogSendQueue(sender, { maxAttempts: 3, onWarning });
    q.enqueue('A', e('1'));
    await q.flush(0);
    await q.flush(backoffMs(1));
    await q.flush(backoffMs(1) + backoffMs(2));
    expect(sender).toHaveBeenCalledTimes(3);
    expect(q.pending()).toBe(0);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ type: 'dropped_attempts', count: 1 }));
  });

  it('file pleine : les plus anciens sont abandonnés (avertissement)', () => {
    const onWarning = vi.fn();
    const q = new LogSendQueue(async () => undefined, { maxQueue: 5, onWarning });
    for (let i = 0; i < 8; i++) q.enqueue('A', e(`${i}`));
    expect(q.pending('A')).toBe(5);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ type: 'dropped_overflow', channelId: 'A' }));
  });

  it('un salon en erreur ne bloque pas les autres', async () => {
    const sent: string[] = [];
    const q = new LogSendQueue(async (channel) => {
      if (channel === 'bad') throw Object.assign(new Error('rate'), { status: 429 });
      sent.push(channel);
    });
    q.enqueue('bad', e('x'));
    q.enqueue('good', e('y'));
    await q.flush(0);
    expect(sent).toEqual(['good']);
    expect(q.pending('bad')).toBe(1);
  });
});

describe('classifySendError / backoff / boucle du scheduler', () => {
  it('classe les erreurs Discord', () => {
    expect(classifySendError({ name: 'RateLimitError', timeToReset: 800 })).toEqual({ kind: 'rate_limited', retryAfterMs: 800 });
    expect(classifySendError({ status: 429, rawError: { retry_after: 2.5 } })).toEqual({ kind: 'rate_limited', retryAfterMs: 2500 });
    expect(classifySendError({ status: 403, code: 50013 }).kind).toBe('fatal');
    expect(classifySendError(new Error('boom')).kind).toBe('retry');
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(10)).toBe(60000);
  });

  it('la boucle du scheduler accélère pour une tâche de 2 s (jamais sous 1 s, jamais au-dessus de 5 s)', () => {
    expect(tickFor(5000, 2000)).toBe(2000);
    expect(tickFor(5000, 60_000)).toBe(5000);
    expect(tickFor(2000, 500)).toBe(1000);
    expect(tickFor(0, 15_000)).toBe(5000);
  });
});
