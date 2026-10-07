import { describe, expect, it } from 'vitest';
import { gameChannel, localChannel, planDelivery, sourceChannel, type DeliveryInput, type RouteTable } from '../../src/services/logs/delivery';

const SRC = '100000000000000001';
const HUB = '900000000000000009';

/** Hub complet : section générale, section de la source, section du jeu n° 7. */
const routes: RouteTable = {
  global: { 'global.summary': 'g-summary', 'global.sanctions': 'g-sanctions', 'global.security': 'g-security', 'global.system': 'g-system' },
  [SRC]: {
    'mod.sanctions': 's-sanctions',
    'mod.clear': 's-clear',
    'security.alerts': 's-security',
    'message.deleted': 's-msg-del',
    'member.join': 's-join',
    'server.roles': 's-roles',
    tickets: 's-tickets',
    'fivem.sync': 's-sync',
    'bot.config': 's-config',
  },
  'game:7': { 'game.connections': 'j-co', 'game.kills': 'j-kills', 'game.sanctions': 'j-sanctions', 'game.anticheat': 'j-ac', 'game.server': 'j-server', 'game.chat': 'j-chat' },
};

const input = (over: Partial<DeliveryInput>): DeliveryInput => ({
  guildId: SRC,
  action: 'message.delete',
  category: 'MESSAGE',
  local: { MESSAGE: 'local-msg', SYSTEM: 'local-sys' },
  source: { hubGuildId: HUB, keepLocal: true },
  routes: { [HUB]: routes },
  ...over,
});
const ids = (i: DeliveryInput) => planDelivery(i).map((t) => `${t.scope}:${t.channelId}`);

describe('planDelivery : local + hub + section générale + replis', () => {
  it('sans hub : comportement historique (salon de la catégorie, sinon Système)', () => {
    expect(ids(input({ source: null }))).toEqual(['local:local-msg']);
    expect(ids(input({ source: null, category: 'TICKET', action: 'ticket.open' }))).toEqual(['local:local-sys']);
    expect(ids(input({ source: null, local: null }))).toEqual([]);
  });

  it('source reliée : local + salon fin du hub', () => {
    expect(ids(input({}))).toEqual(['local:local-msg', 'source:s-msg-del']);
  });

  it('keepLocal = false : seulement le hub', () => {
    expect(ids(input({ source: { hubGuildId: HUB, keepLocal: false } }))).toEqual(['source:s-msg-del']);
  });

  it('sanction : salon sanctions de la source + copie dans 🔨・sanctions-globales', () => {
    expect(ids(input({ action: 'mod.ban', category: 'MODERATION', local: null }))).toEqual(['source:s-sanctions', 'global:g-sanctions']);
  });

  it('alerte de sécurité : copie dans 🚨・alertes-sécurité ; clear : pas de copie générale', () => {
    expect(ids(input({ action: 'antiraid.spam', category: 'SECURITY', local: null }))).toEqual(['source:s-security', 'global:g-security']);
    expect(ids(input({ action: 'mod.purge', category: 'MODERATION', local: null }))).toEqual(['source:s-clear']);
  });

  it('configuration : config-bot de la source + bot-système ; bot.system : section générale seulement', () => {
    expect(ids(input({ action: 'config.change', category: 'SYSTEM', local: null }))).toEqual(['source:s-config', 'global:g-system']);
    expect(ids(input({ action: 'bot.startup', category: 'SYSTEM', local: null }))).toEqual(['global:g-system']);
  });

  it('replis : route fine absente → route de la catégorie → config-bot → bot-système', () => {
    // member.nickname absent → catégorie MEMBER → member.join
    expect(ids(input({ action: 'member.nickname', category: 'MEMBER', local: null }))).toEqual(['source:s-join']);
    // whitelist absent (serveur sans whitelist) → catégorie WHITELIST → whitelist absent → config-bot
    expect(ids(input({ action: 'whitelist.apply', category: 'WHITELIST', local: null }))).toEqual(['source:s-config']);
    // section de la source vide → bot-système de la section générale (une seule fois, même pour bot.config)
    const empty = { [HUB]: { ...routes, [SRC]: {} } };
    expect(ids(input({ action: 'whitelist.apply', category: 'WHITELIST', local: null, routes: empty }))).toEqual(['source:g-system']);
    expect(ids(input({ action: 'config.change', category: 'SYSTEM', local: null, routes: empty }))).toEqual(['source:g-system']);
  });

  it('log en jeu : section du jeu uniquement (jamais la section Discord), copie générale des sanctions et de l’anticheat', () => {
    const game = { serverId: 7, route: null };
    const gameLink = { hubGuildId: HUB, chat: false };
    expect(ids(input({ action: 'game.kill', category: 'GAME', local: { GAME: 'local-game' }, game, gameLink }))).toEqual(['local:local-game', 'game:j-kills']);
    expect(ids(input({ action: 'game.ban', category: 'GAME', local: null, game, gameLink }))).toEqual(['game:j-sanctions', 'global:g-sanctions']);
    expect(ids(input({ action: 'game.anticheat', category: 'GAME', local: null, game, gameLink }))).toEqual(['game:j-ac', 'global:g-security']);
    // custom avec indication de salon
    expect(ids(input({ action: 'game.custom', category: 'GAME', local: null, game: { serverId: 7, route: 'game.connections' }, gameLink }))).toEqual(['game:j-co']);
    // route de jeu absente → serveur-jeu
    expect(ids(input({ action: 'game.match_end', category: 'GAME', local: null, game, gameLink }))).toEqual(['game:j-server']);
  });

  it('catégorie GAME : jamais de repli sur le salon Système local', () => {
    expect(localChannel({ SYSTEM: 'sys' }, 'GAME')).toBeNull();
    expect(localChannel({ SYSTEM: 'sys' }, 'TICKET')).toBe('sys');
  });

  it('chat en jeu : seulement si activé, sans repli', () => {
    const game = { serverId: 7, route: null };
    expect(ids(input({ action: 'game.chat', category: 'GAME', local: null, game, gameLink: { hubGuildId: HUB, chat: false } }))).toEqual([]);
    expect(ids(input({ action: 'game.chat', category: 'GAME', local: null, game, gameLink: { hubGuildId: HUB, chat: true } }))).toEqual(['game:j-chat']);
    expect(gameChannel(routes, 7, 'game.chat', true)).toBe('j-chat');
    expect(gameChannel({ 'game:7': { 'game.server': 'x' } }, 7, 'game.chat', true)).toBeNull();
  });

  it('jeu non relié au hub : rien dans le hub (journal local et base conservés)', () => {
    expect(ids(input({ action: 'game.kill', category: 'GAME', local: { GAME: 'local-game' }, game: { serverId: 7 }, gameLink: null }))).toEqual(['local:local-game']);
  });

  it('action Discord liée à un jeu (maintenance) : section de la source + serveur-jeu', () => {
    expect(ids(input({ action: 'fivem.maintenance.on', category: 'SYSTEM', local: null, game: { serverId: 7 }, gameLink: { hubGuildId: HUB, chat: false } }))).toEqual(['source:s-sync', 'game:j-server']);
  });

  it('hub lui-même : ses événements importants vont dans sa section générale', () => {
    expect(ids({ guildId: HUB, action: 'antinuke.channelDelete', category: 'SECURITY', local: null, source: null, selfHub: true, routes: { [HUB]: routes } })).toEqual(['global:g-security']);
    expect(ids({ guildId: HUB, action: 'message.delete', category: 'MESSAGE', local: null, source: null, selfHub: true, routes: { [HUB]: routes } })).toEqual([]);
  });

  it('jamais deux fois le même salon', () => {
    const same = { [HUB]: { global: { 'global.sanctions': 'same' }, [SRC]: { 'mod.sanctions': 'same' } } };
    expect(ids(input({ action: 'mod.ban', category: 'MODERATION', local: null, routes: same }))).toEqual(['source:same']);
  });

  it('sourceChannel sans table : null', () => {
    expect(sourceChannel(undefined, SRC, 'tickets', 'TICKET')).toBeNull();
  });
});
