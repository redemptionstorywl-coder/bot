import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { planPublication, resolveTargetLanguages } from '../../src/services/AnnouncementService';

const base = { channelId: 'main', sourceLanguage: 'fr', targetLanguages: '*' as const };

describe('resolveTargetLanguages', () => {
  it("'*' = toutes les langues activées, source en premier", () => {
    expect(resolveTargetLanguages(base, ['en', 'fr', 'es'])).toEqual(['fr', 'en', 'es']);
  });
  it('filtre les langues non activées et conserve toujours la source', () => {
    expect(resolveTargetLanguages({ ...base, targetLanguages: ['de', 'en'] }, ['fr', 'en'])).toEqual(['fr', 'en']);
    expect(resolveTargetLanguages({ ...base, targetLanguages: ['en'] }, ['en'])).toEqual(['fr', 'en']);
  });
});

describe('planPublication — mode CHANNELS', () => {
  it('envoie chaque langue dans son salon dédié et regroupe les autres dans le salon principal', () => {
    const plan = planPublication(base, { translationMode: 'CHANNELS', languageChannels: { en: 'ch-en', es: 'ch-es' }, enabledLanguages: ['fr', 'en', 'es', 'de'] });
    expect(plan).toHaveLength(3);
    expect(plan.find((p) => p.language === 'en')).toMatchObject({ channelId: 'ch-en', languageHeader: false });
    expect(plan.find((p) => p.language === 'es')).toMatchObject({ channelId: 'ch-es' });
    const fallback = plan.find((p) => p.channelId === 'main');
    expect(fallback).toMatchObject({ language: 'fr', coveredLanguages: ['fr', 'de'] });
  });

  it('n’envoie qu’une fois dans le salon principal quand aucune langue n’a de salon dédié', () => {
    const plan = planPublication(base, { translationMode: 'CHANNELS', languageChannels: {}, enabledLanguages: ['fr', 'en', 'es'] });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ channelId: 'main', language: 'fr', coveredLanguages: ['fr', 'en', 'es'], includeMentions: true });
  });

  it('fusionne quand le salon dédié de la langue source est aussi le salon principal', () => {
    const plan = planPublication(base, { translationMode: 'CHANNELS', languageChannels: { fr: 'main', en: 'ch-en' }, enabledLanguages: ['fr', 'en', 'de'] });
    expect(plan).toHaveLength(2);
    expect(plan.find((p) => p.channelId === 'main')?.coveredLanguages).toEqual(['fr', 'de']);
  });

  it('retourne un plan vide sans salon principal ni salon de langue', () => {
    expect(planPublication({ ...base, channelId: null }, { translationMode: 'CHANNELS', languageChannels: {}, enabledLanguages: ['fr', 'en'] })).toEqual([]);
  });

  it('fonctionne sans salon principal si toutes les langues ont un salon dédié', () => {
    const plan = planPublication({ ...base, channelId: null }, { translationMode: 'CHANNELS', languageChannels: { fr: 'ch-fr', en: 'ch-en' }, enabledLanguages: ['fr', 'en'] });
    expect(plan.map((p) => p.channelId).sort()).toEqual(['ch-en', 'ch-fr']);
  });
});

describe('planPublication — mode PERMISSIONS', () => {
  it('envoie un message par langue dans le salon principal, préfixé, mentions sur le premier seulement', () => {
    const plan = planPublication(base, { translationMode: 'PERMISSIONS', languageChannels: { en: 'ignored' }, enabledLanguages: ['fr', 'en', 'es'] });
    expect(plan).toHaveLength(3);
    expect(plan.every((p) => p.channelId === 'main' && p.languageHeader)).toBe(true);
    expect(plan[0]).toMatchObject({ language: 'fr', includeMentions: true });
    expect(plan.slice(1).every((p) => !p.includeMentions)).toBe(true);
  });

  it('pas d’en-tête de langue quand une seule langue est ciblée', () => {
    const plan = planPublication({ ...base, targetLanguages: ['fr'] }, { translationMode: 'PERMISSIONS', languageChannels: {}, enabledLanguages: ['fr', 'en'] });
    expect(plan).toEqual([{ channelId: 'main', language: 'fr', coveredLanguages: ['fr'], languageHeader: false, includeMentions: true }]);
  });

  it('retourne un plan vide sans salon principal', () => {
    expect(planPublication({ ...base, channelId: null }, { translationMode: 'PERMISSIONS', languageChannels: {}, enabledLanguages: ['fr'] })).toEqual([]);
  });
});
