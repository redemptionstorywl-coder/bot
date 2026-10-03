import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { announcementTranslationsSchema, hasTranslation, mentionLine, parseAnnouncement, renderAnnouncement, resolveTranslation, type AnnouncementData } from '../../src/services/AnnouncementService';

const ann = {
  spec: { title: 'Maintenance', description: 'Le serveur sera indisponible.', color: '#7C3AED', footer: { text: '{server}' } },
  content: '@everyone Attention',
  sourceLanguage: 'fr',
  translations: {
    en: { title: 'Maintenance (EN)', description: 'The server will be down.' },
    es: { title: '' },
  },
};

describe('resolveTranslation', () => {
  it('retourne la langue source telle quelle', () => {
    const r = resolveTranslation(ann, 'fr');
    expect(r.translated).toBe(false);
    expect(r.spec).toEqual(ann.spec);
    expect(r.content).toBe(ann.content);
  });

  it('fusionne la traduction avec le spec source (couleur / footer conservés)', () => {
    const r = resolveTranslation(ann, 'en');
    expect(r.translated).toBe(true);
    expect(r.spec.title).toBe('Maintenance (EN)');
    expect(r.spec.description).toBe('The server will be down.');
    expect(r.spec.color).toBe('#7C3AED');
    expect(r.spec.footer?.text).toBe('{server}');
    expect(r.content).toBe(ann.content);
  });

  it('retombe sur la source pour une traduction absente ou vide', () => {
    expect(resolveTranslation(ann, 'de').translated).toBe(false);
    expect(resolveTranslation(ann, 'de').spec.title).toBe('Maintenance');
    expect(hasTranslation(ann, 'es')).toBe(false);
    expect(resolveTranslation(ann, 'es').spec.title).toBe('Maintenance');
  });

  it('le contenu traduit remplace le contenu source', () => {
    const r = resolveTranslation({ ...ann, translations: { en: { content: 'Heads up' } } }, 'en');
    expect(r.content).toBe('Heads up');
    expect(r.spec.title).toBe('Maintenance');
  });
});

describe('renderAnnouncement', () => {
  const data: AnnouncementData = {
    id: 1,
    guildId: 'g',
    title: 'Maintenance',
    content: 'Infos',
    spec: ann.spec,
    translations: ann.translations,
    sourceLanguage: 'fr',
    targetLanguages: '*',
    channelId: 'c',
    mentionRoleIds: ['123'],
    mentionEveryone: true,
    buttons: [{ label: 'Site', style: 'link', url: 'https://example.com' }],
    status: 'DRAFT',
    messages: [],
    createdById: 'u',
    publishedAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('compose mentions + contenu et conserve les boutons', () => {
    const spec = renderAnnouncement(data, 'fr');
    expect(spec.content).toBe('@everyone <@&123>\nInfos');
    expect(spec.embeds?.[0]?.title).toBe('Maintenance');
    expect(spec.buttons).toHaveLength(1);
  });

  it('ajoute un en-tête de langue et retire les mentions si demandé', () => {
    const spec = renderAnnouncement(data, 'en', { languageHeader: true, includeMentions: false });
    expect(spec.content?.startsWith('🇺🇸')).toBe(true);
    expect(spec.content).not.toContain('@everyone');
    expect(spec.embeds?.[0]?.title).toBe('Maintenance (EN)');
  });

  it('mentionLine est vide sans mentions', () => {
    expect(mentionLine({ mentionEveryone: false, mentionRoleIds: [] })).toBe('');
  });
});

describe('parseAnnouncement / schémas JSON', () => {
  it('tolère des colonnes JSON corrompues', () => {
    const parsed = parseAnnouncement({
      id: 1,
      guildId: 'g',
      title: 't',
      content: null,
      spec: 'not-an-object',
      translations: 42,
      sourceLanguage: 'fr',
      targetLanguages: [],
      channelId: null,
      mentionRoleIds: 'x',
      mentionEveryone: false,
      buttons: [{ bad: true }],
      status: 'DRAFT',
      messages: null,
      createdById: 'u',
      publishedAt: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    expect(parsed.spec).toEqual({});
    expect(parsed.translations).toEqual({});
    expect(parsed.targetLanguages).toBe('*');
    expect(parsed.buttons).toEqual([]);
    expect(parsed.messages).toEqual([]);
  });

  it('valide la shape des traductions', () => {
    expect(announcementTranslationsSchema.safeParse({ en: { title: 'x', content: 'y' } }).success).toBe(true);
    expect(announcementTranslationsSchema.safeParse({ en: { color: 'rouge' } }).success).toBe(false);
  });
});
