import { describe, expect, it } from 'vitest';
import { translationService } from '../../src/services/TranslationService';
import { DISCORD_MAX_CATEGORY_CHILDREN, buildSummaryEmbed, categoryName, channelWanted, moduleRelevant, planTemplate, type HubChannelInfo, type TemplateSourceInput } from '../../src/services/logs/template';
import { embedLength } from '../../src/services/logs/sendQueue';

const t = translationService.bind('fr');
const BR = '100000000000000001';
const STUDIO = '100000000000000002';
const SHOP = '100000000000000003';

const br: TemplateSourceInput = { guildId: BR, label: 'RS Battle Royale', emoji: '🎯', kind: 'BATTLE_ROYALE', modules: { tickets: true, fivem: true, battleRoyale: true }, hasFiveM: true };
const studio: TemplateSourceInput = { guildId: STUDIO, label: 'RS Studio', emoji: '🎬', kind: 'GENERIC', modules: { tickets: true }, hasFiveM: false };
const shop: TemplateSourceInput = { guildId: SHOP, label: 'RS Shop', emoji: '🛒', kind: 'SHOP', modules: { shop: true }, hasFiveM: false };
const game = { serverId: 7, name: 'RS BR', chat: false };

const names = (plan: ReturnType<typeof planTemplate>, sourceKey: string) => plan.items.filter((i) => i.sourceKey === sourceKey).map((i) => i.name);

describe('planTemplate : structure du serveur de logs central', () => {
  const empty = planTemplate({ sources: [br, studio], games: [game], routes: {}, channels: new Map(), t });

  it('hub vide : tout est à créer, catégories avant leurs salons', () => {
    expect(empty.reused).toBe(0);
    expect(empty.toCreate).toBe(empty.items.length);
    expect(empty.guildLimitExceeded).toBe(false);
    const firstText = empty.items.findIndex((i) => i.kind === 'text');
    expect(empty.items[firstText - 1]!.kind).toBe('category');
  });

  it('section générale : sommaire, sanctions globales, alertes sécurité, bot système', () => {
    expect(names(empty, 'global')).toEqual(['🌐 GÉNÉRAL', '📌・sommaire', '🔨・sanctions-globales', '🚨・alertes-sécurité', '🤖・bot-système']);
  });

  it('source : 3 catégories nommées d’après le serveur (emoji + MAJUSCULES)', () => {
    const cats = empty.items.filter((i) => i.sourceKey === BR && i.kind === 'category').map((i) => i.name);
    expect(cats).toEqual(['🎯 RS BATTLE ROYALE · MODÉRATION', '🎯 RS BATTLE ROYALE · MESSAGES & MEMBRES', '🎯 RS BATTLE ROYALE · SERVEUR & ACTIVITÉ']);
    expect(names(empty, BR)).toEqual(
      expect.arrayContaining(['🔨・sanctions', '🧹・clear-salons', '🚨・sécurité', '🔄・sync-fivem', '🗑️・messages-supprimés', '✏️・messages-modifiés', '🧨・suppressions-en-masse', '📥・arrivées', '📤・départs', '🏷️・pseudos', '🎭・rôles-membres', '✉️・invitations', '🔊・vocal', '📁・salons', '🎖️・rôles', '⚙️・paramètres', '🎫・tickets', '⚔️・battle-royale', '🤖・config-bot']),
    );
  });

  it('salons de modules inutiles omis selon le type de serveur', () => {
    expect(names(empty, BR)).not.toContain('📝・whitelist');
    expect(names(empty, BR)).not.toContain('🛒・boutique');
    expect(names(empty, STUDIO)).not.toContain('🔄・sync-fivem');
    expect(names(empty, STUDIO)).not.toContain('⚔️・battle-royale');
    const shopPlan = planTemplate({ sources: [shop], games: [], routes: {}, channels: new Map(), t });
    expect(names(shopPlan, SHOP)).toContain('🛒・boutique');
    expect(names(shopPlan, SHOP)).not.toContain('📝・whitelist');
    expect(moduleRelevant(shop, 'whitelist')).toBe(false);
    expect(channelWanted({ ...studio, hasFiveM: true }, { route: 'fivem.sync', modules: ['fivem'] })).toBe(true);
  });

  it('serveur de jeu : catégorie JEU, chat seulement si activé', () => {
    expect(names(empty, 'game:7')).toEqual(['🎮 JEU · RS BR', '🟢・connexions', '🏷️・comptes-pseudos', '💀・kills', '🏆・parties', '🔨・sanctions-jeu', '🛡️・actions-admin', '🚨・anticheat', '⚙️・serveur-jeu']);
    const withChat = planTemplate({ sources: [br], games: [{ ...game, chat: true }], routes: {}, channels: new Map(), t });
    expect(names(withChat, 'game:7')).toContain('💬・chat-jeu');
  });

  it('idempotent : salons enregistrés et présents réutilisés, manquants recréés, jamais de doublon', () => {
    const routes = { global: {} as Record<string, string>, [BR]: {} as Record<string, string> };
    const channels = new Map<string, HubChannelInfo>();
    let n = 1;
    for (const item of empty.items.filter((i) => i.sourceKey === 'global' || i.sourceKey === BR)) {
      const id = String(n++);
      (routes[item.sourceKey as 'global'] ??= {})[item.route] = id;
      channels.set(id, { type: item.kind, parentId: null });
    }
    // Un salon supprimé à la main sur Discord, un autre remplacé par un salon vocal du même ID (type différent)
    const deleted = routes[BR]['mod.sanctions']!;
    channels.delete(deleted);
    const wrongType = routes[BR]['voice']!;
    channels.set(wrongType, { type: 'other', parentId: null });
    const again = planTemplate({ sources: [br], games: [], routes, channels, t });
    const create = again.items.filter((i) => i.status === 'create');
    expect(create.map((i) => i.route).sort()).toEqual(['mod.sanctions', 'voice']);
    expect(again.reused).toBe(again.items.length - 2);
    // Re-planifier après création : plus rien à créer
    routes[BR]['mod.sanctions'] = '900';
    routes[BR]['voice'] = '901';
    channels.set('900', { type: 'text', parentId: null });
    channels.set('901', { type: 'text', parentId: null });
    expect(planTemplate({ sources: [br], games: [], routes, channels, t }).toCreate).toBe(0);
  });

  it('ajouter une source plus tard : seule sa section est à créer', () => {
    const routes: Record<string, Record<string, string>> = {};
    const channels = new Map<string, HubChannelInfo>();
    let n = 1;
    for (const item of planTemplate({ sources: [br], games: [], routes: {}, channels: new Map(), t }).items) {
      const id = String(n++);
      (routes[item.sourceKey] ??= {})[item.route] = id;
      channels.set(id, { type: item.kind, parentId: null });
    }
    const plan = planTemplate({ sources: [br, studio], games: [], routes, channels, t });
    expect(new Set(plan.items.filter((i) => i.status === 'create').map((i) => i.sourceKey))).toEqual(new Set([STUDIO]));
  });

  it('limite de 500 salons par serveur : rien n’est créé', () => {
    const channels = new Map<string, HubChannelInfo>();
    for (let i = 0; i < 480; i++) channels.set(`c${i}`, { type: 'text', parentId: null });
    const plan = planTemplate({ sources: [br, studio], games: [game], routes: {}, channels, t });
    expect(plan.guildLimitExceeded).toBe(true);
    expect(plan.channelsAfter).toBeGreaterThan(500);
  });

  it('limite de 50 salons par catégorie : les salons en trop sont ignorés (skip)', () => {
    const channels = new Map<string, HubChannelInfo>([['cat', { type: 'category', parentId: null }]]);
    for (let i = 0; i < DISCORD_MAX_CATEGORY_CHILDREN - 2; i++) channels.set(`child${i}`, { type: 'text', parentId: 'cat' });
    const plan = planTemplate({ sources: [br], games: [], routes: { [BR]: { 'category.moderation': 'cat' } }, channels, t });
    const mod = plan.items.filter((i) => i.sourceKey === BR && i.parent === 'category.moderation');
    expect(mod.filter((i) => i.status === 'create')).toHaveLength(2);
    expect(mod.filter((i) => i.status === 'skip').every((i) => i.reason === 'category_full')).toBe(true);
    expect(plan.skipped).toBe(mod.length - 2);
  });

  it('noms longs tronqués à 100 caractères', () => {
    expect(categoryName(t, 'category.moderation', { emoji: '🎯', label: 'x'.repeat(200) }).length).toBeLessThanOrEqual(100);
  });

  it('sommaire : une section par serveur, mentions des salons généraux, ≤ 6000 caractères', () => {
    const embed = buildSummaryEmbed({ t, routes: { global: { 'global.sanctions': '1', 'global.security': '2', 'global.system': '3' } }, sources: [{ label: 'RS Battle Royale', emoji: '🎯', guildName: 'RS Battle Royale', keepLocal: true }], games: [{ name: 'RS BR', sourceName: 'RS Battle Royale', chat: false }] });
    expect(embed.fields!.map((f) => f.name)).toEqual(['🌐 GÉNÉRAL', '🎯 RS BATTLE ROYALE', '🎮 JEU · RS BR']);
    expect(embed.fields![0]!.value).toContain('<#1>');
    expect(embedLength(embed)).toBeLessThanOrEqual(6000);
  });
});
