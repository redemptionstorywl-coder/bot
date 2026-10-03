import { EmbedBuilder, GuildMember, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Guild, type User } from 'discord.js';
import type { Sanction } from '@prisma/client';
import type { InteractionContext } from '../../structures/types';
import { embedService } from '../../services/EmbedService';
import { ModerationError, moderationService, type SanctionResult, type WarnResult } from '../../services/ModerationService';
import { canModerate } from '../../utils/permissions';
import { parseDuration, formatDuration } from '../../utils/time';
import { BRAND } from '../../config/constants';

export const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Vérifie la hiérarchie actor → cible et bot → cible. Retourne une clé i18n d'erreur ou null. */
export function hierarchyError(interaction: ChatInputCommandInteraction, target: GuildMember, requirement: 'bannable' | 'kickable' | 'moderatable' | 'manageable'): string | null {
  const actor = interaction.member instanceof GuildMember ? interaction.member : null;
  const guild = interaction.guild;
  if (!actor || !guild) return 'moderation.errors.member_only';
  if (target.id === actor.id) return 'moderation.errors.self';
  if (target.id === guild.client.user.id) return 'moderation.errors.bot_target';
  if (target.id === guild.ownerId) return 'moderation.errors.owner';
  if (!canModerate(actor, target)) return 'moderation.errors.hierarchy';
  if (!target[requirement]) return 'moderation.errors.bot_hierarchy';
  return null;
}

/** Lit l'option durée (texte libre "1h30m") ; retourne secondes, null si absente, ou 'invalid'. */
export function readDuration(interaction: ChatInputCommandInteraction, name = 'duration', required = false): number | null | 'invalid' {
  const raw = interaction.options.getString(name, required);
  if (!raw) return null;
  const sec = parseDuration(raw);
  return sec && sec > 0 ? sec : 'invalid';
}

export function readReason(interaction: ChatInputCommandInteraction, required = false): string | null {
  const r = interaction.options.getString('reason', required)?.trim();
  return r ? r.slice(0, 512) : null;
}

/** Résout un GuildMember pour l'option `user` (null s'il n'est pas sur le serveur). */
export async function resolveMember(interaction: ChatInputCommandInteraction, name = 'user'): Promise<{ user: User; member: GuildMember | null }> {
  const user = interaction.options.getUser(name, true);
  const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
  return { user, member };
}

/** Embed de confirmation d'une sanction (réponse éphémère au modérateur). */
export function sanctionEmbed(ctx: InteractionContext, guild: Guild, result: SanctionResult, target: User | null, extraLines: string[] = []): EmbedBuilder {
  const { t, lang } = ctx;
  const s = result.sanction;
  const lines = [t('moderation.reply.done', { type: moderationService.typeLabel(t, s.type), user: target ? `<@${target.id}>` : '—', number: s.caseNumber })];
  if (s.duration) lines.push(t('moderation.reply.duration', { duration: formatDuration(s.duration, lang) }));
  lines.push(t('moderation.reply.reason', { reason: s.reason ?? t('core.no_reason') }));
  if (target && !target.bot && ['BAN', 'TEMPBAN', 'KICK', 'WARN', 'TIMEOUT', 'MUTE'].includes(s.type)) lines.push(result.dmSent ? t('moderation.reply.dm_sent') : t('moderation.reply.dm_failed'));
  lines.push(...extraLines);
  const positive = ['UNBAN', 'UNWARN', 'UNTIMEOUT', 'UNMUTE'].includes(s.type);
  return new EmbedBuilder()
    .setColor(positive ? BRAND.colors.primary : BRAND.colors.danger)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${guild.name} • ${t('moderation.case', { number: s.caseNumber })}` });
}

/** Lignes décrivant une escalade de warn. */
export function escalationLines(ctx: InteractionContext, result: WarnResult): string[] {
  const { t, lang } = ctx;
  const lines = [t('moderation.reply.warn_count', { count: result.activeCount })];
  const esc = result.escalation;
  if (!esc) return lines;
  const action = t(`moderation.actions.${esc.threshold.action}`);
  if (esc.sanction) {
    lines.push(t('moderation.reply.escalated', { count: esc.threshold.count, action, number: esc.sanction.caseNumber, duration: esc.threshold.duration ? formatDuration(esc.threshold.duration, lang) : '' }));
  } else {
    lines.push(t('moderation.reply.escalation_failed', { action, error: t(esc.error ?? 'core.error') }));
  }
  return lines;
}

/** Répond avec une erreur éphémère (gère deferred / replied). */
export async function replyError(interaction: ChatInputCommandInteraction, ctx: InteractionContext, key: string, vars?: Record<string, string | number>): Promise<void> {
  const payload = { embeds: [embedService.error(ctx.t(key, vars))], ...EPHEMERAL };
  if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: payload.embeds }).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
}

/** Convertit une erreur quelconque en clé i18n lisible. */
export function errorKey(err: unknown): { key: string; vars?: Record<string, string | number> } {
  if (err instanceof ModerationError) return { key: err.key, vars: err.vars };
  const code = (err as { code?: number })?.code;
  if (code === 50013) return { key: 'moderation.errors.missing_permissions' };
  if (code === 10026) return { key: 'moderation.errors.not_banned' };
  if (code === 10007 || code === 10013) return { key: 'core.member_not_found' };
  return { key: 'core.error' };
}

/** Une ligne lisible par sanction (utilisé par /history). */
export function sanctionLine(ctx: InteractionContext, s: Sanction): string {
  const { t, lang } = ctx;
  const ts = `<t:${Math.floor(s.createdAt.getTime() / 1000)}:d>`;
  const dur = s.duration ? ` • ${formatDuration(s.duration, lang)}` : '';
  const reason = (s.reason ?? t('core.no_reason')).slice(0, 80);
  return `**#${s.caseNumber}** • ${moderationService.typeLabel(t, s.type)}${dur} • ${ts} • <@${s.moderatorId}>\n└ ${reason}`;
}

export const MOD_PERMS = {
  ban: { internal: 'staff' as const, discord: [PermissionFlagsBits.BanMembers], bot: [PermissionFlagsBits.BanMembers] },
  kick: { internal: 'staff' as const, discord: [PermissionFlagsBits.KickMembers], bot: [PermissionFlagsBits.KickMembers] },
  timeout: { internal: 'staff' as const, discord: [PermissionFlagsBits.ModerateMembers], bot: [PermissionFlagsBits.ModerateMembers] },
  messages: { internal: 'staff' as const, discord: [PermissionFlagsBits.ManageMessages], bot: [PermissionFlagsBits.ManageMessages] },
  channels: { internal: 'staff' as const, discord: [PermissionFlagsBits.ManageChannels], bot: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] },
  roles: { internal: 'staff' as const, discord: [PermissionFlagsBits.ModerateMembers], bot: [PermissionFlagsBits.ManageRoles] },
  view: { internal: 'staff' as const },
  admin: { internal: 'admin' as const, discord: [PermissionFlagsBits.ManageGuild] },
};
