import { describe, expect, it } from 'vitest';
import { detectLanguage, hasTranslatableText, protectText, restoreText, segmentText } from '../../src/services/autotranslate/text';

describe('protectText / restoreText', () => {
  it('protège variables, mentions, emojis, URLs, code et Markdown puis les restaure à l’identique', () => {
    const src = [
      '# Bienvenue {user} sur **{server}** !',
      '> Lis <#123456789012345678>, puis demande le rôle <@&223456789012345678> à <@323456789012345678> <:rs:423456789012345678>',
      '- Site : https://redemption-story.fr/regles?x=1, et [le wiki](https://wiki.example.com/page)',
      'Commande `/ticket open` ou :',
      '```',
      'code {pas_une_variable} **brut**',
      '```',
      '-# rendez-vous <t:1700000000:R> ~~barré~~ __souligné__ ||spoiler|| *italique*',
    ].join('\n');
    const p = protectText(src);
    for (const kept of ['{user}', '{server}', '<#123456789012345678>', '<@&223456789012345678>', '<@323456789012345678>', '<:rs:423456789012345678>', 'https://redemption-story.fr/regles?x=1', '`/ticket open`', '<t:1700000000:R>', '**', '# ', '> ', '-# ']) {
      expect(p.text).not.toContain(kept);
    }
    expect(p.text).toContain('Bienvenue');
    expect(p.text).toContain('le wiki');
    expect(restoreText(p.text, p.tokens)).toBe(src);
  });

  it('nettoie les espaces ajoutés par le fournisseur autour des marqueurs et des jetons', () => {
    const p = protectText('**Important** : lis <#123456789012345678> !');
    // Simule une sortie de fournisseur : espaces parasites dans les jetons et autour du gras.
    const fake = p.text.replace('⟦0⟧', '⟦ 0 ⟧ ').replace('Important', 'Important ').replace('⟦1⟧', '⟦1 ⟧');
    expect(restoreText(fake, p.tokens)).toBe('**Important** : lis <#123456789012345678> !');
  });

  it('réinjecte une mention / variable perdue et retire un marqueur orphelin', () => {
    const p = protectText('Salut **{user}** !');
    const lost = p.text.replace(/⟦\d+⟧/g, (m) => (m === '⟦0⟧' ? '' : m)).replace('⟦1⟧', '');
    const restored = restoreText(lost, p.tokens);
    expect(restored).toContain('{user}');
    expect(restored).not.toContain('**');
  });

  it('ignore les jetons inventés et ne garde aucun jeton dans le texte final', () => {
    const p = protectText('Bonjour {user}');
    expect(restoreText(`${p.text} ⟦42⟧`, p.tokens)).toBe('Bonjour {user}');
  });

  it('détecte l’absence de texte traduisible', () => {
    expect(hasTranslatableText(protectText('{user} <@123456789012345678> https://x.fr').text)).toBe(false);
    expect(hasTranslatableText(protectText('Salut {user}').text)).toBe(true);
  });
});

describe('segmentText', () => {
  it('découpe sans dépasser la taille maximale et conserve le texte', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Phrase numéro ${i} assez longue pour compter.`).join(' ') + '\n\nDeuxième paragraphe.';
    const segments = segmentText(text, 120);
    expect(segments.length).toBeGreaterThan(2);
    for (const s of segments) if (s.translate) expect(s.text.length).toBeLessThanOrEqual(120);
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });
});

describe('detectLanguage', () => {
  it('reconnaît le français, l’anglais et laisse les textes courts indéterminés', () => {
    expect(detectLanguage('Bienvenue sur le serveur ! Merci de lire les règles avant de jouer.')).toBe('fr');
    expect(detectLanguage('Welcome to the server! Please read the rules before you join the game.')).toBe('en');
    expect(detectLanguage('Support')).toBe('unknown');
  });
});
