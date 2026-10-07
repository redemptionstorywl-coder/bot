import { describe, expect, it } from 'vitest';
import { LogCategory, SanctionType } from '@prisma/client';
import { collectActions, run as logRoutesCheck } from '../../scripts/checks/log-routes';
import {
  ACTION_ROUTES,
  CATEGORY_ROUTES,
  GAME_ROUTE_KEYS,
  GLOBAL_MIRRORS,
  GLOBAL_ONLY_ROUTES,
  SOURCE_ACTION_GAME_ROUTES,
  SOURCE_ROUTE_KEYS,
  isGameAction,
  parseGameSourceKey,
  routeForAction,
} from '../../src/services/logs/routes';
import { GAME_LAYOUT, SOURCE_LAYOUT } from '../../src/services/logs/template';
import { GAME_ROUTE_BY_TYPE } from '../../src/services/fivem/gameLogs';
import { GAME_LOG_TYPES } from '../../src/services/fivem/schemas';

describe('table action → route (src/services/logs/routes.ts)', () => {
  it('chaque action journalisée dans src/ et dashboard/ a une route explicite (aucune action non résolue)', async () => {
    const { sites } = await collectActions();
    expect(sites.length).toBeGreaterThan(90);
    const unresolved = sites.filter((s) => s.unresolved).map((s) => `${s.where} ${s.unresolved}`);
    expect(unresolved).toEqual([]);
    const missing = sites.flatMap((s) => s.values.filter((v) => !ACTION_ROUTES[v]).map((v) => `${v} — ${s.where}`));
    expect(missing).toEqual([]);
    const result = await logRoutesCheck();
    expect(result.problems).toEqual([]);
  }, 120_000);

  it('les actions dynamiques sont toutes couvertes : sanctions, anti-raid, synchronisation FiveM', () => {
    for (const type of Object.values(SanctionType)) expect(ACTION_ROUTES[`mod.${type.toLowerCase()}`], type).toBeDefined();
    for (const t of ['BAN', 'KICK', 'WARN', 'UNBAN']) expect(ACTION_ROUTES[`fivem.sanction.${t.toLowerCase()}`]).toBe('fivem.sync');
    for (const k of ['spam', 'mass_mention', 'invite', 'link', 'new_account', 'bot', 'mass_join']) expect(ACTION_ROUTES[`antiraid.${k}`]).toBe('security.alerts');
    for (const t of GAME_LOG_TYPES) expect(ACTION_ROUTES[`game.${t}`], t).toBe(GAME_ROUTE_BY_TYPE[t]);
  });

  it('routes demandées : sanctions, clear, sécurité, messages, membres, serveur, vocal, modules, bot', () => {
    expect(routeForAction('mod.ban', 'MODERATION').route).toBe('mod.sanctions');
    expect(routeForAction('mod.unban_all', 'MODERATION').route).toBe('mod.sanctions');
    expect(routeForAction('mod.purge', 'MODERATION').route).toBe('mod.clear');
    expect(routeForAction('mod.slowmode', 'MODERATION').route).toBe('mod.clear');
    expect(routeForAction('mod.lockdown', 'MODERATION').route).toBe('security.alerts');
    expect(routeForAction('honeypot.triggered', 'SECURITY').route).toBe('security.alerts');
    expect(routeForAction('member.join_bot', 'MEMBER').route).toBe('security.alerts');
    expect(routeForAction('integration.create', 'SECURITY').route).toBe('security.alerts');
    expect(routeForAction('message.delete', 'MESSAGE').route).toBe('message.deleted');
    expect(routeForAction('message.edit', 'MESSAGE').route).toBe('message.edited');
    expect(routeForAction('message.bulk_delete', 'MESSAGE').route).toBe('message.bulk');
    expect(routeForAction('role.reaction', 'ROLE').route).toBe('member.roles');
    expect(routeForAction('role.create', 'ROLE').route).toBe('server.roles');
    expect(routeForAction('invite.create', 'CHANNEL').route).toBe('member.invites');
    expect(routeForAction('webhook.create', 'SYSTEM').route).toBe('server.settings');
    expect(routeForAction('vocal.create', 'VOICE').route).toBe('voice');
    expect(routeForAction('giveaway.end', 'ANNOUNCEMENT').route).toBe('events');
    expect(routeForAction('fivem.link.auto', 'BATTLE_ROYALE').route).toBe('battleroyale');
    expect(routeForAction('config.change', 'SYSTEM').route).toBe('bot.config');
    expect(routeForAction('bot.startup', 'SYSTEM').route).toBe('bot.system');
  });

  it('repli par catégorie pour une action inconnue (toutes les catégories couvertes)', () => {
    for (const c of Object.values(LogCategory)) expect(CATEGORY_ROUTES[c], c).toBeDefined();
    expect(routeForAction('ticket.nouvelle_action', 'TICKET')).toEqual({ route: 'tickets', explicit: false });
    expect(routeForAction('game.inconnu', 'GAME')).toEqual({ route: 'game.server', explicit: false });
  });

  it('chaque route Discord a un salon dans la structure (sauf bot.system, section générale seulement) ; chaque route de jeu aussi', () => {
    const layout = new Set(SOURCE_LAYOUT.flatMap((c) => c.channels.map((ch) => ch.route)));
    for (const r of SOURCE_ROUTE_KEYS) if (!GLOBAL_ONLY_ROUTES.has(r)) expect(layout.has(r), r).toBe(true);
    const game = new Set(GAME_LAYOUT.channels.map((c) => c.route));
    for (const r of GAME_ROUTE_KEYS) expect(game.has(r), r).toBe(true);
    for (const r of Object.values(ACTION_ROUTES)) expect([...SOURCE_ROUTE_KEYS, ...GAME_ROUTE_KEYS] as string[]).toContain(r);
    expect(GLOBAL_MIRRORS['mod.sanctions']).toBe('global.sanctions');
    expect(GLOBAL_MIRRORS['game.sanctions']).toBe('global.sanctions');
    expect(GLOBAL_MIRRORS['security.alerts']).toBe('global.security');
    expect(SOURCE_ACTION_GAME_ROUTES['fivem.maintenance.on']).toBe('game.server');
  });

  it('helpers', () => {
    expect(isGameAction('game.kill')).toBe(true);
    expect(isGameAction('mod.ban')).toBe(false);
    expect(parseGameSourceKey('game:12')).toBe(12);
    expect(parseGameSourceKey('123456789012345678')).toBeNull();
  });
});
