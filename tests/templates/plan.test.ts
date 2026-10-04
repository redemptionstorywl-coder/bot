import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma } from '../../src/database/client';
import { templateService, type ChannelLike, type GuildLike, type RoleLike } from '../../src/services/TemplateService';
import { SERVER_TEMPLATES, TEMPLATE_KEYS } from '../../src/templates';

const TEXT = 0;
const CATEGORY = 4;
const FORUM = 15;
let seq = 1000;

function fakeGuild(channels: [string, string?, number?][], roles: string[]): GuildLike {
  const chans = new Map<string, ChannelLike>();
  for (const [name, id, type] of channels) {
    const cid = id ?? String(seq++);
    chans.set(cid, { id: cid, name, type: type ?? TEXT });
  }
  const rs = new Map<string, RoleLike>();
  for (const name of roles) {
    const rid = String(seq++);
    rs.set(rid, { id: rid, name });
  }
  return { id: '1550000000000000000', name: 'Test', channels: { cache: chans }, roles: { cache: rs } };
}

/** Serveur Shop réel (IDs d'exemple) */
const SHOP = fakeGuild(
  [
    ['👋・welcome', '1550962740229836861'],
    ['📜・rules', '1550962810752729238'],
    ['📢・announcements', '1550962891740414113'],
    ['💳・payment-methods'],
    ['🎁・giveaways', '1550962962842386593'],
    ['📊・polls', '1550962992080756868'],
    ['⭐・feedback'],
    ['👀 SHOWCASE', undefined, CATEGORY],
    ['🖼️・previews'],
    ['🚧・wip'],
    ['🔄・updates'],
    ['👀・spoilers'],
    ['🛒 RS SHOP', undefined, CATEGORY],
    ['💎・paid-scripts', undefined, FORUM],
    ['🆓・free-scripts', undefined, FORUM],
    ['💬 COMMUNITY', undefined, CATEGORY],
    ['💬・general-chat'],
    ['💡・suggestions', undefined, FORUM],
    ['🆘・support-chat'],
    ['🐛・bug-reports', undefined, FORUM],
    ['🎫・create-ticket', '1550966618874450042'],
    ['👑 STAFF', '1550986682407321610', CATEGORY],
    ['🔒・staff-chat'],
    ['🐛・bug-management'],
    ['📋・staff-tasks'],
    ['📦・orders', '1550987056799293491'],
  ],
  ['👑 GAGYC', '🛡️ Administrator', '🧠 Manager', '👨‍💻 Developer', '🎧 Support', '🛡️ RS Team', '🤝 Partner', '🧪 Tester', '⭐ VIP Customer', '💎 Customer', '👤 Member', '🇫🇷・Français', '🇺🇸・English'],
);

const BR = fakeGuild(
  [
    ['📢 INFORMATION', undefined, CATEGORY],
    ['👋・welcome'],
    ['📜・rules'],
    ['📢・announcements'],
    ['🗺️・how-to-play'],
    ['🏆・leaderboards'],
    ['📅・events'],
    ['🛒 STORE', undefined, CATEGORY],
    ['🛍️・store'],
    ['💳・payment-methods'],
    ['🎁・giveaways'],
    ['💬 COMMUNITY', undefined, CATEGORY],
    ['💬・general-chat'],
    ['💎・boosts'],
    ['📸・clips-and-screenshots'],
    ['📊・stats'],
    ['📺・streamers'],
    ['🇫🇷・french'],
    ['🇬🇧・english'],
    ['🇪🇸・spanish'],
    ['🇩🇪・german'],
    ['🇮🇹・italian'],
    ['🇵🇹・portuguese'],
    ['🏆 COMPETITION', undefined, CATEGORY],
    ['📅・tournament-info'],
    ['📊・tournament-results'],
    ['🛠️ SUPPORT', undefined, CATEGORY],
    ['🎫・create-ticket'],
    ['🐛・bug-reports'],
    ['💡・suggestions'],
    ['👑 STAFF', undefined, CATEGORY],
    ['🔒・staff-chat'],
    ['📢・staff-announcements'],
    ['📋・staff-tasks'],
    ['🚨・player-reports'],
    ['🎯・tournament-management'],
    ['🏆・event-management'],
    ['🐛・bug-management'],
    ['📚・staff-templates'],
    ['🎫 GENERAL SUPPORT', undefined, CATEGORY],
    ['🐛 BUG REPORT', undefined, CATEGORY],
    ['🚨 PLAYER REPORT', undefined, CATEGORY],
    ['⚠️ BAN APPEAL', undefined, CATEGORY],
    ['💳 PAYMENT SUPPORT', undefined, CATEGORY],
  ],
  ['⚔️ Battle Master', '🛡️ ADMIN', '🔨 MODERATOR', '🎧 Support', '🧠 COMMUNITY MANAGER', '👨‍💻 DEVELOPER', '🛡️ RS Team', '🧪 BETA TESTER', '💎 VIP', '🏆 TOURNAMENT WINNER', '🎥 Streamer', '🎮 PLAYER', '🇫🇷・Français', '🇺🇸・English', '🇪🇸・Español', '🇩🇪・German', '🇮🇹・Italiano', '🇸🇦・العربية', '🇷🇺・Русский', '🇧🇷・Português', '🇹🇷・Türkçe', '🇵🇱・Polski', '🤖 BOT'],
);

beforeEach(() => {
  // restoreMocks: true réinitialise les implémentations → aucun serveur FiveM configuré
  (prisma as unknown as { fiveMServer: { findMany: ReturnType<typeof vi.fn> } }).fiveMServer.findMany.mockResolvedValue([]);
});

const byName = (g: GuildLike, name: string) => [...g.channels.cache.values()].find((c) => c.name === name)!.id;
const roleByName = (g: GuildLike, name: string) => [...g.roles.cache.values()].find((r) => r.name === name)!.id;

describe('templates', () => {
  it('expose les 4 modèles', () => {
    expect(TEMPLATE_KEYS).toEqual(['shop', 'battle-royale', 'prison', 'school']);
    for (const tpl of SERVER_TEMPLATES) {
      expect(tpl.rules.embeds.fr.description).toContain('**9. Sanctions**');
      expect(tpl.rules.embeds.en.description).toContain('{channel:ticket}');
      expect(tpl.welcome.message.fr).toContain('{memberCount}');
      expect(tpl.tickets.types.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('rejette un modèle inconnu', async () => {
    await expect(templateService.plan(SHOP, 'nope')).rejects.toThrow(/Unknown template/);
  });
});

describe('plan() — Shop', () => {
  it('résout bienvenue, règlement, tickets et logs ; ignore ce qui manque', async () => {
    const { steps, resolution } = await templateService.plan(SHOP, 'shop');
    const step = (id: string) => steps.find((s) => s.id === id)!;

    expect(step('welcome').status).toBe('ready');
    expect(step('welcome').targets[0]?.id).toBe('1550962740229836861');
    expect(step('rules').targets[0]?.id).toBe('1550962810752729238');
    expect(step('ticket_panel').targets[0]?.id).toBe('1550966618874450042');

    expect(step('logs').status).toBe('ready');
    const logs = Object.fromEntries(resolution.logs.map((l) => [l.category, l.channel.id]));
    expect(logs.SHOP).toBe('1550987056799293491');
    expect(logs.SYSTEM).toBe(byName(SHOP, '🐛・bug-management'));
    expect(logs.MODERATION).toBe(byName(SHOP, '🔒・staff-chat'));
    expect(logs.TICKET).toBe(byName(SHOP, '📋・staff-tasks'));
    expect(logs.VOICE).toBe(byName(SHOP, '🔒・staff-chat'));

    expect(step('roles').status).toBe('ready');
    expect(resolution.staffRoles.map((r) => r.name)).toEqual(['🎧 Support', '🧠 Manager', '👨‍💻 Developer', '🛡️ RS Team']);
    expect(resolution.adminRoles.map((r) => r.name)).toEqual(['🛡️ Administrator', '🧠 Manager', '🛡️ RS Team']);
    expect(step('autorole').targets.map((t) => t.id)).toEqual([roleByName(SHOP, '👤 Member')]);

    // Catégorie « 🎫 Tickets » absente : à créer, aucune cible catégorie
    expect(step('tickets').status).toBe('ready');
    expect(step('tickets').targets).toEqual([]);
    expect(resolution.tickets.every((t) => t.category === null)).toBe(true);
    expect(resolution.tickets.find((t) => t.type.key === 'payment')!.staffRoles.map((r) => r.name)).toEqual(['🧠 Manager', '🛡️ RS Team']);

    // Pas de salon « langues » → panneau de langue dans welcome
    expect(step('language_panel').targets[0]?.id).toBe('1550962740229836861');
    // Pas de salon notifications → fallback welcome
    expect(step('notification_panel').targets[0]?.id).toBe('1550962740229836861');
    // Infos
    expect(step('info:payment-methods').status).toBe('ready');
    expect(step('info:feedback').targets[0]?.id).toBe(byName(SHOP, '⭐・feedback'));
    // Placeholders et recommandations
    expect(resolution.placeholders.paidScripts?.name).toBe('💎・paid-scripts');
    expect(resolution.recommended.find((r) => r.key === 'giveaways')?.channel?.id).toBe('1550962962842386593');
    expect(resolution.recommended.find((r) => r.key === 'polls')?.channel?.id).toBe('1550962992080756868');
    expect(resolution.recommended.find((r) => r.key === 'events')?.channel).toBeNull();
    // Pas de FiveM sur le shop
    expect(steps.find((s) => s.id === 'fivem')).toBeUndefined();
    // Leave : fallback sur welcome
    expect(step('leave').targets[0]?.id).toBe('1550962740229836861');
  });

  it('marque ignorées les étapes sans salon', async () => {
    const empty = fakeGuild([['💬・general-chat']], ['👤 Member']);
    const { steps } = await templateService.plan(empty, 'shop');
    const skipped = steps.filter((s) => s.status === 'skipped').map((s) => s.id);
    expect(skipped).toEqual(expect.arrayContaining(['welcome', 'rules', 'ticket_panel', 'logs', 'roles', 'language_panel', 'notification_panel', 'info:payment-methods', 'leave']));
    expect(steps.find((s) => s.id === 'welcome')?.reason?.key).toBe('channel_not_found');
    expect(steps.find((s) => s.id === 'roles')?.reason?.key).toBe('role_not_found');
    expect(steps.find((s) => s.id === 'kind')?.status).toBe('ready');
    expect(steps.find((s) => s.id === 'tickets')?.status).toBe('ready');
  });
});

describe('plan() — Battle Royale', () => {
  it('mappe les 5 catégories de tickets, les logs staff et les salons par langue', async () => {
    const { steps, resolution } = await templateService.plan(BR, 'battle-royale');
    const step = (id: string) => steps.find((s) => s.id === id)!;

    const cats = Object.fromEntries(resolution.tickets.map((t) => [t.type.key, t.category?.name]));
    expect(cats).toEqual({ support: '🎫 GENERAL SUPPORT', bug: '🐛 BUG REPORT', report: '🚨 PLAYER REPORT', 'ban-appeal': '⚠️ BAN APPEAL', payment: '💳 PAYMENT SUPPORT' });
    expect(step('tickets').targets.map((t) => t.kind)).toEqual(['category', 'category', 'category', 'category', 'category']);
    expect(resolution.tickets.find((t) => t.type.key === 'support')!.staffRoles.map((r) => r.name)).toEqual(['🎧 Support', '🔨 MODERATOR', '🛡️ ADMIN', '🛡️ RS Team']);

    const logs = Object.fromEntries(resolution.logs.map((l) => [l.category, l.channel.name]));
    expect(logs.MODERATION).toBe('🚨・player-reports');
    expect(logs.SYSTEM).toBe('🐛・bug-management');
    expect(logs.SECURITY).toBe('📢・staff-announcements');
    expect(logs.ANNOUNCEMENT).toBe('🏆・event-management');
    expect(logs.BATTLE_ROYALE).toBe('🎯・tournament-management');
    expect(logs.MEMBER).toBe('🔒・staff-chat');
    expect(logs.MESSAGE).toBe('🔒・staff-chat');

    expect(Object.keys(resolution.languageChannels).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt']);
    expect(resolution.languageChannels.fr?.name).toBe('🇫🇷・french');
    expect(step('language').status).toBe('ready');
    expect(step('language').targets).toHaveLength(6);

    expect(step('autorole').targets.map((t) => t.name)).toEqual(['🎮 PLAYER', '🤖 BOT']);
    expect(resolution.adminRoles.map((r) => r.name)).toEqual(['🛡️ ADMIN', '🧠 COMMUNITY MANAGER', '🛡️ RS Team']);

    // FiveM : aucun serveur configuré (prisma mock → []) → ignoré
    expect(step('fivem').status).toBe('skipped');
    expect(step('fivem').reason?.key).toBe('no_fivem_server');

    for (const key of ['how-to-play', 'leaderboards', 'tournament-info', 'streamers']) expect(step(`info:${key}`).status).toBe('ready');
    expect(resolution.placeholders.tournamentResults?.name).toBe('📊・tournament-results');
    expect(resolution.placeholders.howToPlay?.name).toBe('🗺️・how-to-play');
  });

  it('apply en dry run ne modifie rien et renvoie le plan', async () => {
    const report = await templateService.apply(BR as never, 'battle-royale', '1', { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.steps.length).toBeGreaterThan(15);
    expect(report.steps.every((s) => s.status === 'done' || s.status === 'skipped')).toBe(true);
  });
});
