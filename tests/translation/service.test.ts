import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma as prismaClient } from '../../src/database/client';
import { AutoTranslateService, sha256 } from '../../src/services/AutoTranslateService';
import { guildConfigService } from '../../src/services/GuildConfigService';
import { buildProviderChain, DeepLProvider, describeProvider, GoogleCloudProvider, MyMemoryProvider, type FetchLike, type TranslationProvider } from '../../src/services/autotranslate/providers';
import { SEPARATOR_LINE } from '../../src/services/autotranslate/bilingual';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;

/** Réponse HTTP minimale pour un fetch simulé (aucun accès réseau dans les tests). */
function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** Fournisseur factice : « traduit » en préfixant EN: (jetons ⟦n⟧ conservés). */
function fakeProvider(name = 'fake', impl?: (texts: string[]) => Promise<{ text: string; detected?: string }[]>): TranslationProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    name,
    calls,
    async translate(texts) {
      calls.push(texts);
      return impl ? impl(texts) : texts.map((t) => ({ text: `EN:${t}` }));
    },
  };
}

let guildSeq = 0;
/** Serveur avec réglage de traduction (modèle AutoTranslateSettings simulé). */
function guildWithTranslation(enabled: boolean, layout: 'embed' | 'content' = 'embed'): string {
  const id = `9000000000000000${String(++guildSeq).padStart(2, '0')}`;
  prisma.guild.findUnique.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id, name: 'RS', kind: 'GENERIC', settings: null, logChannels: [] }));
  prisma.autoTranslateSettings.findUnique.mockImplementation(async (args: { where: { guildId: string } }) => (args.where.guildId === id ? { guildId: id, enabled, layout } : null));
  guildConfigService.invalidate(id);
  return id;
}

beforeEach(() => {
  prisma.translationCache.findMany.mockResolvedValue([]);
  prisma.translationCache.createMany.mockResolvedValue({ count: 0 });
  prisma.autoTranslateOverride.findUnique.mockResolvedValue(null);
});

describe('sélection du fournisseur', () => {
  const fetchImpl: FetchLike = async () => json({});

  it('DeepL si DEEPL_API_KEY, puis Google, MyMemory toujours en dernier (secours)', () => {
    expect(buildProviderChain({}, fetchImpl).map((p) => p.name)).toEqual(['mymemory']);
    expect(buildProviderChain({ GOOGLE_TRANSLATE_API_KEY: 'g' }, fetchImpl).map((p) => p.name)).toEqual(['google', 'mymemory']);
    expect(buildProviderChain({ DEEPL_API_KEY: 'k:fx', GOOGLE_TRANSLATE_API_KEY: 'g' }, fetchImpl).map((p) => p.name)).toEqual(['deepl', 'google', 'mymemory']);
  });

  it('endpoint DeepL Free détecté par le suffixe « :fx », Pro sinon', () => {
    expect(new DeepLProvider('abc:fx', fetchImpl).baseUrl).toBe('https://api-free.deepl.com');
    expect(new DeepLProvider('abc', fetchImpl).baseUrl).toBe('https://api.deepl.com');
    expect(describeProvider({ DEEPL_API_KEY: 'abc:fx' })).toMatchObject({ primary: 'deepl', label: 'DeepL API Free', endpoint: 'api-free.deepl.com' });
    expect(describeProvider({ MYMEMORY_EMAIL: 'a@b.fr' })).toMatchObject({ primary: 'mymemory', mymemoryEmail: true });
  });
});

describe('fournisseurs (fetch simulé)', () => {
  it('DeepL : clé en en-tête, source FR, cible EN-GB, lot de textes ; langue détectée renvoyée', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { text: string[] };
      return json({ translations: body.text.map((t) => ({ text: `EN:${t}`, detected_source_language: 'FR' })) });
    });
    const out = await new DeepLProvider('key:fx', fetchImpl).translate(['Bonjour', 'Salut'], { source: 'fr', target: 'en' });
    expect(out).toEqual([{ text: 'EN:Bonjour', detected: 'fr' }, { text: 'EN:Salut', detected: 'fr' }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect((init!.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key key:fx');
    expect(JSON.parse(String(init!.body))).toMatchObject({ source_lang: 'FR', target_lang: 'EN-GB', text: ['Bonjour', 'Salut'] });
  });

  it('DeepL : quota dépassé (456) → erreur', async () => {
    await expect(new DeepLProvider('k', async () => json({}, 456)).translate(['x'], { target: 'en' })).rejects.toThrow(/quota/);
  });

  it('Google Cloud : clé en paramètre, entités HTML décodées', async () => {
    const fetchImpl = vi.fn(async () => json({ data: { translations: [{ translatedText: 'It&#39;s &quot;ok&quot;', detectedSourceLanguage: 'fr' }] } }));
    const out = await new GoogleCloudProvider('g-key', fetchImpl).translate(['C’est ok'], { target: 'en' });
    expect(out).toEqual([{ text: 'It\'s "ok"', detected: 'fr' }]);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('key=g-key');
  });

  it('MyMemory : avertissement de quota renvoyé en 200 → erreur ; e-mail transmis', async () => {
    const fetchImpl = vi.fn(async () => json({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } }));
    await expect(new MyMemoryProvider(fetchImpl, 'a@b.fr').translate(['Bonjour'])).rejects.toThrow(/MYMEMORY WARNING/);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('de=a%40b.fr');
    const ok = vi.fn(async () => json({ responseStatus: 200, responseData: { translatedText: 'Hello' } }));
    expect(await new MyMemoryProvider(ok).translate(['Bonjour'])).toEqual([{ text: 'Hello' }]);
  });
});

describe('AutoTranslateService.translateTexts', () => {
  it('protège les variables puis restaure ; textes vides / identiques → null', async () => {
    const provider = fakeProvider();
    const svc = new AutoTranslateService({ providers: [provider] });
    const out = await svc.translateTexts(['Bienvenue {user} sur le serveur !', '', '{user}']);
    expect(out).toEqual(['EN:Bienvenue {user} sur le serveur !', null, null]);
    expect(provider.calls[0]![0]).not.toContain('{user}');
  });

  it('cache mémoire : un second envoi ne rappelle pas le fournisseur', async () => {
    const provider = fakeProvider();
    const svc = new AutoTranslateService({ providers: [provider] });
    await svc.translateTexts(['Bonjour à tous les joueurs']);
    await svc.translateTexts(['Bonjour à tous les joueurs']);
    expect(provider.calls).toHaveLength(1);
    expect(prisma.translationCache.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ hash: sha256('Bonjour à tous les joueurs'), targetLang: 'en', provider: 'fake' })] }));
  });

  it('cache base : une traduction déjà stockée est servie sans appel au fournisseur', async () => {
    prisma.translationCache.findMany.mockResolvedValue([{ hash: sha256('Les règles du serveur'), translatedText: 'Server rules' }]);
    const provider = fakeProvider();
    const svc = new AutoTranslateService({ providers: [provider] });
    expect(await svc.translateTexts(['Les règles du serveur'])).toEqual(['Server rules']);
    expect(provider.calls).toHaveLength(0);
  });

  it('texte déjà en anglais (heuristique ou langue détectée EN) → inchangé', async () => {
    const provider = fakeProvider('deepl', async (texts) => texts.map((t) => ({ text: `EN:${t}`, detected: 'en' })));
    const svc = new AutoTranslateService({ providers: [provider] });
    expect(await svc.translateTexts(['Welcome to the server, please read the rules'])).toEqual([null]);
    expect(provider.calls).toHaveLength(0);
    expect(await svc.translateTexts(['Discord Nitro'])).toEqual([null]);
    expect(provider.calls).toHaveLength(1);
  });

  it('bascule sur le fournisseur suivant puis lève une erreur typée si tous échouent', async () => {
    const failing = fakeProvider('deepl', async () => {
      throw new Error('HTTP 503');
    });
    const svc = new AutoTranslateService({ providers: [failing, fakeProvider('mymemory')] });
    expect(await svc.translateTexts(['Bonne soirée à tous'])).toEqual(['EN:Bonne soirée à tous']);
    const dead = new AutoTranslateService({ providers: [failing] });
    await expect(dead.translateTexts(['Bonne nuit à tous'])).rejects.toThrow(/translation_unavailable/);
  });
});

describe('AutoTranslateService.localizeMessage', () => {
  it('désactivé sur le serveur → message inchangé, aucun appel', async () => {
    const guildId = guildWithTranslation(false);
    const provider = fakeProvider();
    const svc = new AutoTranslateService({ providers: [provider] });
    const out = await svc.localizeMessage(guildId, { content: 'Salut', embeds: [{ title: 'Règles' }] });
    expect(out).toMatchObject({ translated: false, failed: false, content: 'Salut', embeds: [{ title: 'Règles' }] });
    expect(provider.calls).toHaveLength(0);
  });

  it('activé : texte après la ligne 🇬🇧 et embed anglais (layout embed), en un seul lot', async () => {
    const guildId = guildWithTranslation(true, 'embed');
    const provider = fakeProvider();
    const svc = new AutoTranslateService({ providers: [provider] });
    const out = await svc.localizeMessage(guildId, { content: 'Nouvelle saison ce soir !', embeds: [{ title: 'Saison 2', description: 'Les inscriptions sont ouvertes.' }] });
    expect(out.translated).toBe(true);
    expect(out.content).toBe(`Nouvelle saison ce soir !\n\n${SEPARATOR_LINE}\nEN:Nouvelle saison ce soir !`);
    expect(out.embeds).toHaveLength(2);
    expect(out.embeds[1]).toMatchObject({ title: 'EN:Saison 2', description: 'EN:Les inscriptions sont ouvertes.', footer: { text: '🇬🇧 English' } });
    expect(provider.calls).toHaveLength(1);
  });

  it('choix du message prioritaire sur le réglage du serveur', async () => {
    const guildId = guildWithTranslation(true);
    prisma.autoTranslateOverride.findUnique.mockResolvedValue({ enabled: false });
    const provider = fakeProvider();
    const svc = new AutoTranslateService({ providers: [provider] });
    const out = await svc.localizeMessage(guildId, { content: 'Bonjour à tous' }, { scope: 'announcement', targetId: '12' });
    expect(out.translated).toBe(false);
    expect(provider.calls).toHaveLength(0);
    expect((await svc.localizeMessage(guildId, { content: 'Bonjour à tous' }, { enabled: true })).translated).toBe(true);
  });

  it('échec de tous les fournisseurs → français seul, sans exception (failed = true)', async () => {
    const guildId = guildWithTranslation(true);
    const fetchImpl = vi.fn(async () => json({}, 500));
    const svc = new AutoTranslateService({ fetch: fetchImpl, providers: buildProviderChain({ DEEPL_API_KEY: 'k:fx' }, fetchImpl) });
    const out = await svc.localizeMessage(guildId, { content: 'Bonjour à tous', embeds: [{ title: 'Règles' }] });
    expect(out).toMatchObject({ translated: false, failed: true, content: 'Bonjour à tous', embeds: [{ title: 'Règles' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // DeepL puis MyMemory
  });

  it('délai dépassé → français seul', async () => {
    const guildId = guildWithTranslation(true);
    const slow = fakeProvider('slow', () => new Promise(() => undefined));
    const svc = new AutoTranslateService({ providers: [slow], timeoutMs: 30 });
    const out = await svc.localizeMessage(guildId, { content: 'Bonjour à tous' });
    expect(out).toMatchObject({ translated: false, failed: true, content: 'Bonjour à tous' });
  });

  it('setChoice : un choix identique au réglage du serveur est retiré (le message suit le serveur)', async () => {
    const guildId = guildWithTranslation(true);
    const svc = new AutoTranslateService({ providers: [fakeProvider()] });
    await svc.setChoice(guildId, 'welcome', 'welcome', true);
    expect(prisma.autoTranslateOverride.deleteMany).toHaveBeenCalledWith({ where: { guildId, scope: 'welcome', targetId: 'welcome' } });
    await svc.setChoice(guildId, 'welcome', 'welcome', false);
    expect(prisma.autoTranslateOverride.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { guildId, scope: 'welcome', targetId: 'welcome', enabled: false } }));
    expect(await svc.getOverride(guildId, 'welcome', 'welcome')).toBe(false);
  });
});
