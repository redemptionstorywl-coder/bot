import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', async () => {
  const { createPrismaMock } = await import('../helpers/prisma');
  return { prisma: createPrismaMock() };
});
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [] }) }));
vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));

import { prisma } from '../../src/database/client';
import { logHubService, type SourceCandidate } from '../../src/services/LogHubService';
import { logTemplateService } from '../../src/services/LogTemplateService';
import { translationService } from '../../src/services/TranslationService';
import { nextGameState, previewLines, progressBar, renderMain, renderResult, selectable, type TemplateSession } from '../../src/commands/admin/_templateLogs';
import template from '../../src/commands/admin/template';
import { planTemplate } from '../../src/services/logs/template';

const db = prisma as unknown as ReturnType<typeof createPrismaMock>;
const t = translationService.bind('fr');
const HUB = '100000000000000009';

const candidate = (id: string, name: string, over: Partial<SourceCandidate> = {}): SourceCandidate => ({ guildId: id, name, kind: 'GENERIC', iconUrl: null, permission: { allowed: true, via: 'administrator' }, linkedHubId: null, linkedHubName: null, isHub: false, ...over });

describe('/template logs : commande et règles de l’assistant', () => {
  it('commande /template avec la sous-commande logs, réservée aux admins', () => {
    const json = template.data.toJSON() as { name: string; options: { name: string }[] };
    expect(json.name).toBe('template');
    expect(json.options.map((o) => o.name)).toEqual(['logs']);
    expect(template.permissions?.internal).toBe('admin');
  });

  it('sélectionnable : droit vérifié, pas un hub, libre ou relié à ce hub', () => {
    expect(selectable(candidate('1', 'A'), HUB)).toBe(true);
    expect(selectable(candidate('1', 'A', { permission: { allowed: false, reason: 'not_admin' } }), HUB)).toBe(false);
    expect(selectable(candidate('1', 'A', { isHub: true }), HUB)).toBe(false);
    expect(selectable(candidate('1', 'A', { linkedHubId: '7' }), HUB)).toBe(false);
    expect(selectable(candidate('1', 'A', { linkedHubId: HUB }), HUB)).toBe(true);
  });

  it('bouton de jeu : non → oui → oui + chat → non (un jeu déjà relié ne s’éteint pas ici)', () => {
    expect(nextGameState('off', false)).toBe('on');
    expect(nextGameState('on', false)).toBe('chat');
    expect(nextGameState('chat', false)).toBe('off');
    expect(nextGameState('chat', true)).toBe('on');
  });

  it('aperçu borné en caractères, progression lisible', () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({ guildId: `10000000000000000${i}`, label: `Serveur ${i}`, emoji: '📁', kind: 'GENERIC' as const, modules: {}, hasFiveM: false }));
    const plan = planTemplate({ sources, games: [], routes: {}, channels: new Map(), t });
    const lines = previewLines(plan, t, 1500);
    expect(lines.join('\n').length).toBeLessThan(1700);
    expect(lines.at(-1)).toContain('autre(s) catégorie(s)');
    expect(progressBar(5, 10)).toContain('50 %');
  });

  it('résultat : succès, erreurs Discord, salons ignorés', () => {
    const plan = planTemplate({ sources: [], games: [], routes: {}, channels: new Map(), t });
    const ok = renderResult({ t, lang: 'fr', client: {} as never }, { ok: true, plan, created: 5, reused: 0, skipped: 0, failed: [], summaryChannelId: '42' }, []);
    expect(ok.embeds[0]!.data.title).toBe('✅ Serveur de logs prêt');
    expect(ok.embeds[0]!.data.description).toContain('<#42>');
    const limit = renderResult({ t, lang: 'fr', client: {} as never }, { ok: false, error: 'guild_limit', plan: { ...plan, channelsAfter: 512 }, created: 0, reused: 0, skipped: 0, failed: [], summaryChannelId: null }, ['refus']);
    expect(limit.embeds[0]!.data.description).toContain('512');
    expect(limit.embeds[0]!.data.description).toContain('refus');
  });
});

describe('/template logs : vue principale (limites Discord)', () => {
  beforeEach(() => {
    logHubService.invalidate();
    db.logHub.findMany.mockResolvedValue([]);
    db.logHubSource.findMany.mockResolvedValue([]);
    db.logRoute.findMany.mockResolvedValue([]);
    db.guild.findUnique.mockResolvedValue(null);
  });

  it('25 serveurs max dans le menu, 10 jeux max (2 rangées), ≤ 5 rangées, customIds < 100, embed ≤ 6000', async () => {
    const candidates = Array.from({ length: 30 }, (_, i) => candidate(`2000000000000000${String(i).padStart(2, '0')}`, `Serveur Battle Royale ${i}`));
    const gameServers = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Jeu ${i}`, guildId: candidates[0]!.guildId, linked: false }));
    const session: TemplateSession = { hubGuildId: HUB, userId: '1', candidates, selected: [candidates[0]!.guildId, candidates[1]!.guildId], gameServers, games: Object.fromEntries(gameServers.map((g) => [String(g.id), 'on'])) };
    const guild = { id: HUB, name: 'Hub', channels: { cache: new Map() } };
    vi.spyOn(logTemplateService, 'state').mockImplementation(async (_g, extra) => ({ hubGuildId: HUB, exists: false, sources: extra!.sources!, games: extra!.games!, plan: planTemplate({ sources: extra!.sources!, games: extra!.games!, routes: {}, channels: new Map(), t }) }));
    const payload = await renderMain({ t, lang: 'fr', client: {} as never }, guild as never, session);
    expect(payload.components.length).toBeLessThanOrEqual(5);
    const json = payload.components.map((r) => r.toJSON()) as { components: { custom_id?: string; options?: unknown[] }[] }[];
    expect(json[0]!.components[0]!.options).toHaveLength(25);
    expect(json.flatMap((r) => r.components).filter((c) => c.custom_id?.startsWith('tpl:game:'))).toHaveLength(10);
    for (const c of json.flatMap((r) => r.components)) expect((c.custom_id ?? '').length).toBeLessThan(100);
    const embed = payload.embeds[0]!.toJSON();
    const length = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(length).toBeLessThanOrEqual(6000);
    for (const f of embed.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(1024);
  });
});
