import { describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});

import { prisma } from '../../src/database/client';
import { TicketService } from '../../src/services/TicketService';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;

function message(id: string, channelId = 'chan-1') {
  return {
    id,
    channelId,
    system: false,
    content: `msg ${id}`,
    createdAt: new Date(),
    inGuild: () => true,
    client: { user: { id: 'bot' } },
    author: { id: 'u1', tag: 'alice', displayAvatarURL: () => null },
    attachments: { map: () => [] },
    embeds: [],
  } as never;
}

describe('TicketService.flushMessages', () => {
  it('un flush concurrent (transcript à la fermeture) attend l’écriture en cours puis écrit le reste', async () => {
    const svc = new TicketService();
    db.ticket.findMany.mockResolvedValue([{ id: 7, channelId: 'chan-1' }]);
    await svc.loadOpenChannels();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    db.ticketMessage.createMany.mockImplementationOnce(async () => {
      await gate;
      return { count: 1 };
    });
    db.ticketMessage.createMany.mockResolvedValue({ count: 1 });

    svc.recordMessage(message('m1'));
    const scheduled = svc.flushMessages(); // tâche planifiée
    svc.recordMessage(message('m2')); // posté pendant l'écriture
    let closeFlushDone = false;
    const beforeTranscript = svc.flushMessages().then(() => (closeFlushDone = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(closeFlushDone).toBe(false); // ne rend pas la main avant la fin de l'écriture en cours
    release();
    await Promise.all([scheduled, beforeTranscript]);
    const written = db.ticketMessage.createMany.mock.calls.flatMap((c) => (c[0] as { data: { messageId: string }[] }).data.map((d) => d.messageId));
    expect(written).toEqual(['m1', 'm2']);
  });
});
