import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { EmbedTemplateService } from '../../src/services/EmbedTemplateService';

const service = new EmbedTemplateService();

describe('EmbedTemplateService.parseImport', () => {
  it('accepte un EmbedSpec seul et le transforme en MessageSpec', () => {
    const r = service.parseImport(JSON.stringify({ title: 'Hello', description: 'World', color: '#7C3AED' }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.embeds).toHaveLength(1);
      expect(r.data.embeds?.[0]?.title).toBe('Hello');
    }
  });

  it('accepte un MessageSpec complet (content + embeds + buttons)', () => {
    const r = service.parseImport(JSON.stringify({ content: 'Hey', embeds: [{ title: 'A' }], buttons: [{ label: 'Site', style: 'link', url: 'https://example.com' }] }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.content).toBe('Hey');
      expect(r.data.buttons?.[0]?.style).toBe('link');
    }
  });

  it('renvoie une erreur lisible pour un JSON mal formé', () => {
    const r = service.parseImport('{ title: oops }');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.length).toBeGreaterThan(0);
  });

  it('renvoie le chemin fautif pour un spec invalide', () => {
    const r = service.parseImport(JSON.stringify({ title: 'ok', color: 'violet', fields: [{ name: '', value: 'x' }] }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain('color');
    }
  });

  it('refuse les clés inconnues', () => {
    const r = service.parseImport(JSON.stringify({ title: 'ok', foo: 'bar' }));
    expect(r.success).toBe(false);
  });

  it('refuse un bouton lien sans url et un bouton interne sans customId', () => {
    const r = service.parseImport(JSON.stringify({ embeds: [{ title: 'x' }], buttons: [{ label: 'A', style: 'link' }] }));
    expect(r.success).toBe(false);
    const r2 = service.parseImport(JSON.stringify({ embeds: [{ title: 'x' }], buttons: [{ label: 'A', style: 'primary' }] }));
    expect(r2.success).toBe(false);
  });
});

describe('EmbedTemplateService.exportJson', () => {
  it('ré-importe ce qu’il exporte', () => {
    const spec = { content: 'Yo', embeds: [{ title: 'T', fields: [{ name: 'a', value: 'b', inline: true }] }], buttons: [{ label: 'Rôle', style: 'secondary' as const, customId: 'rolemenu:toggle:123' }] };
    const json = service.exportJson(spec);
    const r = service.parseImport(json);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.buttons?.[0]?.customId).toBe('rolemenu:toggle:123');
  });
});

describe('EmbedTemplateService.parseMessageReference', () => {
  it('parse un lien, un couple channel-message et un ID seul', () => {
    expect(service.parseMessageReference('https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333')).toEqual({ channelId: '222222222222222222', messageId: '333333333333333333' });
    expect(service.parseMessageReference('222222222222222222-333333333333333333')).toEqual({ channelId: '222222222222222222', messageId: '333333333333333333' });
    expect(service.parseMessageReference('333333333333333333', '999999999999999999')).toEqual({ channelId: '999999999999999999', messageId: '333333333333333333' });
    expect(service.parseMessageReference('nope')).toBeNull();
  });
});
