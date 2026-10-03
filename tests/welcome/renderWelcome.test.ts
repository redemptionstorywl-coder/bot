import { describe, expect, it, vi } from 'vitest';
import type { GuildMember } from 'discord.js';
import type { LeaveConfig, WelcomeConfig } from '@prisma/client';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { renderLeave, renderWelcome, WELCOME_IMAGE_FILENAME } from '../../src/services/WelcomeService';

function fakeMember(): GuildMember {
  const user = {
    id: '111111111111111111',
    username: 'alice',
    globalName: 'Alice',
    discriminator: '0',
    bot: false,
    createdTimestamp: 1_600_000_000_000,
    displayName: 'Alice',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png',
  };
  const guild = { id: '222222222222222222', name: 'Redemption Story', memberCount: 1234, roles: { cache: new Map() } };
  return { id: user.id, user, guild, displayName: 'Alice', joinedTimestamp: 1_700_000_000_000, roles: { cache: new Map() } } as unknown as GuildMember;
}

function config(overrides: Partial<WelcomeConfig> = {}): WelcomeConfig {
  return {
    guildId: '222222222222222222',
    enabled: true,
    channelId: '333333333333333333',
    message: null,
    embed: null,
    imageEnabled: false,
    imageBackgroundUrl: null,
    imageTitle: 'BIENVENUE',
    imageSubtitle: '{username} · membre #{memberCount}',
    dmEnabled: false,
    dmMessage: null,
    dmEmbed: null,
    buttons: [],
    languagePromptEnabled: false,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('renderWelcome', () => {
  it('rend un message texte avec variables', () => {
    const r = renderWelcome(fakeMember(), config({ message: 'Bienvenue {user} sur {server} ! Membre #{memberCount}' }), { language: 'fr', fallbackLanguage: 'fr' });
    expect(r.content).toBe('Bienvenue <@111111111111111111> sur Redemption Story ! Membre #1234');
    expect(r.embeds).toHaveLength(0);
    expect(r.files).toHaveLength(0);
    expect(r.components).toHaveLength(0);
  });

  it('choisit la langue de l’utilisateur dans un message multilingue avec fallback serveur', () => {
    const cfg = config({ message: { fr: 'Salut {username}', en: 'Hi {username}' } });
    expect(renderWelcome(fakeMember(), cfg, { language: 'en', fallbackLanguage: 'fr' }).content).toBe('Hi alice');
    expect(renderWelcome(fakeMember(), cfg, { language: 'de', fallbackLanguage: 'fr' }).content).toBe('Salut alice');
  });

  it('rend un embed multilingue et attache l’image générée', () => {
    const cfg = config({ embed: { fr: { title: 'Bienvenue {displayName}', description: '{memberCount} membres' }, en: { title: 'Welcome {displayName}' } } });
    const r = renderWelcome(fakeMember(), cfg, { language: 'fr', fallbackLanguage: 'fr', image: Buffer.from('png') });
    expect(r.content).toBeUndefined();
    expect(r.embeds).toHaveLength(1);
    const json = r.embeds[0]!.toJSON();
    expect(json.title).toBe('Bienvenue Alice');
    expect(json.description).toBe('1234 membres');
    expect(json.image?.url).toBe(`attachment://${WELCOME_IMAGE_FILENAME}`);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]!.name).toBe(WELCOME_IMAGE_FILENAME);
  });

  it('utilise le message par défaut traduit quand rien n’est configuré', () => {
    expect(renderWelcome(fakeMember(), config(), { language: 'fr' }).content).toContain('Bienvenue');
    expect(renderWelcome(fakeMember(), config(), { language: 'en' }).content).toContain('Welcome');
  });

  it('ajoute les boutons configurés et le bouton « Choisir ma langue »', () => {
    const cfg = config({
      languagePromptEnabled: true,
      buttons: [
        { label: 'Site', style: 'link', url: 'https://redemption-story.example' },
        { label: 'Rôle', style: 'secondary', customId: 'rolemenu:toggle:444444444444444444' },
        { label: 'invalid', style: 'primary' },
      ],
    });
    const r = renderWelcome(fakeMember(), cfg, { language: 'fr' });
    expect(r.components).toHaveLength(1);
    const row = r.components[0]!.toJSON();
    expect(row.components).toHaveLength(3);
    const ids = row.components.map((c) => ('custom_id' in c ? c.custom_id : (c as { url?: string }).url));
    expect(ids).toContain('rolemenu:toggle:444444444444444444');
    expect(ids).toContain('welcome:lang:222222222222222222');
    expect(ids).toContain('https://redemption-story.example');
    expect(renderWelcome(fakeMember(), cfg, { language: 'fr', withButtons: false }).components).toHaveLength(0);
  });
});

describe('renderLeave', () => {
  const leave: LeaveConfig = { guildId: '222222222222222222', enabled: true, channelId: null, message: '{displayName} ({username}) est parti · {memberCount} · {joinedAt}', embed: null, imageEnabled: false, imageBackgroundUrl: null, logEnabled: true, updatedAt: new Date() };
  it('rend les variables de départ', () => {
    const r = renderLeave(fakeMember(), leave, { language: 'fr' });
    expect(r.content).toBe('Alice (alice) est parti · 1234 · <t:1700000000:D>');
  });
  it('message par défaut traduit', () => {
    expect(renderLeave(fakeMember(), { ...leave, message: null }, { language: 'en' }).content).toContain('left the server');
  });
});
