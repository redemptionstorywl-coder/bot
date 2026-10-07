import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/LoggingService', () => ({ loggingService: { log: vi.fn() } }));

import { loggingService } from '../../src/services/LoggingService';
import { configAudit, isConfigNamespace } from '../../src/services/ConfigAuditService';
import { ok, ko, withNotice } from '../../src/panels/_coreKit';
import { translationService } from '../../src/services/TranslationService';
import { guildChanges } from '../../src/events/guildUpdate.logs';
import { AUDIT_LOG_ACTIONS, auditChanges } from '../../src/events/guildAuditLogEntryCreate.logs';
import { AuditLogEvent } from 'discord.js';

const t = translationService.bind('fr');

describe('journal des modifications /config (config.change)', () => {
  it('capture les notices ✅ rendues pendant une action de configuration, jamais en dehors', async () => {
    withNotice(ok('hors action'));
    const { notes } = await configAudit.run(async () => {
      withNotice(ok('Logs **Messages** → <#1>'), 'aide');
      withNotice(ko('erreur ignorée'));
      withNotice(ok('Logs **Messages** → <#1>')); // doublon
      withNotice(undefined);
    });
    expect(notes).toEqual(['Logs **Messages** → <#1>']);
  });

  it('namespaces de configuration', () => {
    expect(isConfigNamespace('cfg-logs')).toBe(true);
    expect(isConfigNamespace('tcfg')).toBe(true);
    expect(isConfigNamespace('welcome')).toBe(true);
    expect(isConfigNamespace('tpl')).toBe(false);
    expect(isConfigNamespace('ticket')).toBe(false);
  });

  it('écrit un log SYSTEM config.change avec l’auteur et le panneau', async () => {
    await configAudit.log({ guildId: '1', userId: '2', namespace: 'cfg-logs', action: 'set', notes: ['a', 'b'], t });
    expect(loggingService.log).toHaveBeenCalledWith(expect.objectContaining({ category: 'SYSTEM', action: 'config.change', actorId: '2', description: '• a\n• b' }));
  });
});

describe('logs Discord ajoutés (paramètres du serveur, audit)', () => {
  const g = (over: Record<string, unknown>) => ({
    name: 'RS',
    icon: null,
    banner: null,
    description: null,
    verificationLevel: 1,
    explicitContentFilter: 0,
    mfaLevel: 0,
    systemChannelId: null,
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    afkChannelId: null,
    afkTimeout: 300,
    preferredLocale: 'fr',
    vanityURLCode: null,
    ownerId: '1',
    iconURL: () => null,
    bannerURL: () => null,
    ...over,
  });

  it('guildChanges : nom, niveau de vérification, transfert de propriété', () => {
    const changes = guildChanges(g({}) as never, g({ name: 'RS 2', verificationLevel: 3, ownerId: '2' }) as never, t);
    expect(changes.map((c) => c.name)).toEqual(['Nom', 'Niveau de vérification', 'Propriétaire']);
    expect(changes[2]!.value).toBe('<@1> → <@2>');
    expect(guildChanges(g({}) as never, g({}) as never, t)).toEqual([]);
  });

  it('audit : webhooks, emojis, intégrations (applications / bots ajoutés → sécurité)', () => {
    expect(AUDIT_LOG_ACTIONS[AuditLogEvent.WebhookCreate]?.action).toBe('webhook.create');
    expect(AUDIT_LOG_ACTIONS[AuditLogEvent.EmojiDelete]?.action).toBe('emoji.delete');
    expect(AUDIT_LOG_ACTIONS[AuditLogEvent.IntegrationCreate]).toMatchObject({ action: 'integration.create', category: 'SECURITY' });
    expect(auditChanges({ changes: [{ key: 'name', old: 'a', new: 'b' }, { key: 'avatar', old: 'x', new: 'y' }, { key: 'channel_id', new: '123456789012345678' }] } as never)).toEqual(['`name` : a → b', '`channel_id` : — → <#123456789012345678> (`123456789012345678`)']);
  });
});
