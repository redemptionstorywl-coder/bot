import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection, OverwriteType } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [] }) }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn(async () => undefined) } }));
vi.mock('../../src/services/GuildConfigService', () => ({
  guildConfigService: {
    get: vi.fn(async () => ({ guildId: '100000000000000001', defaultLanguage: 'fr', staffRoleIds: [], adminRoleIds: [], brandColor: 0x2f8bff, logChannels: { TICKET: '700000000000000001' }, modules: { logs: true, tickets: true } })),
  },
}));

import { prisma as prismaClient } from '../../src/database/client';
import { TicketError, ticketService } from '../../src/services/TicketService';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;
const t = (key: string) => key;

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OPEN_CAT = '300000000000000001';
const CLOSED_CAT = '300000000000000002';
const STAFF_ROLE = '400000000000000001';
const OPENER = '500000000000000001';
const FRIEND = '500000000000000002';
const MOD = '500000000000000003';
const LOG_CHANNEL = '700000000000000001';

const category = (id: string, size: number) => ({ id, type: ChannelType.GuildCategory, children: { cache: { size } } });
const member = (id: string, roles: string[] = []) => ({
  id,
  guild: { ownerId: 'owner' },
  roles: { cache: new Collection(roles.map((r) => [r, { id: r, name: 'Staff' }])) },
  permissions: { has: () => false },
});

const typeRow = { id: 1, guildId: GUILD, key: 'support', label: 'Support', emoji: '🎫', categoryId: OPEN_CAT, archiveCategoryId: null, staffRoleIds: [STAFF_ROLE], questions: [], embed: null, welcomeMessage: null, language: 'fr', nameFormat: 'ticket-{number}', maxPerUser: 1, enabled: true, order: 0 };

let row: Record<string, unknown>;
let categories: Collection<string, ReturnType<typeof category>>;
let sent: { id: string; payload: { components?: { toJSON(): { components: { custom_id: string; disabled?: boolean; label?: string }[] } }[] }; edit: ReturnType<typeof vi.fn> }[];
const welcome = { author: { id: 'bot' }, components: [], embeds: [{}], edit: vi.fn(async () => undefined) };
const user = { id: OPENER, tag: 'opener', username: 'opener', displayAvatarURL: () => 'https://cdn.example/a.png', send: vi.fn(async () => ({})) };
const logChannel = { id: LOG_CHANNEL, type: ChannelType.GuildText, send: vi.fn(async () => ({})) };
const guild = {
  id: GUILD,
  name: 'RS Battle Royale',
  ownerId: 'owner',
  get channels() {
    return { cache: categories };
  },
  members: {
    fetch: vi.fn(async (id: string) => {
      if (id === OPENER || id === FRIEND) return member(id);
      if (id === MOD) return member(id, [STAFF_ROLE]);
      throw new Error('membre inconnu');
    }),
  },
  roles: { cache: new Collection([[STAFF_ROLE, { id: STAFF_ROLE }]]) },
  iconURL: () => null,
};
const channel = {
  id: CHANNEL,
  type: ChannelType.GuildText,
  parentId: OPEN_CAT as string | null,
  guild,
  get client() {
    return { user: { id: 'bot' }, users: client.users };
  },
  permissionOverwrites: { edit: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) },
  setParent: vi.fn(async (id: string) => {
    channel.parentId = id;
  }),
  send: vi.fn(async (payload: (typeof sent)[number]['payload']) => {
    const msg = { id: `80000000000000000${sent.length + 1}`, payload, edit: vi.fn(async () => undefined) };
    sent.push(msg);
    return msg;
  }),
  delete: vi.fn(async () => undefined),
  messages: {
    fetchPinned: vi.fn(async () => new Collection([['welcome', welcome]])),
    fetch: vi.fn(async (arg: unknown) => (typeof arg === 'string' ? (sent.find((m) => m.id === arg) ?? null) : new Collection())),
    delete: vi.fn(async () => undefined),
  },
};
const client = {
  channels: { fetch: vi.fn(async (id: string) => (id === CHANNEL ? channel : id === LOG_CHANNEL ? logChannel : null)) },
  users: { fetch: vi.fn(async () => user) },
  guilds: { cache: new Collection([[GUILD, guild]]) },
  bus: { emit: vi.fn() },
};

const transcriptResult = {
  record: { id: 9, ticketId: 10, messageCount: 3 },
  files: { htmlPath: '/tmp/ticket-7.html', txtPath: '/tmp/ticket-7.txt', pdfPath: '/tmp/ticket-7.pdf', messageCount: 3, durationSeconds: 60 },
  data: { guildId: GUILD, guildName: 'RS Battle Royale', ticketNumber: 7, ticketId: 10, typeLabel: 'Support', creator: { id: OPENER, tag: '@opener' }, closedBy: { id: MOD, tag: '@mod' }, openedAt: new Date(Date.now() - 60_000), closedAt: new Date(), participants: [], formAnswers: [], messages: [], language: 'fr' },
};

const buttons = (msg: (typeof sent)[number]) => msg.payload.components!.flatMap((r) => r.toJSON().components);
const editsFor = (id: string) => channel.permissionOverwrites.edit.mock.calls.filter((c) => (c as unknown[])[0] === id).map((c) => (c as unknown[])[1]);

beforeAll(() => {
  ticketService.attach(client as never);
});

beforeEach(() => {
  vi.clearAllMocks();
  sent = [];
  channel.parentId = OPEN_CAT;
  categories = new Collection([
    [OPEN_CAT, category(OPEN_CAT, 3)],
    [CLOSED_CAT, category(CLOSED_CAT, 10)],
  ]);
  row = { id: 10, guildId: GUILD, number: 7, channelId: CHANNEL, typeId: 1, userId: OPENER, status: 'OPEN', title: 'Bug boutique', closedById: null, closeReason: null, closedAt: null, formAnswers: [], participants: [FRIEND, MOD], language: 'fr', lastStaffReplyAt: null, lastMemberMessageAt: null, lastReminderAt: null, remindersMuted: false, openCategoryId: null, closeMessageId: null, transcriptSentAt: null, createdAt: new Date(Date.now() - 3_600_000), updatedAt: new Date(), type: typeRow, transcript: null };
  prisma.ticket.findUnique.mockImplementation(async () => ({ ...row }));
  prisma.ticket.findFirst.mockImplementation(async () => ({ ...row }));
  prisma.ticket.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    row = { ...row, ...data };
    return { ...row };
  });
  prisma.ticketType.findUnique.mockResolvedValue(typeRow);
  prisma.ticketSettings.findUnique.mockResolvedValue({ guildId: GUILD, closedCategoryId: CLOSED_CAT });
  vi.spyOn(ticketService, 'generateTranscript').mockResolvedValue(transcriptResult as never);
});

describe('Fermeture : le salon est conservé', () => {
  it('accès retiré au créateur et aux membres ajoutés (pas au staff), salon déplacé, aucun transcript ni DM', async () => {
    const { category: decision } = await ticketService.closeTicket({ ticketId: 10, closedById: MOD, reason: 'Résolu' });
    expect(row.status).toBe('CLOSED');
    expect(row.openCategoryId).toBe(OPEN_CAT);
    expect(editsFor(OPENER)).toEqual([{ ViewChannel: false, SendMessages: false }]);
    expect(editsFor(FRIEND)).toEqual([{ ViewChannel: false, SendMessages: false }]);
    expect(editsFor(MOD)).toEqual([]);
    expect(channel.permissionOverwrites.edit.mock.calls[0]![2]).toEqual({ type: OverwriteType.Member });
    expect(channel.setParent).toHaveBeenCalledWith(CLOSED_CAT, { lockPermissions: false });
    expect(decision).toEqual({ action: 'move', categoryId: CLOSED_CAT, source: 'setting' });
    expect(channel.delete).not.toHaveBeenCalled();
    expect(ticketService.generateTranscript).not.toHaveBeenCalled();
    expect(user.send).not.toHaveBeenCalled();
    expect(ticketService.isTicketChannel(CHANNEL)).toBe(false);
    // Message d'accueil : boutons retirés ; message de contrôle staff posté et mémorisé
    expect(welcome.edit).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
    expect(sent).toHaveLength(1);
    expect(buttons(sent[0]!).map((b) => b.custom_id)).toEqual(['ticket:transcript:10', 'ticket:reopen:10', 'ticket:delete:10']);
    expect(row.closeMessageId).toBe(sent[0]!.id);
  });

  it('sans réglage : catégorie par défaut 1557072815700574240 si elle existe', async () => {
    prisma.ticketSettings.findUnique.mockResolvedValue(null);
    categories.set('1557072815700574240', category('1557072815700574240', 0));
    await ticketService.closeTicket({ ticketId: 10, closedById: MOD });
    expect(channel.setParent).toHaveBeenCalledWith('1557072815700574240', { lockPermissions: false });
  });

  it('aucune catégorie ou catégorie pleine (50 salons) : le salon reste en place', async () => {
    prisma.ticketSettings.findUnique.mockResolvedValue(null);
    await ticketService.closeTicket({ ticketId: 10, closedById: MOD });
    expect(channel.setParent).not.toHaveBeenCalled();
    expect(row.status).toBe('CLOSED');

    row = { ...row, status: 'OPEN' };
    prisma.ticketSettings.findUnique.mockResolvedValue({ guildId: GUILD, closedCategoryId: CLOSED_CAT });
    categories.set(CLOSED_CAT, category(CLOSED_CAT, 50));
    const { category: decision } = await ticketService.closeTicket({ ticketId: 10, closedById: MOD });
    expect(channel.setParent).not.toHaveBeenCalled();
    expect(decision).toEqual({ action: 'stay', reason: 'full', categoryId: CLOSED_CAT, source: 'setting' });
  });

  it('un ticket déjà fermé ne se referme pas', async () => {
    row = { ...row, status: 'CLOSED' };
    await expect(ticketService.closeTicket({ ticketId: 10, closedById: MOD })).rejects.toMatchObject({ code: 'already_closed' });
  });
});

describe('Message de contrôle : 📄 Transcript · 🔓 Rouvrir · 🗑️ Supprimer', () => {
  it('📄 génère, enregistre, envoie en DM au créateur (une seule fois) et passe à « Transcript envoyé »', async () => {
    await ticketService.closeTicket({ ticketId: 10, closedById: MOD });
    const control = sent[0]!;
    const result = await ticketService.sendClosedTranscript({ ticketId: 10, byId: MOD });
    expect(ticketService.generateTranscript).toHaveBeenCalledTimes(1);
    expect(result.dm).toBe('sent');
    expect(result.logged).toBe(true);
    expect(user.send).toHaveBeenCalledTimes(1);
    expect(logChannel.send).toHaveBeenCalledTimes(1);
    expect(row.transcriptSentAt).toBeInstanceOf(Date);
    const edited = (control.edit.mock.calls[0]![0] as { components: (typeof sent)[number]['payload']['components'] }).components!;
    const transcriptBtn = edited.flatMap((r) => r.toJSON().components)[0]!;
    expect(transcriptBtn).toMatchObject({ custom_id: 'ticket:transcript:10', disabled: true, label: 'Transcript envoyé' });
    await expect(ticketService.sendClosedTranscript({ ticketId: 10, byId: MOD })).rejects.toMatchObject({ code: 'transcript_already_sent' });
    expect(user.send).toHaveBeenCalledTimes(1);
  });

  it('📄 avec DM fermés : transcript enregistré quand même, échec signalé au staff', async () => {
    await ticketService.closeTicket({ ticketId: 10, closedById: MOD });
    user.send.mockRejectedValueOnce(new Error('Cannot send messages to this user'));
    const result = await ticketService.sendClosedTranscript({ ticketId: 10, byId: MOD });
    expect(result.dm).toBe('failed');
    expect(row.transcriptSentAt).toBeInstanceOf(Date);
  });

  it('📄 refusé sur un ticket ouvert', async () => {
    await expect(ticketService.sendClosedTranscript({ ticketId: 10, byId: MOD })).rejects.toBeInstanceOf(TicketError);
    expect(ticketService.generateTranscript).not.toHaveBeenCalled();
  });

  it('🔓 rouvre : accès rendu aux membres, catégorie d’origine, relances relancées, message de contrôle retiré', async () => {
    await ticketService.closeTicket({ ticketId: 10, closedById: MOD });
    const controlId = row.closeMessageId;
    vi.clearAllMocks();
    const before = Date.now();
    await ticketService.reopenTicket({ ticketId: 10, byId: MOD });
    expect(row.status).toBe('OPEN');
    expect(row.closedAt).toBeNull();
    expect(row.transcriptSentAt).toBeNull();
    expect((row.lastReminderAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    const allow = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true };
    expect(editsFor(OPENER)).toEqual([allow]);
    expect(editsFor(FRIEND)).toEqual([allow]);
    expect(editsFor(MOD)).toEqual([]);
    expect(channel.setParent).toHaveBeenCalledWith(OPEN_CAT, { lockPermissions: false });
    expect(channel.messages.delete).toHaveBeenCalledWith(controlId);
    expect(ticketService.isTicketChannel(CHANNEL)).toBe(true);
    // Boutons de gestion rétablis sur le message d'accueil
    const restored = (welcome.edit.mock.calls.at(-1)![0] as { components: unknown[] }).components;
    expect(restored.length).toBeGreaterThan(0);
    expect(ticketService.generateTranscript).not.toHaveBeenCalled();
  });

  it('🗑️ supprime le salon sans générer de transcript ni DM', async () => {
    await ticketService.closeTicket({ ticketId: 10, closedById: MOD });
    await ticketService.deleteTicket({ ticketId: 10, byId: MOD });
    expect(row.status).toBe('DELETED');
    expect(channel.delete).toHaveBeenCalledTimes(1);
    expect(ticketService.generateTranscript).not.toHaveBeenCalled();
    expect(user.send).not.toHaveBeenCalled();
    expect(logChannel.send).not.toHaveBeenCalled();
  });

  it('salon supprimé à la main : statut DELETED, aucun transcript automatique', async () => {
    prisma.ticketMessage.count.mockResolvedValue(12);
    await ticketService.markChannelDeleted(CHANNEL, GUILD);
    expect(row.status).toBe('DELETED');
    expect(ticketService.generateTranscript).not.toHaveBeenCalled();
  });
});

describe('buildClosedControls', () => {
  it('état du bouton 📄 : actif avant, désactivé « Transcript envoyé » après', () => {
    const before = ticketService.buildClosedControls({ id: 4, transcriptSentAt: null }, t)[0]!.toJSON().components as { custom_id: string; disabled?: boolean; label: string }[];
    expect(before.map((b) => b.custom_id)).toEqual(['ticket:transcript:4', 'ticket:reopen:4', 'ticket:delete:4']);
    expect(before[0]!.disabled).toBeFalsy();
    expect(before[0]!.label).toBe('tickets.closed.btn_transcript');
    const after = ticketService.buildClosedControls({ id: 4, transcriptSentAt: new Date() }, t)[0]!.toJSON().components as { disabled?: boolean; label: string }[];
    expect(after[0]).toMatchObject({ disabled: true, label: 'tickets.closed.btn_transcript_sent' });
    expect(after[1]!.disabled).toBeFalsy();
    expect(after[2]!.disabled).toBeFalsy();
  });
});
