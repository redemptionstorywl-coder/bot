import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { EmbedBuilderSessionStore, generateSessionId, isEmbedEmpty, renderBuilder } from '../../src/services/EmbedBuilderSession';
import { TranslationService } from '../../src/services/TranslationService';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import path from 'node:path';

const translator = new TranslationService(path.resolve(__dirname, '../../src/locales'));

const config = {
  guildId: 'g',
  brandColor: 0x7c3aed,
  enabledLanguages: ['fr', 'en', 'es'],
  translationMode: 'CHANNELS',
  languageChannels: {},
  defaultLanguage: 'fr',
} as unknown as ResolvedGuildConfig;

const user = { id: 'u1', username: 'tester', displayAvatarURL: () => '' } as never;

describe('EmbedBuilderSessionStore', () => {
  it('génère des identifiants courts (8 caractères, sûrs dans un customId)', () => {
    for (let i = 0; i < 20; i++) expect(generateSessionId()).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it('crée, retrouve et supprime une session liée à (guild, user)', () => {
    const store = new EmbedBuilderSessionStore();
    const s = store.create({ guildId: 'g', userId: 'u1', mode: 'embed', spec: { title: 'Hi' } });
    expect(store.get('g', 'u1', s.id)?.spec.title).toBe('Hi');
    expect(store.get('g', 'u2', s.id)).toBeUndefined();
    store.delete(s);
    expect(store.get('g', 'u1', s.id)).toBeUndefined();
  });

  it('isEmbedEmpty détecte un embed sans contenu visible', () => {
    expect(isEmbedEmpty({})).toBe(true);
    expect(isEmbedEmpty({ color: '#000000', timestamp: true })).toBe(true);
    expect(isEmbedEmpty({ fields: [{ name: 'a', value: 'b', inline: false }] })).toBe(false);
  });
});

describe('renderBuilder', () => {
  it('rend la vue embed avec 5 rangées max et des customId < 100 caractères', () => {
    const store = new EmbedBuilderSessionStore();
    const session = store.create({ guildId: 'g', userId: 'u1', mode: 'embed', spec: { title: 'Hello {server}' }, buttons: [{ label: 'Site', style: 'link', url: 'https://x.y' }] });
    for (const lang of ['fr', 'en']) {
      const payload = renderBuilder(session, { t: translator.bind(lang), lang, config, guild: null, member: null, user });
      expect(payload.embeds).toHaveLength(2);
      expect(payload.components.length).toBeLessThanOrEqual(5);
      for (const row of payload.components) {
        const json = row.toJSON();
        expect(json.components.length).toBeLessThanOrEqual(5);
        for (const c of json.components) {
          const id = (c as { custom_id?: string }).custom_id;
          if (id) expect(id.length).toBeLessThan(100);
        }
      }
    }
  });

  it('rend chaque vue du mode annonce sans dépasser 5 rangées', () => {
    const store = new EmbedBuilderSessionStore();
    const session = store.create({
      guildId: 'g',
      userId: 'u1',
      mode: 'announce',
      spec: { title: 'Maintenance' },
      announcement: { status: 'DRAFT', sourceLanguage: 'fr', targetLanguages: '*', translations: { en: { title: 'Maintenance (EN)' } }, mentionRoleIds: ['1'], mentionEveryone: true, channelId: '42' },
    });
    for (const view of ['main', 'embed', 'buttons', 'languages', 'translations', 'mentions', 'channel'] as const) {
      session.view = view;
      const payload = renderBuilder(session, { t: translator.bind('fr'), lang: 'fr', config, guild: null, member: null, user });
      expect(payload.components.length).toBeGreaterThan(0);
      expect(payload.components.length).toBeLessThanOrEqual(5);
    }
  });

  it('affiche la notice une seule fois', () => {
    const store = new EmbedBuilderSessionStore();
    const session = store.create({ guildId: 'g', userId: 'u1', mode: 'embed' });
    session.notice = { type: 'success', text: 'NOTICE_ONCE' };
    const rc = { t: translator.bind('fr'), lang: 'fr', config, guild: null, member: null, user };
    expect(renderBuilder(session, rc).embeds[0]!.toJSON().description).toContain('NOTICE_ONCE');
    expect(renderBuilder(session, rc).embeds[0]!.toJSON().description).not.toContain('NOTICE_ONCE');
  });
});
