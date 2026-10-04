import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { mentionLine, parseAnnouncement, renderAnnouncement } from '../../src/services/AnnouncementService';

const base = { spec: { title: 'Saison 2', description: 'Nouveautés' }, content: null as string | null, buttons: [], mentionEveryone: false, mentionRoleIds: [] as string[] };

describe('mentionLine', () => {
  it('assemble @everyone et les rôles', () => {
    expect(mentionLine({ mentionEveryone: true, mentionRoleIds: ['1', '2'] })).toBe('@everyone <@&1> <@&2>');
    expect(mentionLine({ mentionEveryone: false, mentionRoleIds: [] })).toBe('');
  });
});

describe('renderAnnouncement', () => {
  it('un embed + mentions + contenu au-dessus', () => {
    const spec = renderAnnouncement({ ...base, content: 'Texte', mentionEveryone: true, mentionRoleIds: ['9'] });
    expect(spec.content).toBe('@everyone <@&9>\nTexte');
    expect(spec.embeds).toEqual([base.spec]);
    expect(spec.buttons).toBeUndefined();
  });
  it('sans mentions ni contenu : pas de texte', () => {
    expect(renderAnnouncement(base).content).toBeUndefined();
  });
  it('peut omettre les mentions et garde les boutons', () => {
    const spec = renderAnnouncement({ ...base, mentionEveryone: true, content: 'X', buttons: [{ label: 'Site', style: 'link', url: 'https://example.com' }] }, { includeMentions: false });
    expect(spec.content).toBe('X');
    expect(spec.buttons).toHaveLength(1);
  });
});

describe('parseAnnouncement', () => {
  it('ignore le champ `language` des anciennes références de messages', () => {
    const ann = parseAnnouncement({
      id: 1, guildId: 'g', title: 't', content: null, spec: { title: 'a' }, channelId: 'c', mentionRoleIds: [], mentionEveryone: false, buttons: [], status: 'PUBLISHED',
      messages: [{ channelId: 'c', messageId: 'm', language: 'fr' }], createdById: 'u', publishedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    } as never);
    expect(ann.messages).toEqual([{ channelId: 'c', messageId: 'm' }]);
  });
});
