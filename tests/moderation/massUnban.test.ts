import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));
vi.mock('../../src/services/GuildConfigService', () => ({
  CHANNELS_REMAPPED_EVENT: 'channels:remapped',
  guildConfigService: {
    get: vi.fn(async () => ({ defaultLanguage: 'fr', modules: { logs: true }, logChannels: { SECURITY: '1', MODERATION: '2' } })),
    emit: vi.fn(),
    invalidate: vi.fn(),
    on: vi.fn(),
  },
}));
vi.mock('../../src/services/FiveMSyncService', () => ({ fivemSyncService: { markBulk: vi.fn() } }));
vi.mock('../../src/services/WelcomeService', () => ({ welcomeService: { invalidate: vi.fn() } }));
vi.mock('../../src/services/RoleService', () => ({ roleService: { invalidate: vi.fn() } }));
vi.mock('../../src/services/TicketService', () => ({ ticketService: {} }));
vi.mock('../../src/services/EventService', () => ({ eventService: {} }));
vi.mock('../../src/services/GiveawayService', () => ({ giveawayService: {} }));
vi.mock('../../src/services/PollService', () => ({ pollService: {} }));

import { MassUnbanService, isUnbanAllConfirmed, progressBar, type MassUnbanJob } from '../../src/services/MassUnbanService';
import { moderationService } from '../../src/services/ModerationService';
import { fivemSyncService } from '../../src/services/FiveMSyncService';
import { loggingService } from '../../src/services/LoggingService';
import { prisma as prismaModule } from '../../src/database/client';
import guildBanRemoveLogs from '../../src/events/guildBanRemove.logs';

const prisma = prismaModule as unknown as ReturnType<typeof createPrismaMock>;
const markBulk = vi.mocked(fivemSyncService.markBulk);
const logMock = vi.mocked(loggingService.log);
const ACTOR_ID = '900000000000000001';
const actor = { id: ACTOR_ID, tag: 'admin#0', username: 'admin' } as never;

/** IDs croissants (17 chiffres) : la pagination Discord renvoie les bans triés par ID. */
const ids = (n: number) => Array.from({ length: n }, (_, i) => String(10_000_000_000_000_000n + BigInt(i)));

/** Faux serveur : `bans.fetch({ limit, after })` pagine, `bans.remove` débannit (ou échoue via `fail`). */
function fakeGuild(banned: string[], opts: { fail?: Record<string, number>; removeDelayMs?: number } = {}) {
  const remaining = new Set(banned);
  const fetch = vi.fn(async ({ limit, after }: { limit: number; after?: string }) => {
    const sorted = [...remaining].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    const page = sorted.filter((id) => !after || BigInt(id) > BigInt(after)).slice(0, limit);
    return new Map(page.map((id) => [id, { user: { id } }]));
  });
  const remove = vi.fn(async (id: string, _reason?: string) => {
    if (opts.removeDelayMs) await new Promise((r) => setTimeout(r, opts.removeDelayMs));
    const code = opts.fail?.[id];
    if (code) throw Object.assign(new Error('Discord error'), { code });
    remaining.delete(id);
  });
  const guild = { id: 'g', name: 'Serveur', bans: { fetch, remove }, client: { users: { fetch: vi.fn(async () => null) } } };
  return { guild: guild as never, fetch, remove, remaining };
}

/** Lance un job et attend le dernier rappel (finishedAt défini). */
function runJob(svc: MassUnbanService, guild: never, opts: { syncGame?: boolean; reason?: string | null } = {}) {
  const progress: MassUnbanJob[] = [];
  let resolve!: (job: MassUnbanJob) => void;
  const finished = new Promise<MassUnbanJob>((r) => (resolve = r));
  const job = svc.start(guild, actor, {
    ...opts,
    onProgress: (j) => {
      progress.push(j);
      if (j.finishedAt) resolve(j);
    },
  });
  return { job, progress, finished };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.sanction!.aggregate!.mockResolvedValue({ _max: { caseNumber: 41 } });
  prisma.sanction!.create!.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, createdAt: new Date(), ...data }));
  prisma.ban!.updateMany!.mockResolvedValue({ count: 0 });
});

describe('confirmation `UNBAN ALL`', () => {
  it('exige la phrase exacte (casse comprise), espaces tolérés', () => {
    expect(isUnbanAllConfirmed('UNBAN ALL')).toBe(true);
    expect(isUnbanAllConfirmed('  UNBAN   ALL ')).toBe(true);
    expect(isUnbanAllConfirmed('unban all')).toBe(false);
    expect(isUnbanAllConfirmed('UNBAN')).toBe(false);
    expect(isUnbanAllConfirmed('UNBAN ALL !')).toBe(false);
    expect(isUnbanAllConfirmed('')).toBe(false);
    expect(isUnbanAllConfirmed(undefined)).toBe(false);
    expect(isUnbanAllConfirmed(null)).toBe(false);
  });

  it('barre de progression', () => {
    expect(progressBar(0, 10, 10)).toBe('▱▱▱▱▱▱▱▱▱▱ 0%');
    expect(progressBar(5, 10, 10)).toBe('▰▰▰▰▰▱▱▱▱▱ 50%');
    expect(progressBar(10, 10, 10)).toBe('▰▰▰▰▰▰▰▰▰▰ 100%');
    expect(progressBar(0, 0, 4)).toBe('▰▰▰▰ 100%');
  });
});

describe('MassUnbanService.count', () => {
  it('pagine par 1000 avec le curseur `after`', async () => {
    const list = ids(2500);
    const { guild, fetch } = fakeGuild(list);
    expect(await new MassUnbanService({ delayMs: 0 }).count(guild)).toBe(2500);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]![0]).toEqual({ limit: 1000, after: undefined, cache: false });
    expect(fetch.mock.calls[1]![0]).toMatchObject({ limit: 1000, after: list[999] });
    expect(fetch.mock.calls[2]![0]).toMatchObject({ limit: 1000, after: list[1999] });
  });

  it('une page incomplète suffit ; aucun banni → 0', async () => {
    const { guild, fetch } = fakeGuild([]);
    expect(await new MassUnbanService().count(guild)).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('MassUnbanService.start', () => {
  it('débannit tout le monde, une seule case récapitulative, Ban.active=false, logs SECURITY + MODERATION', async () => {
    const list = ids(1005);
    const { guild, remove, remaining } = fakeGuild(list);
    const svc = new MassUnbanService({ delayMs: 0 });
    const { job, progress, finished } = runJob(svc, guild, { reason: 'amnistie' });
    expect(job).toMatchObject({ guildId: 'g', actorId: ACTOR_ID, done: 0, failed: 0, cancelled: false });
    const final = await finished;

    expect(remove).toHaveBeenCalledTimes(1005);
    expect(remove.mock.calls[0]![1]).toContain('amnistie');
    expect(remaining.size).toBe(0);
    expect(final).toMatchObject({ total: 1005, done: 1005, failed: 0, cancelled: false });
    expect(final.finishedAt).toBeInstanceOf(Date);
    // Progression : après la liste, toutes les 10 entrées, puis la fin
    expect(progress[0]).toMatchObject({ total: 1005, done: 0 });
    expect(progress.filter((p) => !p.finishedAt && p.done > 0).map((p) => p.done).slice(0, 3)).toEqual([10, 20, 30]);
    expect(progress.at(-1)!.finishedAt).toBeDefined();

    // UNE seule case UNBAN { massUnban: true, count }
    expect(prisma.sanction!.create).toHaveBeenCalledTimes(1);
    expect(prisma.sanction!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ guildId: 'g', type: 'UNBAN', userId: null, moderatorId: ACTOR_ID, reason: 'amnistie', caseNumber: 42, metadata: expect.objectContaining({ massUnban: true, count: 1005 }) }),
    });
    // Ban.active=false pour toutes les lignes (par lots)
    const flagged = prisma.ban!.updateMany!.mock.calls.flatMap((call: unknown[]) => {
      const arg = call[0] as { where: { userId: { in: string[] }; active: boolean }; data: unknown };
      expect(arg.where.active).toBe(true);
      expect(arg.data).toEqual({ active: false });
      return arg.where.userId.in;
    });
    expect(new Set(flagged)).toEqual(new Set(list));
    // Logs : lancement (SECURITY) + rapport SECURITY et MODERATION
    const actions = logMock.mock.calls.map(([e]) => `${e.category}:${e.action}`);
    expect(actions).toEqual(['SECURITY:mod.unban_all.start', 'SECURITY:mod.unban_all', 'MODERATION:mod.unban_all']);
    expect(svc.status('g')).toMatchObject({ done: 1005, total: 1005 });
  });

  it('anti-doublon : guildBanRemove.logs ne crée ni case ni log par membre', async () => {
    const list = ids(3);
    const { guild } = fakeGuild(list);
    const { finished } = runJob(new MassUnbanService({ delayMs: 0 }), guild);
    await finished;
    prisma.sanction!.create!.mockClear();
    logMock.mockClear();
    const ban = (id: string) => ({ guild: { id: 'g', members: { me: null } }, user: { id, displayAvatarURL: () => '' } }) as never;
    for (const id of list) await guildBanRemoveLogs.execute({} as never, ban(id));
    expect(prisma.sanction!.create).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
    // Témoin : un unban manuel (non marqué) est bien journalisé
    await guildBanRemoveLogs.execute({} as never, ban('800000000000000001'));
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'mod.unban', targetId: '800000000000000001' }));
  });

  it('inclure_jeu : relais en jeu sans log par membre (true) ou bloqué (false)', async () => {
    const list = ids(4);
    const first = fakeGuild(list);
    await runJob(new MassUnbanService({ delayMs: 0 }), first.guild).finished;
    expect(markBulk.mock.calls.map((c) => c[3])).toEqual(['quiet', 'quiet', 'quiet', 'quiet']);
    expect(markBulk).toHaveBeenCalledWith('unban', 'g', list[0], 'quiet');
    markBulk.mockClear();
    const second = fakeGuild(list);
    await runJob(new MassUnbanService({ delayMs: 0 }), second.guild, { syncGame: false }).finished;
    expect(markBulk.mock.calls.map((c) => c[3])).toEqual(['skip', 'skip', 'skip', 'skip']);
    expect(prisma.sanction!.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ massUnban: true, count: 4, syncGame: false }) }) });
  });

  it('compte les échecs ; « Unknown Ban » compte comme débanni', async () => {
    const list = ids(5);
    const { guild } = fakeGuild(list, { fail: { [list[1]!]: 50013, [list[3]!]: 10026 } });
    const consume = vi.spyOn(moderationService, 'consumeRecent');
    const final = await runJob(new MassUnbanService({ delayMs: 0 }), guild).finished;
    expect(final).toMatchObject({ total: 5, done: 4, failed: 1 });
    expect(consume).toHaveBeenCalledWith('g', 'unban', list[1]);
    expect(prisma.sanction!.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ count: 4, failed: 1 }) }) });
    consume.mockRestore();
  });

  it('un seul job à la fois par serveur', async () => {
    const { guild } = fakeGuild(ids(30), { removeDelayMs: 1 });
    const svc = new MassUnbanService({ delayMs: 0 });
    const { finished } = runJob(svc, guild);
    expect(() => svc.start(guild, actor)).toThrow(expect.objectContaining({ key: 'moderation.unban_all.already_running' }));
    await finished;
    // Terminé : un nouveau job peut être lancé
    const again = runJob(svc, fakeGuild(ids(1)).guild);
    await again.finished;
    expect(svc.status('g')).toMatchObject({ total: 1, done: 1 });
  });

  it('annulation : s’arrête, rapport partiel, case avec le nombre réellement débanni', async () => {
    const { guild, remaining } = fakeGuild(ids(200), { removeDelayMs: 2 });
    const svc = new MassUnbanService({ delayMs: 0 });
    expect(svc.cancel('g')).toBe(false);
    const { finished, progress } = runJob(svc, guild);
    await vi.waitFor(() => expect(progress.some((p) => p.done >= 10)).toBe(true));
    expect(svc.cancel('g')).toBe(true);
    const final = await finished;
    expect(final.cancelled).toBe(true);
    expect(final.done).toBeGreaterThanOrEqual(10);
    expect(final.done).toBeLessThan(200);
    expect(remaining.size).toBe(200 - final.done);
    expect(prisma.sanction!.create).toHaveBeenCalledTimes(1);
    expect(prisma.sanction!.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ massUnban: true, count: final.done, cancelled: true }) }) });
    expect(svc.cancel('g')).toBe(false);
  });

  it('aucun banni : pas de case ni de log, job terminé', async () => {
    const { guild } = fakeGuild([]);
    const final = await runJob(new MassUnbanService({ delayMs: 0 }), guild).finished;
    expect(final).toMatchObject({ total: 0, done: 0, failed: 0 });
    expect(prisma.sanction!.create).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('status : copie du dernier job, null sans job', () => {
    const svc = new MassUnbanService({ delayMs: 0 });
    expect(svc.status('autre')).toBeNull();
  });
});
