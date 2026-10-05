import { describe, expect, it } from 'vitest';
import type { EmbedSpec } from '../../src/services/EmbedService';
import {
  applyEmbedTexts,
  bilingualLabel,
  bilingualOption,
  collectEmbedTexts,
  composeContent,
  composeEmbeds,
  DISCORD_LIMITS,
  embedTextLength,
  EN_LABEL,
  FR_LABEL,
  isEnglishEmbed,
  mergeEmbedCompact,
  SEPARATOR_LINE,
  stripContentTranslation,
  stripEmbedTranslation,
  truncate,
} from '../../src/services/autotranslate/bilingual';

const spec: EmbedSpec = {
  title: 'Comment jouer',
  description: 'Rejoins le serveur et lis les règles.',
  color: '#7C3AED',
  url: 'https://redemption-story.fr',
  image: 'https://cdn.example.com/banner.png',
  thumbnail: 'https://cdn.example.com/logo.png',
  footer: { text: 'Bon jeu', iconUrl: 'https://cdn.example.com/icon.png' },
  author: { name: 'Équipe', iconUrl: 'https://cdn.example.com/a.png' },
  timestamp: true,
  fields: [
    { name: 'Étape 1', value: 'Installer FiveM', inline: true },
    { name: 'Étape 2', value: 'Se connecter', inline: false },
  ],
};
const english = (s: string) => `EN:${s}`;

describe('applyEmbedTexts', () => {
  it('traduit titre, description, champs, footer et auteur sans toucher URLs, couleur, images ni horodatage', () => {
    const texts = collectEmbedTexts(spec);
    expect(texts).toEqual(['Comment jouer', 'Rejoins le serveur et lis les règles.', 'Bon jeu', 'Équipe', 'Étape 1', 'Installer FiveM', 'Étape 2', 'Se connecter']);
    const out = applyEmbedTexts(spec, texts.map(english))!;
    expect(out.title).toBe('EN:Comment jouer');
    expect(out.description).toBe('EN:Rejoins le serveur et lis les règles.');
    expect(out.footer).toEqual({ text: 'EN:Bon jeu', iconUrl: 'https://cdn.example.com/icon.png' });
    expect(out.author).toEqual({ name: 'EN:Équipe', iconUrl: 'https://cdn.example.com/a.png' });
    expect(out.fields).toEqual([
      { name: 'EN:Étape 1', value: 'EN:Installer FiveM', inline: true },
      { name: 'EN:Étape 2', value: 'EN:Se connecter', inline: false },
    ]);
    for (const k of ['color', 'url', 'image', 'thumbnail', 'timestamp'] as const) expect(out[k]).toEqual(spec[k]);
  });

  it('retourne null quand rien n’est traduit et tronque aux limites Discord', () => {
    expect(applyEmbedTexts(spec, collectEmbedTexts(spec).map(() => null))).toBeNull();
    const out = applyEmbedTexts({ title: 'Titre', description: 'Desc' }, ['T'.repeat(400), 'D'.repeat(5000)])!;
    expect(out.title!.length).toBe(DISCORD_LIMITS.title);
    expect(out.description!.length).toBe(DISCORD_LIMITS.description);
    expect(out.title!.endsWith('…')).toBe(true);
  });
});

describe('composeEmbeds', () => {
  const en = applyEmbedTexts(spec, collectEmbedTexts(spec).map(english))!;

  it('layout embed : embed français marqué 🇫🇷 puis embed anglais marqué 🇬🇧, sans doublon de grande image', () => {
    const [fr, eng] = composeEmbeds([spec], [en], 'embed');
    expect(fr!.footer!.text).toBe('🇫🇷 · Bon jeu');
    expect(fr!.image).toBe(spec.image);
    expect(eng!.footer!.text).toBe('🇬🇧 · EN:Bon jeu');
    expect(eng!.image).toBeUndefined();
    expect(eng!.thumbnail).toBe(spec.thumbnail);
    const [bare, bareEn] = composeEmbeds([{ title: 'Salut' }], [{ title: 'Hi' }], 'embed');
    expect(bare!.footer!.text).toBe(FR_LABEL);
    expect(bareEn!.footer!.text).toBe(EN_LABEL);
    expect(isEnglishEmbed(bareEn!.footer!.text)).toBe(true);
    expect(isEnglishEmbed(bare!.footer!.text)).toBe(false);
  });

  it('layout content : traduction dans le même embed après la ligne 🇬🇧, et retour arrière possible', () => {
    const [merged, extra] = composeEmbeds([spec], [en], 'content');
    expect(extra).toBeUndefined();
    expect(merged!.description).toBe(`${spec.description}\n\n${SEPARATOR_LINE}\n**EN:Comment jouer**\nEN:${spec.description}`);
    expect(merged!.fields![0]!.value).toBe('Installer FiveM\n🇬🇧 **EN:Étape 1** · EN:Installer FiveM');
    expect(merged!.fields![0]!.name).toBe('Étape 1');
    expect(stripEmbedTranslation(merged!)).toEqual(spec);
    expect(stripEmbedTranslation(markedFooter())).toEqual({ title: 'X', footer: { text: 'Bon jeu' } });
  });

  it('layout content : repli sur un embed séparé si la description dépasserait 4096 caractères', () => {
    const long: EmbedSpec = { description: 'a '.repeat(1500).trim() };
    expect(mergeEmbedCompact(long, { description: 'b '.repeat(1500).trim() })).toBeNull();
    const out = composeEmbeds([long], [{ description: 'b '.repeat(1500).trim() }], 'content');
    expect(out).toHaveLength(2);
  });

  it('respecte 6000 caractères au total : raccourcit puis retire l’embed anglais', () => {
    const big: EmbedSpec = { title: 'T', description: 'f'.repeat(3500) };
    const out = composeEmbeds([big], [{ title: 'T2', description: 'e'.repeat(3500) }], 'embed');
    expect(out).toHaveLength(2);
    expect(out.reduce((n, e) => n + embedTextLength(e), 0)).toBeLessThanOrEqual(DISCORD_LIMITS.embedTotal);
    const huge: EmbedSpec = { description: 'f'.repeat(4096), fields: Array.from({ length: 2 }, () => ({ name: 'n', value: 'v'.repeat(900), inline: false })) };
    const enHuge: EmbedSpec = { description: 'x', fields: Array.from({ length: 2 }, () => ({ name: 'n', value: 'w'.repeat(900), inline: false })) };
    const dropped = composeEmbeds([huge], [enHuge], 'embed');
    expect(dropped).toEqual([huge]); // embed anglais retiré, embed français restauré sans marqueur
  });
});

function markedFooter(): EmbedSpec {
  return { title: 'X', footer: { text: '🇫🇷 · Bon jeu' } };
}

describe('composeContent', () => {
  it('ajoute la version anglaise après la ligne 🇬🇧 en respectant 2000 caractères', () => {
    expect(composeContent('Salut', 'Hello')).toBe(`Salut\n\n${SEPARATOR_LINE}\nHello`);
    expect(composeContent('Salut', null)).toBe('Salut');
    expect(composeContent('Salut', 'Salut')).toBe('Salut');
    const long = composeContent('a'.repeat(1500), 'b'.repeat(1500))!;
    expect(long.length).toBe(2000);
    expect(composeContent('a'.repeat(1995), 'b')).toBe('a'.repeat(1995));
    expect(stripContentTranslation(composeContent('Salut', 'Hello')!)).toBe('Salut');
    expect(composeContent('a'.repeat(100), 'b'.repeat(100), 150)!.length).toBe(150);
  });
});

describe('libellés de composants', () => {
  it('« FR / EN » si cela tient, sinon français + description anglaise', () => {
    expect(bilingualLabel('Ouvrir un ticket', 'Open a ticket', 80)).toBe('Ouvrir un ticket / Open a ticket');
    expect(bilingualLabel('Support', 'Support', 80)).toBe('Support');
    expect(bilingualOption({ label: 'Signalement', description: 'Signaler un joueur' }, { label: 'Report', description: 'Report a player' })).toEqual({ label: 'Signalement / Report', description: 'Signaler un joueur / Report a player' });
    const longFr = 'Demande de remboursement pour un achat effectué sur la boutique en ligne du serveur';
    const longEn = 'Refund request for a purchase made on the server online shop';
    expect(bilingualOption({ label: longFr }, { label: longEn })).toEqual({ label: longFr, description: `🇬🇧 ${longEn}` });
    const descFr = 'Une description française déjà assez longue pour occuper la place';
    const descEn = 'A French description that is already long enough to fill the room';
    expect(bilingualOption({ label: 'Aide', description: descFr }, { label: 'Help', description: descEn })).toEqual({ label: 'Aide / Help', description: descEn });
  });

  it('truncate ne coupe jamais un emoji en deux', () => {
    const s = `${'a'.repeat(8)}😀😀`;
    const out = truncate(s, 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out).toBe(`${'a'.repeat(8)}…`);
  });
});
