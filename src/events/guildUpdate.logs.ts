import { AuditLogEvent, Events, GuildExplicitContentFilter, GuildMFALevel, GuildVerificationLevel, type Guild } from 'discord.js';
import { defineEvent } from '../structures';
import { loggingService } from '../services/LoggingService';
import { BRAND } from '../config/constants';
import { fetchAudit, logContext, trunc, userLine } from './_logs.helpers';
import type { Translator } from '../services/TranslationService';

type Change = { name: string; value: string; inline?: boolean };
type FieldKey = 'name' | 'icon' | 'banner' | 'description' | 'verification' | 'content_filter' | 'mfa' | 'system_channel' | 'rules_channel' | 'updates_channel' | 'afk_channel' | 'afk_timeout' | 'locale' | 'vanity' | 'owner';

const channel = (id: string | null, t: Translator) => (id ? `<#${id}>` : t('core.none'));
const text = (v: string | null | undefined, t: Translator) => (v ? trunc(v, 300) : t('core.none'));

/** Différences lisibles entre deux états du serveur (nom, icône, sécurité, salons système, propriétaire…). */
export function guildChanges(before: Guild, after: Guild, t: Translator): Change[] {
  const out: Change[] = [];
  const diff = (key: FieldKey, a: string, b: string, inline = true) => {
    if (a !== b) out.push({ name: t(`logs.server.fields.${key}`), value: `${a} → ${b}`, inline });
  };
  diff('name', before.name, after.name);
  if (before.icon !== after.icon) out.push({ name: t('logs.server.fields.icon'), value: after.iconURL() ? `[${t('logs.server.view')}](${after.iconURL({ size: 256 })})` : t('core.none'), inline: true });
  if (before.banner !== after.banner) out.push({ name: t('logs.server.fields.banner'), value: after.bannerURL() ? `[${t('logs.server.view')}](${after.bannerURL({ size: 512 })})` : t('core.none'), inline: true });
  if (before.description !== after.description) out.push({ name: t('logs.server.fields.description'), value: `${text(before.description, t)} → ${text(after.description, t)}`, inline: false });
  diff('verification', GuildVerificationLevel[before.verificationLevel] ?? String(before.verificationLevel), GuildVerificationLevel[after.verificationLevel] ?? String(after.verificationLevel));
  diff('content_filter', GuildExplicitContentFilter[before.explicitContentFilter] ?? String(before.explicitContentFilter), GuildExplicitContentFilter[after.explicitContentFilter] ?? String(after.explicitContentFilter));
  diff('mfa', GuildMFALevel[before.mfaLevel] ?? String(before.mfaLevel), GuildMFALevel[after.mfaLevel] ?? String(after.mfaLevel));
  diff('system_channel', channel(before.systemChannelId, t), channel(after.systemChannelId, t));
  diff('rules_channel', channel(before.rulesChannelId, t), channel(after.rulesChannelId, t));
  diff('updates_channel', channel(before.publicUpdatesChannelId, t), channel(after.publicUpdatesChannelId, t));
  diff('afk_channel', channel(before.afkChannelId, t), channel(after.afkChannelId, t));
  diff('afk_timeout', `${before.afkTimeout}s`, `${after.afkTimeout}s`);
  diff('locale', before.preferredLocale, after.preferredLocale);
  diff('vanity', before.vanityURLCode ?? t('core.none'), after.vanityURLCode ?? t('core.none'));
  if (before.ownerId !== after.ownerId) out.push({ name: t('logs.server.fields.owner'), value: `<@${before.ownerId}> → <@${after.ownerId}>`, inline: false });
  return out;
}

/** Paramètres du serveur modifiés (route hub : server.settings). */
export default defineEvent({
  name: Events.GuildUpdate,
  async execute(_client, oldGuild, newGuild) {
    const ctx = await logContext(newGuild.id);
    if (!ctx) return;
    const { t } = ctx;
    const changes = guildChanges(oldGuild, newGuild, t);
    if (!changes.length) return; // boosts, fonctionnalités, nombre de membres : ignorés
    const audit = await fetchAudit(newGuild, AuditLogEvent.GuildUpdate);
    await loggingService.log({
      guildId: newGuild.id,
      category: 'SYSTEM',
      action: 'server.update',
      title: t('logs.server.updated_title'),
      fields: [{ name: t('logs.fields.changed_by'), value: audit?.executor ? userLine(audit.executor) : t('logs.unknown'), inline: true }, ...changes].slice(0, 25),
      actorId: audit?.executor?.id ?? null,
      color: oldGuild.ownerId !== newGuild.ownerId ? BRAND.colors.danger : BRAND.colors.warning,
      data: { changes: changes.map((c) => ({ field: c.name, value: c.value })) },
    });
  },
});
