import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guild, GuildMember } from 'discord.js';
import { PanelStyle, type TicketPanel, type TicketType, type WelcomeConfig } from '@prisma/client';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma as prismaClient } from '../../src/database/client';
import { autoTranslateService } from '../../src/services/AutoTranslateService';
import { guildConfigService } from '../../src/services/GuildConfigService';
import { announcementService, parseAnnouncement } from '../../src/services/AnnouncementService';
import { renderWelcome, welcomeService, WELCOME_IMAGE_FILENAME } from '../../src/services/WelcomeService';
import { ticketService } from '../../src/services/TicketService';
import { SEPARATOR_LINE } from '../../src/services/autotranslate/bilingual';
import type { TranslationProvider } from '../../src/services/autotranslate/providers';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;
const GUILD = '222222222222222222';

/** « Traduction » déterministe : préfixe EN: (jetons protégés conservés tels quels). */
const provider: TranslationProvider & { calls: string[][] } = {
  name: 'fake',
  calls: [],
  async translate(texts) {
    this.calls.push(texts);
    return texts.map((t) => ({ text: `EN:${t}` }));
  },
};

function enableTranslation(enabled: boolean, layout: 'embed' | 'content' = 'embed'): void {
  prisma.guild.findUnique.mockResolvedValue({ id: GUILD, name: 'Redemption Story', kind: 'GENERIC', settings: null, logChannels: [] });
  prisma.autoTranslateSettings.findUnique.mockResolvedValue({ guildId: GUILD, enabled, layout });
  prisma.autoTranslateOverride.findUnique.mockResolvedValue(null);
  prisma.translationCache.findMany.mockResolvedValue([]);
  prisma.translationCache.createMany.mockResolvedValue({ count: 0 });
  guildConfigService.invalidate(GUILD);
  autoTranslateService.clearMemory();
}

beforeEach(() => {
  provider.calls = [];
  autoTranslateService.setProviders([provider]);
});

function fakeMember(): GuildMember {
  const user = { id: '111111111111111111', username: 'alice', discriminator: '0', bot: false, createdTimestamp: 1_600_000_000_000, displayName: 'Alice', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' };
  const guild = { id: GUILD, name: 'Redemption Story', memberCount: 1234, roles: { cache: new Map() } };
  return { id: user.id, user, guild, displayName: 'Alice', joinedTimestamp: 1_700_000_000_000, roles: { cache: new Map() } } as unknown as GuildMember;
}

function welcomeConfig(overrides: Partial<WelcomeConfig> = {}): WelcomeConfig {
  return { guildId: GUILD, enabled: true, channelId: '333333333333333333', message: null, embed: null, imageEnabled: false, imageBackgroundUrl: null, imageTitle: 'BIENVENUE', imageSubtitle: '{username}', dmEnabled: false, dmMessage: null, dmEmbed: null, buttons: [], updatedAt: new Date(), ...overrides };
}

describe('bienvenue bilingue', () => {
  it('traduit le MODÈLE avant le remplacement des variables (cache commun à toutes les arrivées)', async () => {
    enableTranslation(true, 'embed');
    const config = welcomeConfig({ message: 'Bienvenue {user} sur {server} !', embed: { title: 'Bienvenue', description: 'Lis <#444444444444444444> avant de jouer.' } });
    const translation = await welcomeService.welcomeTranslation(GUILD, config, 'fr', 'fr', 0x2f8bff);
    expect(translation).not.toBeNull();
    expect(provider.calls.flat().some((t) => t.includes('{user}') || t.includes('<#'))).toBe(false);
    const r = renderWelcome(fakeMember(), config, { language: 'fr', translation, image: Buffer.from('png') });
    expect(r.content).toBe(`Bienvenue <@111111111111111111> sur Redemption Story !\n\n${SEPARATOR_LINE}\nEN:Bienvenue <@111111111111111111> sur Redemption Story !`);
    expect(r.embeds).toHaveLength(2);
    const [fr, en] = r.embeds.map((e) => e.toJSON());
    expect(fr!.image?.url).toBe(`attachment://${WELCOME_IMAGE_FILENAME}`);
    expect(fr!.footer?.text).toBe('🇫🇷 Français');
    expect(en!.description).toBe('EN:Lis <#444444444444444444> avant de jouer.');
    expect(en!.image).toBeUndefined();
    // Deuxième arrivée : tout vient du cache.
    await welcomeService.welcomeTranslation(GUILD, config, 'fr', 'fr', 0x2f8bff);
    expect(provider.calls).toHaveLength(1);
  });

  it('désactivé → aucune traduction ; message par défaut doublé en anglais depuis les fichiers de langue', async () => {
    enableTranslation(false);
    expect(await welcomeService.welcomeTranslation(GUILD, welcomeConfig({ message: 'Salut {user}' }), 'fr', 'fr', 0)).toBeNull();
    const t = (key: string) => key;
    const r = renderWelcome(fakeMember(), welcomeConfig(), { language: 'fr', t, translation: { embeds: [], defaultEnglish: true } });
    expect(r.content).toContain(SEPARATOR_LINE);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('annonce bilingue', () => {
  it('mentions jamais dupliquées, texte + embed traduits ; repli français si la traduction échoue', async () => {
    enableTranslation(true, 'embed');
    const ann = parseAnnouncement({
      id: 5, guildId: GUILD, title: 'Saison', content: 'La saison 2 commence ce soir !', spec: { title: 'Saison 2', description: 'Inscriptions ouvertes.' }, channelId: 'c', mentionRoleIds: ['555555555555555555'], mentionEveryone: true,
      buttons: [], status: 'DRAFT', messages: [], createdById: 'u', publishedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const spec = await announcementService.localized(ann);
    expect(spec.content!.match(/@everyone/g)).toHaveLength(1);
    expect(spec.content!.startsWith('@everyone <@&555555555555555555>\nLa saison 2 commence ce soir !')).toBe(true);
    expect(spec.content).toContain('EN:La saison 2 commence ce soir !');
    expect(spec.embeds).toHaveLength(2);
    autoTranslateService.clearMemory();
    autoTranslateService.setProviders([{ name: 'down', translate: async () => Promise.reject(new Error('HTTP 503')) }]);
    const fallback = await announcementService.localized(ann);
    expect(fallback.embeds).toEqual([ann.spec]);
    expect(fallback.content).toBe('@everyone <@&555555555555555555>\nLa saison 2 commence ce soir !');
  });
});

describe('panneau de tickets bilingue', () => {
  const guild = { id: GUILD, name: 'Redemption Story' } as unknown as Guild;
  const type = (id: number, label: string, description: string | null): TicketType => ({ id, guildId: GUILD, key: `k${id}`, label, emoji: '🎫', description, categoryId: null, archiveCategoryId: null, staffRoleIds: [], questions: [], embed: null, welcomeMessage: null, language: 'fr', nameFormat: 'ticket-{number}', maxPerUser: 1, enabled: true, order: id, createdAt: new Date(), updatedAt: new Date() });
  const panel: TicketPanel = { id: 9, guildId: GUILD, channelId: 'c', messageId: null, embed: { title: 'Support', description: 'Ouvrez un ticket pour contacter l’équipe.' }, typeIds: [], style: PanelStyle.SELECT, createdAt: new Date() };

  it('embed anglais + raisons « FR / EN » dans le menu, libellés du bot depuis les fichiers de langue', async () => {
    enableTranslation(true);
    const types = [type(1, 'Signalement', 'Signaler un joueur'), type(2, 'Remboursement d’un achat sur la boutique du serveur Redemption', null)];
    const english = await ticketService.panelEnglish(panel, types, 'fr');
    const message = ticketService.buildPanelMessage(panel, types, guild, 'fr', 0x2f8bff, english);
    expect(message.embeds).toHaveLength(2);
    expect(message.embeds[1]!.toJSON().description).toBe('EN:Ouvrez un ticket pour contacter l’équipe.');
    const select = message.components[0]!.toJSON().components[0] as { placeholder: string; options: { label: string; description?: string }[] };
    expect(select.options[0]).toMatchObject({ label: 'Signalement / EN:Signalement', description: 'Signaler un joueur / EN:Signaler un joueur' });
    expect(select.options[1]!.label).toBe('Remboursement d’un achat sur la boutique du serveur Redemption');
    expect(select.options[1]!.description).toBe('🇬🇧 EN:Remboursement d’un achat sur la boutique du serveur Redemption');
    for (const o of select.options) expect(o.label.length).toBeLessThanOrEqual(100);
    expect(select.placeholder).toContain(' / ');
  });

  it('version anglaise désactivée → panneau inchangé', async () => {
    enableTranslation(false);
    expect(await ticketService.panelEnglish(panel, [type(1, 'Signalement', null)], 'fr')).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });
});
