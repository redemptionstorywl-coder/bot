import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { protectText, restoreText, segmentText, MachineTranslationService, type TranslationProvider } from '../../src/services/MachineTranslationService';

describe('protectText / restoreText', () => {
  it('protège placeholders, mentions, URLs et code puis les restaure', () => {
    const src = 'Bienvenue {user} sur {server} ! Voir <#123> et https://example.com `code` <:emoji:456>';
    const p = protectText(src);
    expect(p.text).not.toContain('{user}');
    expect(p.text).not.toContain('https://example.com');
    const restored = restoreText(p.text, p.tokens);
    expect(restored).toBe(src);
  });
  it('réinjecte un token perdu en fin de segment', () => {
    const p = protectText('Salut {user} !');
    const broken = 'Hi !';
    const restored = restoreText(broken, p.tokens);
    expect(restored).toContain('{user}');
  });
});

describe('segmentText', () => {
  it('découpe sans dépasser la taille maximale', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Phrase numéro ${i} assez longue pour compter.`).join(' ');
    const segments = segmentText(text, 120);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) expect(s.text.length).toBeLessThanOrEqual(120);
  });
});

describe('MachineTranslationService', () => {
  const failing: TranslationProvider = { name: 'fail', translate: async () => { throw new Error('down'); } };
  const ok: TranslationProvider = { name: 'ok', translate: async (t, _f, to) => `[${to}] ${t}` };

  it('bascule sur le fournisseur suivant en cas d’erreur', async () => {
    const svc = new MachineTranslationService();
    svc.setProviders([failing, ok]);
    expect(await svc.translate('Bonjour', 'fr', 'en')).toBe('[en] Bonjour');
  });
  it('ne traduit pas si source = cible ou texte vide', async () => {
    const svc = new MachineTranslationService();
    svc.setProviders([ok]);
    expect(await svc.translate('Bonjour', 'fr', 'fr')).toBe('Bonjour');
    expect(await svc.translate('   ', 'fr', 'en')).toBe('   ');
  });
  it('traduit un EmbedSpec sans toucher aux URLs ni à la couleur', async () => {
    const svc = new MachineTranslationService();
    svc.setProviders([ok]);
    const out = await svc.translateEmbedSpec({ title: 'Titre', description: 'Desc', color: '#7C3AED', image: 'https://x/y.png', fields: [{ name: 'A', value: 'B', inline: false }] }, 'fr', 'en');
    expect(out.title).toBe('[en] Titre');
    expect(out.color).toBe('#7C3AED');
    expect(out.image).toBe('https://x/y.png');
    expect(out.fields?.[0]?.value).toBe('[en] B');
  });
  it('lève une erreur typée si tous les fournisseurs échouent', async () => {
    const svc = new MachineTranslationService();
    svc.setProviders([failing]);
    await expect(svc.translate('Bonjour', 'fr', 'en')).rejects.toThrow();
  });
});
