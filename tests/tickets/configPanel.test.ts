import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guild } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));
vi.mock('../../src/config/env', () => ({ env: () => ({ OWNER_IDS: [] }) }));

import { prisma as prismaClient } from '../../src/database/client';
import { buildInfoModal, buildNewTypeModal, buildQuestionsModal, parseQuestionSlots, parseReminderHours, renderMain, renderOptions, renderPanelView, renderType, serializeQuestion, slugifyKey, uniqueKey } from '../../src/commands/tickets/_configPanel';
import { PanelStyle } from '@prisma/client';

const prisma = prismaClient as unknown as ReturnType<typeof createPrismaMock>;

const t = (key: string, vars: Record<string, unknown> = {}) => `${key}${Object.keys(vars).length ? `[${Object.values(vars).join(',')}]` : ''}`;
const guild = { id: '222222222222222222', name: 'Redemption Story', channels: { cache: new Map([['444444444444444444', { name: 'support', type: 0 }]]) } } as unknown as Guild;

const baseType = {
  id: 7,
  guildId: guild.id,
  key: 'support',
  label: 'Support',
  emoji: '🎫',
  description: 'Besoin d’aide ?',
  categoryId: '444444444444444444',
  archiveCategoryId: null,
  staffRoleIds: ['555555555555555555'],
  questions: [{ id: 'q1', label: 'Sujet', style: 'short', required: true }],
  embed: null,
  welcomeMessage: null,
  language: 'fr',
  nameFormat: 'ticket-{number}',
  maxPerUser: 1,
  enabled: true,
  order: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

type Component = { custom_id?: string; type: number; disabled?: boolean; options?: { value: string; label: string }[] };
const flatten = (payload: { components: { toJSON(): { components: unknown[] } }[] }): Component[] => payload.components.flatMap((r) => r.toJSON().components as Component[]);

describe('slugifyKey / uniqueKey', () => {
  it('génère une clé slug valide depuis le libellé', () => {
    expect(slugifyKey('Support')).toBe('support');
    expect(slugifyKey('  Bug  &  Crash !! ')).toBe('bug-crash');
    expect(slugifyKey('Problème de paiement')).toBe('probleme-de-paiement');
    expect(slugifyKey('A')).toBe('type-a');
    expect(slugifyKey('x'.repeat(50))).toHaveLength(32);
    for (const label of ['Support', 'Shop 🛒', 'Événement spécial 2026']) expect(slugifyKey(label)).toMatch(/^[a-z0-9-]{2,32}$/);
  });

  it('ajoute un suffixe numérique en cas de collision', () => {
    expect(uniqueKey('Support', ['support'])).toBe('support-2');
    expect(uniqueKey('Support', ['support', 'support-2'])).toBe('support-3');
    expect(uniqueKey('Support', [])).toBe('support');
  });
});

describe('questions', () => {
  it('parse la saisie des 5 champs et renumérote', () => {
    const qs = parseQuestionSlots(['Sujet | Décrivez | short | required | 100', '', 'Détails | | paragraph | optional', undefined, '   ']);
    expect(qs).toEqual([
      { id: 'q1', label: 'Sujet', placeholder: 'Décrivez', style: 'short', required: true, maxLength: 100 },
      { id: 'q3', label: 'Détails', style: 'paragraph', required: false },
    ]);
    expect(serializeQuestion(qs[0]!)).toBe('Sujet | Décrivez | short | required | 100');
    expect(serializeQuestion(qs[1]!)).toBe('Détails |  | paragraph | optional');
  });

  it('refuse une question invalide (maxLength hors bornes)', () => {
    expect(() => parseQuestionSlots(['Sujet | | short | required | 99999'])).toThrowError(/invalid_question/);
  });
});

describe('renderMain', () => {
  beforeEach(() => {
    prisma.ticketType.findMany.mockReset();
    prisma.ticketPanel.findMany.mockReset();
  });

  it('liste les types dans le select, boutons avec customIds < 100 caractères', async () => {
    prisma.ticketType.findMany.mockResolvedValueOnce([baseType, { ...baseType, id: 8, key: 'bug', label: 'Bug', emoji: '🐛', enabled: false, categoryId: null }]);
    prisma.ticketPanel.findMany.mockResolvedValueOnce([]);
    const payload = await renderMain({ guild, t, notice: { type: 'success', text: 'OK' } });
    expect(payload.components).toHaveLength(2);
    const components = flatten(payload);
    const select = components[0]!;
    expect(select.custom_id).toBe('tcfg:pick');
    expect(select.options!.map((o) => o.value)).toEqual(['7', '8']);
    expect(select.options![1]!.label).toContain('core.disabled');
    const buttons = components.slice(1);
    expect(buttons.map((b) => b.custom_id)).toEqual(['tcfg:new', 'tcfg:defaults', 'tcfg:panelview', 'tcfg:options', 'tcfg:main']);
    expect(buttons[1]!.disabled).toBe(true); // raisons par défaut désactivé : des types existent déjà
    expect(components.every((c) => !c.custom_id || c.custom_id.length < 100)).toBe(true);
    const embed = payload.embeds[0]!.toJSON();
    expect(embed.description).toContain('✅ OK');
    expect(embed.fields![0]!.value).toContain('<#444444444444444444>');
    expect(embed.fields![0]!.value).toContain('tickets.config.no_category');
  });

  it('sans type : pas de select, bouton « raisons par défaut » actif', async () => {
    prisma.ticketType.findMany.mockResolvedValueOnce([]);
    prisma.ticketPanel.findMany.mockResolvedValueOnce([]);
    const payload = await renderMain({ guild, t });
    expect(payload.components).toHaveLength(1);
    const [, defaults] = flatten(payload);
    expect(defaults!.custom_id).toBe('tcfg:defaults');
    expect(defaults!.disabled).toBe(false);
    expect(payload.embeds[0]!.toJSON().description).toContain('tickets.config.empty');
  });
});

describe('renderOptions', () => {
  it('transcripts (log TICKET) pré-remplis, mention des relances pré-sélectionnée, 5 boutons', () => {
    const config = { guildId: guild.id, modules: { tickets: false }, logChannels: { TICKET: '444444444444444444' }, staffRoleIds: ['555555555555555555'] } as never;
    const payload = renderOptions({ guild, config, reminders: { remindersEnabled: true, reminderHours: 12, reminderPing: 'staff' }, t });
    expect(payload.components.length).toBeLessThanOrEqual(5);
    const rows = payload.components.map((r) => r.toJSON().components as (Component & { default_values?: { id: string }[]; style?: number; options?: { value: string; default?: boolean }[] })[]);
    expect(rows[0]![0]!.custom_id).toBe('tcfg:translog');
    expect(rows[0]![0]!.default_values).toEqual([{ id: '444444444444444444', type: 'channel' }]);
    expect(rows[1]![0]!.custom_id).toBe('tcfg:rping');
    expect(rows[1]![0]!.options!.find((o) => o.default)!.value).toBe('staff');
    expect(rows[2]!.map((c) => c.custom_id)).toEqual(['tcfg:rtoggle', 'tcfg:rhours', 'tcfg:translog-off', 'tcfg:module', 'tcfg:main']);
    expect(rows[2]![0]!.style).toBe(3); // Success : relances actives
    expect(rows[2]![3]!.style).toBe(4); // Danger : module désactivé
    const embed = payload.embeds[0]!.toJSON();
    expect(embed.fields!.some((f) => f.value.includes('<@&555555555555555555>'))).toBe(true);
    expect(embed.fields!.some((f) => f.value.includes('12'))).toBe(true);
    expect(embed.description).toContain('panels_core.tickets.permanent_hint');
  });

  it('parseReminderHours : 1–168, suffixe h accepté', () => {
    expect(parseReminderHours('24')).toBe(24);
    expect(parseReminderHours(' 48h ')).toBe(48);
    expect(parseReminderHours('0')).toBeNull();
    expect(parseReminderHours('169')).toBeNull();
    expect(parseReminderHours('abc')).toBeNull();
    expect(parseReminderHours(undefined)).toBeNull();
  });
});

describe('renderType', () => {
  it('5 rangées : actions, catégorie / archive pré-remplies, rôles, suppression', () => {
    const payload = renderType({ guild, type: baseType as never, t });
    expect(payload.components).toHaveLength(5);
    const rows = payload.components.map((r) => r.toJSON().components as (Component & { default_values?: { id: string; type: string }[]; min_values?: number; max_values?: number })[]);
    expect(rows[0]!.map((c) => c.custom_id)).toEqual(['tcfg:info:7', 'tcfg:questions:7', 'tcfg:welcome:7', 'tcfg:toggle:7', 'tcfg:main']);
    expect(rows[1]![0]!.custom_id).toBe('tcfg:category:7');
    expect(rows[1]![0]!.default_values).toEqual([{ id: '444444444444444444', type: 'channel' }]);
    expect(rows[2]![0]!.custom_id).toBe('tcfg:archive:7');
    expect(rows[2]![0]!.default_values).toBeUndefined();
    expect(rows[3]![0]!.custom_id).toBe('tcfg:roles:7');
    expect(rows[3]![0]!.min_values).toBe(0);
    expect(rows[3]![0]!.default_values).toEqual([{ id: '555555555555555555', type: 'role' }]);
    expect(rows[4]!.map((c) => c.custom_id)).toEqual(['tcfg:archivenone:7', 'tcfg:delete:7']);
    expect(rows[4]![0]!.disabled).toBe(true); // pas d'archive à retirer
    const embed = payload.embeds[0]!.toJSON();
    expect(embed.fields!.some((f) => f.value.includes('<@&555555555555555555>'))).toBe(true);
    expect(embed.fields!.some((f) => f.value.includes('tickets.config.question_line[1,Sujet,short,tickets.config.required]'))).toBe(true);
  });
});

describe('renderPanelView', () => {
  it('salon pré-rempli, style actif en Primary, publication désactivée sans salon', async () => {
    prisma.ticketType.findMany.mockResolvedValueOnce([baseType]);
    prisma.ticketPanel.findMany.mockResolvedValueOnce([{ id: 3, guildId: guild.id, channelId: '444444444444444444', messageId: null, embed: null, typeIds: [], style: PanelStyle.SELECT, createdAt: new Date() }]);
    const payload = await renderPanelView({ guild, t, draft: { channelId: undefined, style: PanelStyle.SELECT, typeIds: [7] } });
    const components = flatten(payload) as (Component & { style?: number })[];
    const ids = components.map((c) => c.custom_id);
    expect(ids).toEqual(['tcfg:pchannel', 'tcfg:ptypes', 'tcfg:pstyle:buttons', 'tcfg:pstyle:select', 'tcfg:publish', 'tcfg:main', 'tcfg:pdelete']);
    expect(components.find((c) => c.custom_id === 'tcfg:pstyle:select')!.style).toBe(1);
    expect(components.find((c) => c.custom_id === 'tcfg:publish')!.disabled).toBe(true);
    expect(components.find((c) => c.custom_id === 'tcfg:pdelete')!.options![0]!.value).toBe('3');
    expect(payload.embeds[0]!.toJSON().fields!.some((f) => f.value.includes('tickets.config.panel_line[3,<#444444444444444444>,tickets.config.style_select,1]'))).toBe(true);
  });
});

describe('modals', () => {
  it('customIds et champs pré-remplis', () => {
    expect(buildNewTypeModal(t).toJSON().custom_id).toBe('tcfg:new');
    const info = buildInfoModal(baseType as never, t).toJSON();
    expect(info.custom_id).toBe('tcfg:info:7');
    expect(info.components).toHaveLength(5);
    const questions = buildQuestionsModal(baseType as never, t).toJSON();
    expect(questions.custom_id).toBe('tcfg:questions:7');
    expect(questions.components).toHaveLength(5);
    const first = (questions.components[0] as { component: { value?: string } }).component;
    expect(first.value).toBe('Sujet |  | short | required');
  });
});
