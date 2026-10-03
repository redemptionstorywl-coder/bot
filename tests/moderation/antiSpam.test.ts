import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { AntiRaidService, SlidingWindow, antiRaidConfigSchema, containsInvite, extractDomains, isWhitelisted } from '../../src/services/AntiRaidService';

describe('SlidingWindow', () => {
  it('compte les événements dans la fenêtre et oublie les anciens', () => {
    const w = new SlidingWindow();
    const t0 = 1_000_000;
    expect(w.hit('g:u', 5000, t0)).toBe(1);
    expect(w.hit('g:u', 5000, t0 + 1000)).toBe(2);
    expect(w.hit('g:u', 5000, t0 + 2000)).toBe(3);
    // 6 s plus tard : les 3 premiers sont sortis de la fenêtre
    expect(w.hit('g:u', 5000, t0 + 7000)).toBe(1);
    expect(w.count('g:u', 5000, t0 + 7000)).toBe(1);
    expect(w.count('autre', 5000, t0 + 7000)).toBe(0);
  });

  it('gc() purge les clés inactives et resetPrefix() cible un serveur', () => {
    const w = new SlidingWindow();
    w.hit('g1:u1', 5000, 0);
    w.hit('g1:u2', 5000, 100);
    w.hit('g2:u1', 5000, 60_000);
    expect(w.size).toBe(3);
    expect(w.gc(30_000, 60_000)).toBe(2);
    expect(w.size).toBe(1);
    w.hit('g1:u1', 5000, 60_000);
    w.resetPrefix('g1');
    expect(w.count('g1:u1', 5000, 60_000)).toBe(0);
    expect(w.count('g2:u1', 5000, 60_000)).toBe(1);
  });
});

describe('AntiRaidService.evaluateMessage', () => {
  const cfg = antiRaidConfigSchema.parse({ antiSpam: { maxMessages: 4, intervalSeconds: 5, timeoutSeconds: 600 }, antiMassMention: { maxMentions: 5 } });

  it('déclenche le spam au N-ième message dans la fenêtre puis réinitialise', () => {
    const svc = new AntiRaidService();
    const base = { guildId: '1', userId: '42', content: 'hey', mentionCount: 0 };
    const t0 = 10_000;
    expect(svc.evaluateMessage({ ...base, now: t0 }, cfg)).toBeNull();
    expect(svc.evaluateMessage({ ...base, now: t0 + 500 }, cfg)).toBeNull();
    expect(svc.evaluateMessage({ ...base, now: t0 + 1000 }, cfg)).toBeNull();
    const verdict = svc.evaluateMessage({ ...base, now: t0 + 1500 }, cfg);
    expect(verdict).toEqual({ trigger: 'spam', delete: true, timeoutSeconds: 600 });
    // fenêtre réinitialisée après sanction
    expect(svc.evaluateMessage({ ...base, now: t0 + 1600 }, cfg)).toBeNull();
    // un autre utilisateur n'est pas affecté
    expect(svc.evaluateMessage({ ...base, userId: '43', now: t0 + 1700 }, cfg)).toBeNull();
  });

  it('ne déclenche pas si les messages sont espacés au-delà de la fenêtre', () => {
    const svc = new AntiRaidService();
    const base = { guildId: '1', userId: '42', content: 'hey', mentionCount: 0 };
    for (let i = 0; i < 10; i++) expect(svc.evaluateMessage({ ...base, now: i * 6000 }, cfg)).toBeNull();
  });

  it('détecte les mentions en masse', () => {
    const svc = new AntiRaidService();
    expect(svc.evaluateMessage({ guildId: '1', userId: '2', content: '', mentionCount: 4 }, cfg)).toBeNull();
    expect(svc.evaluateMessage({ guildId: '1', userId: '2', content: '', mentionCount: 5 }, cfg)?.trigger).toBe('mass_mention');
  });

  it('anti-lien : invitations, liens hors liste blanche, action TIMEOUT', () => {
    const svc = new AntiRaidService();
    const linkCfg = antiRaidConfigSchema.parse({ antiSpam: { enabled: false }, antiLink: { enabled: true, blockInvites: true, blockLinks: true, whitelistDomains: ['youtube.com'], action: 'TIMEOUT', timeoutSeconds: 300 } });
    expect(svc.evaluateMessage({ guildId: '1', userId: '2', content: 'join discord.gg/abc123', mentionCount: 0 }, linkCfg)).toEqual({ trigger: 'invite', delete: true, timeoutSeconds: 300 });
    expect(svc.evaluateMessage({ guildId: '1', userId: '2', content: 'https://www.youtube.com/watch?v=1', mentionCount: 0 }, linkCfg)).toBeNull();
    expect(svc.evaluateMessage({ guildId: '1', userId: '2', content: 'https://music.youtube.com/x', mentionCount: 0 }, linkCfg)).toBeNull();
    expect(svc.evaluateMessage({ guildId: '1', userId: '2', content: 'go https://evil.example.com/x', mentionCount: 0 }, linkCfg)?.trigger).toBe('link');
    const deleteOnly = antiRaidConfigSchema.parse({ antiSpam: { enabled: false }, antiLink: { enabled: true, blockLinks: true } });
    expect(svc.evaluateMessage({ guildId: '1', userId: '2', content: 'https://a.b', mentionCount: 0 }, deleteOnly)).toEqual({ trigger: 'link', delete: true, timeoutSeconds: 0 });
  });
});

describe('helpers liens', () => {
  it('containsInvite', () => {
    expect(containsInvite('https://discord.gg/abc')).toBe(true);
    expect(containsInvite('discord.com/invite/xyz')).toBe(true);
    expect(containsInvite('rien ici')).toBe(false);
  });
  it('extractDomains / isWhitelisted', () => {
    expect(extractDomains('a https://WWW.Example.com/x et http://sub.test.org:8080/y')).toEqual(['example.com', 'sub.test.org']);
    expect(isWhitelisted('sub.test.org', ['test.org'])).toBe(true);
    expect(isWhitelisted('nottest.org', ['test.org'])).toBe(false);
  });
});

describe('isAccountTooYoung', () => {
  it('compare l’âge du compte au minimum en jours', () => {
    const svc = new AntiRaidService();
    const now = Date.now();
    expect(svc.isAccountTooYoung(now - 2 * 86400_000, 7, now)).toBe(true);
    expect(svc.isAccountTooYoung(now - 8 * 86400_000, 7, now)).toBe(false);
  });
});
