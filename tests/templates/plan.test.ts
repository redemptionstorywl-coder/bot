import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { prisma } from '../../src/database/client';
import { SUPPORT_VOICE_USER_LIMIT, categoryOverwrites, isPending, normalizeName, presetOverwrites, resolveStructure, templateService, type ChannelLike, type GuildLike, type RoleLike } from '../../src/services/TemplateService';
import { SERVER_TEMPLATES, TEMPLATE_KEYS } from '../../src/templates';
import { PermissionFlagsBits as P } from 'discord.js';

const TEXT = 0;
const VOICE = 2;
const CATEGORY = 4;
const FORUM = 15;
const EXISTING_ONLY = { createMissing: false };
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
    const { steps, resolution } = await templateService.plan(SHOP, 'shop', EXISTING_ONLY);
    const step = (id: string) => steps.find((s) => s.id === id)!;

    expect(steps.find((s) => s.id === 'structure')).toBeUndefined();
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

  it('marque ignorées les étapes sans salon (sans création)', async () => {
    const empty = fakeGuild([['💬・general-chat']], ['👤 Member']);
    const { steps } = await templateService.plan(empty, 'shop', EXISTING_ONLY);
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
    const { steps, resolution } = await templateService.plan(BR, 'battle-royale', EXISTING_ONLY);
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
    const structure = report.steps.find((s) => s.id === 'structure')!;
    expect(structure.status).toBe('done');
    expect(structure.items!.length).toBeGreaterThan(40);
  });
});

describe('structure — création des salons manquants', () => {
  const EMPTY_ROLES = ['🛡️ RS Team', '👤 Member'];

  for (const tpl of SERVER_TEMPLATES) {
    it(`${tpl.key} : sur un serveur vide, tout est à créer et aucune étape de contenu n’est ignorée faute de salon`, async () => {
      const empty = fakeGuild([], EMPTY_ROLES);
      const { steps, structure } = await templateService.plan(empty, tpl.key);
      expect(steps[0]!.id).toBe('kind');
      expect(steps[1]!.id).toBe('structure');
      expect(steps[1]!.status).toBe('ready');
      // Tout est 🆕 (y compris les catégories de tickets)
      expect(structure!.items.every((i) => i.status === 'create')).toBe(true);
      expect(structure!.items.filter((i) => i.kind === 'category').length).toBe(tpl.structure.categories.length);
      expect(steps[1]!.items).toBe(structure!.items);
      // Aucune étape ignorée pour « salon introuvable »
      const missingChannel = steps.filter((s) => s.status === 'skipped' && s.reason?.key === 'channel_not_found').map((s) => s.id);
      expect(missingChannel).toEqual([]);
      // Les étapes de contenu ciblent des salons virtuels
      for (const id of ['welcome', 'rules', 'ticket_panel', 'logs', 'language_panel', 'notification_panel']) {
        const step = steps.find((s) => s.id === id)!;
        expect(step.status, id).toBe('ready');
        expect(step.targets.every((t) => t.pending && isPending(t)), id).toBe(true);
      }
      for (const info of tpl.infoMessages.filter((m) => !m.optional)) expect(steps.find((s) => s.id === `info:${info.key}`)?.status, info.key).toBe('ready');
      // Les messages optionnels (paiement sans boutique) sont omis, pas ignorés
      for (const info of tpl.infoMessages.filter((m) => m.optional)) expect(steps.find((s) => s.id === `info:${info.key}`)).toBeUndefined();
      // Les catégories de tickets à créer portent le nom attendu par les types de tickets
      for (const type of tpl.tickets.types) {
        expect(structure!.items.some((i) => i.kind === 'category' && normalizeName(i.name) === normalizeName(type.createCategoryName!)), type.key).toBe(true);
      }
    });

    it(`${tpl.key} : les noms de la structure et les clés des étapes sont cohérents`, () => {
      const names = new Set<string>();
      for (const c of tpl.structure.categories) {
        expect(names.has(normalizeName(c.name)), c.name).toBe(false);
        names.add(normalizeName(c.name));
        for (const ch of c.channels) {
          expect(ch.key).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
          expect(ch.name.length).toBeLessThanOrEqual(100);
          if (ch.topic) expect(ch.topic.fr.length + ch.topic.en.length).toBeLessThanOrEqual(1000);
        }
      }
      for (const info of tpl.infoMessages) {
        expect(info.embeds.fr.description?.length ?? 0).toBeLessThanOrEqual(4096);
        expect(info.embeds.en.description?.length ?? 0).toBeLessThanOrEqual(4096);
        for (const f of [...(info.embeds.fr.fields ?? []), ...(info.embeds.en.fields ?? [])]) expect(f.value.length, `${tpl.key}/${info.key}/${f.name}`).toBeLessThanOrEqual(1024);
        expect(info.embeds.fr.footer?.text).toContain(`template:info:${info.key}`);
      }
    });
  }

  it('Shop : les salons existants sont reconnus, seuls les ajouts sont créés', () => {
    const { items, pending } = resolveStructure(SHOP, SERVER_TEMPLATES[0]!);
    const created = items.filter((i) => i.status === 'create').map((i) => i.name);
    expect(created).toEqual(['📢 INFORMATION', '🛍️・how-to-buy', '🔊 Staff Voice', '🎫 Tickets']);
    expect(pending.map((c) => c.name)).toEqual(created);
    // Aucun doublon : un salon à créer ne porte jamais le nom (normalisé) d'un salon existant
    const existing = new Set([...SHOP.channels.cache.values()].map((c) => normalizeName(c.name)));
    for (const name of created) expect(existing.has(normalizeName(name)), name).toBe(false);
    expect(items.find((i) => i.key === 'welcome')).toMatchObject({ status: 'reuse', id: '1550962740229836861' });
    expect(items.find((i) => i.key === 'paidScripts')).toMatchObject({ status: 'reuse', name: '💎・paid-scripts' });
    expect(items.find((i) => i.key === 'orders')).toMatchObject({ status: 'reuse', id: '1550987056799293491' });
  });

  it('Battle Royale : les 5 catégories de tickets et les salons existants sont réutilisés', async () => {
    const { items } = resolveStructure(BR, SERVER_TEMPLATES[1]!);
    const created = items.filter((i) => i.status === 'create').map((i) => i.name);
    expect(created).toEqual(['📊・polls', '🇸🇦・arabic', '🇷🇺・russian', '🇹🇷・turkish', '🇵🇱・polish', '🔊 Tournament', '🔊 Support 1', '🔊 Support 2', '🔊 Support 3', '🔒 Private Support', '🔊 Staff Voice']);
    const existing = new Set([...BR.channels.cache.values()].map((c) => normalizeName(c.name)));
    for (const name of created) expect(existing.has(normalizeName(name)), name).toBe(false);
    expect(items.filter((i) => i.kind === 'category').every((i) => i.status === 'reuse')).toBe(true);
    // Avec la structure, les 10 langues sont mappées (6 existantes + 4 virtuelles)
    const { resolution, steps } = await templateService.plan(BR, 'battle-royale');
    expect(Object.keys(resolution.languageChannels)).toHaveLength(10);
    expect(isPending(resolution.languageChannels.ar!)).toBe(true);
    expect(isPending(resolution.languageChannels.fr!)).toBe(false);
    expect(steps.find((s) => s.id === 'structure')!.targets.every((t) => !t.pending)).toBe(true);
  });

  it('réutilise un salon texte existant même si la structure prévoit un forum (et inversement)', () => {
    const g = fakeGuild([['💡・suggestions', 'sg', TEXT], ['🐛・bug-reports', 'bg', FORUM], ['🔊 Staff Voice', 'sv', VOICE], ['staff-chat', 'sc', VOICE]], []);
    const { items } = resolveStructure(g, SERVER_TEMPLATES[0]!);
    expect(items.find((i) => i.key === 'suggestions')).toMatchObject({ status: 'reuse', id: 'sg' });
    expect(items.find((i) => i.key === 'bugReports')).toMatchObject({ status: 'reuse', id: 'bg' });
    expect(items.find((i) => i.key === 'staffVoice')).toMatchObject({ status: 'reuse', id: 'sv' });
    // un vocal ne remplace pas un salon texte
    expect(items.find((i) => i.key === 'staffChat')).toMatchObject({ status: 'create' });
  });

  it('résout les rôles staff pour les overwrites (admin + staff + RS Team, sans doublon)', () => {
    const { staffRoles } = resolveStructure(SHOP, SERVER_TEMPLATES[0]!);
    expect(staffRoles.map((r) => r.name)).toEqual(['🛡️ Administrator', '🧠 Manager', '🛡️ RS Team', '🎧 Support', '👨‍💻 Developer']);
  });
});

describe('presetOverwrites (pure)', () => {
  const ctx = { everyoneId: 'everyone', botId: 'bot', staffRoleIds: ['s1', 's2', 's1'] };
  const byId = (list: ReturnType<typeof presetOverwrites>, id: string) => list.find((o) => o.id === id) as { allow?: bigint[]; deny?: bigint[] } | undefined;

  it('readonly : @everyone lit sans écrire, staff et bot écrivent', () => {
    const o = presetOverwrites('readonly', 'public', ctx);
    expect(byId(o, 'everyone')?.allow).toEqual(expect.arrayContaining([P.ViewChannel, P.ReadMessageHistory]));
    expect(byId(o, 'everyone')?.deny).toEqual(expect.arrayContaining([P.SendMessages, P.CreatePublicThreads]));
    expect(byId(o, 's1')?.allow).toEqual(expect.arrayContaining([P.SendMessages, P.ManageMessages]));
    expect(byId(o, 'bot')?.allow).toEqual(expect.arrayContaining([P.SendMessages, P.EmbedLinks, P.MentionEveryone]));
    expect(o.filter((x) => x.id === 's1')).toHaveLength(1);
  });
  it('chat / voice : héritent de la catégorie publique', () => {
    expect(presetOverwrites('chat', 'public', ctx)).toEqual([]);
    expect(presetOverwrites('voice', 'public', ctx)).toEqual([]);
  });
  it('staff et catégories staff / tickets : @everyone ne voit rien, staff et bot oui', () => {
    for (const o of [presetOverwrites('staff', 'public', ctx), presetOverwrites('chat', 'staff', ctx), presetOverwrites('readonly', 'tickets', ctx), categoryOverwrites('staff', ctx), categoryOverwrites('tickets', ctx)]) {
      expect(byId(o, 'everyone')?.deny).toEqual([P.ViewChannel]);
      expect(byId(o, 's1')?.allow).toEqual(expect.arrayContaining([P.ViewChannel, P.SendMessages]));
      expect(byId(o, 'bot')?.allow).toEqual(expect.arrayContaining([P.ViewChannel, P.SendMessages]));
    }
    expect(byId(presetOverwrites('voice', 'staff', ctx), 's1')?.allow).toEqual(expect.arrayContaining([P.Connect, P.Speak]));
    expect(categoryOverwrites('public', ctx)).toEqual([]);
  });
  it('support-voice : visible et joignable par tous, staff peut modérer ; limite de participants', () => {
    const o = presetOverwrites('support-voice', 'public', ctx);
    expect(byId(o, 'everyone')?.allow).toEqual(expect.arrayContaining([P.ViewChannel, P.Connect, P.Speak]));
    expect(byId(o, 's1')?.allow).toEqual(expect.arrayContaining([P.MoveMembers, P.MuteMembers]));
    expect(byId(o, 'bot')).toBeUndefined();
    expect(SUPPORT_VOICE_USER_LIMIT).toBeGreaterThanOrEqual(2);
    expect(SUPPORT_VOICE_USER_LIMIT).toBeLessThanOrEqual(5);
  });
});
