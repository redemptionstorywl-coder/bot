import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Client, type Guild, type GuildMember, type Message } from 'discord.js';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { env } from '../config/env';
import { CHANNELS_REMAPPED_EVENT, guildConfigService } from './GuildConfigService';
import { loggingService } from './LoggingService';
import { moderationService } from './ModerationService';
import { resolveInternalLevel } from '../utils/permissions';
import { childLogger } from '../utils/logger';

const log = childLogger('Honeypot');

/** Texte affiché dans le salon piège (fourni par le propriétaire du projet). */
export const HONEYPOT_TITLE = '⛔ DO NOT SEND MESSAGES HERE';
export const HONEYPOT_DESCRIPTION = [
  'This channel is an automated anti-spam trap.',
  '',
  'Any message sent here triggers automatic moderation — your recent messages will be deleted and you will be kicked from the server.',
  '',
  'If you can read this, keep scrolling. Do not type here.',
].join('\n');
export const HONEYPOT_DEFAULT_NAME = 'get-banned';

export type HoneypotDecision = 'ignore' | 'staff' | 'trap';

/**
 * Décision pure : que faire d'un message posté dans le salon piège ?
 *  - ignore : bot, webhook, message système, salon différent
 *  - staff  : membre de l'équipe (message simplement supprimé)
 *  - trap   : membre ordinaire → suppression des messages récents + expulsion
 */
export function decideHoneypot(input: { channelId: string; trapChannelId?: string | null; isBot: boolean; isWebhook: boolean; isSystem: boolean; isStaff: boolean }): HoneypotDecision {
  if (!input.trapChannelId || input.channelId !== input.trapChannelId) return 'ignore';
  if (input.isBot || input.isWebhook || input.isSystem) return 'ignore';
  return input.isStaff ? 'staff' : 'trap';
}

/**
 * Salon piège anti-spam : les bots de spam/raid postent dans tous les salons visibles.
 * Un message dans ce salon = compte compromis ou bot → ses messages récents sont supprimés et il est expulsé.
 * Config en mémoire (chargée au démarrage) : aucune requête SQL par message.
 */
export class HoneypotService {
  private client: Client | null = null;
  private readonly channels = new Map<string, { channelId: string; windowMinutes: number }>();
  private readonly processing = new Set<string>();

  async attach(client: Client): Promise<void> {
    if (!this.client) guildConfigService.on(CHANNELS_REMAPPED_EVENT, (guildId: string) => void this.reloadGuild(guildId));
    this.client = client;
    const rows = await prisma.honeypotChannel.findMany({ where: { enabled: true } });
    this.channels.clear();
    for (const r of rows) this.channels.set(r.guildId, { channelId: r.channelId, windowMinutes: r.deleteWindowMinutes });
    log.info({ count: rows.length }, 'Salons piège chargés');
  }

  /** Recharge la config d'un serveur (après /clear salon|serveur qui recrée les salons). */
  async reloadGuild(guildId: string): Promise<void> {
    const row = await prisma.honeypotChannel.findUnique({ where: { guildId } }).catch(() => null);
    if (row?.enabled) this.channels.set(guildId, { channelId: row.channelId, windowMinutes: row.deleteWindowMinutes });
    else this.channels.delete(guildId);
    // Salon recréé (remapChannelReferences remet messageId à null) : l'avertissement épinglé a disparu avec l'ancien
    // salon. Sans lui, des membres légitimes écriraient dans le piège et seraient expulsés.
    if (row && !row.messageId) await this.republishWarning(guildId, row.channelId).catch((err) => log.warn({ err, guild: guildId }, 'Salon piège : avertissement non republié'));
  }

  /** Publie et épingle l'avertissement dans le salon piège, puis mémorise le message. */
  private async republishWarning(guildId: string, channelId: string): Promise<void> {
    const channel = await this.client?.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const msg = await channel.send({ embeds: [this.embed()] });
    await msg.pin().catch(() => null);
    await prisma.honeypotChannel.update({ where: { guildId }, data: { messageId: msg.id } });
  }

  channelFor(guildId: string): string | null {
    return this.channels.get(guildId)?.channelId ?? null;
  }

  async getConfig(guildId: string) {
    return prisma.honeypotChannel.findUnique({ where: { guildId } });
  }

  embed(): EmbedBuilder {
    return new EmbedBuilder().setColor(BRAND.colors.danger).setTitle(HONEYPOT_TITLE).setDescription(HONEYPOT_DESCRIPTION);
  }

  /**
   * Crée (ou réutilise) le salon piège, en tête de liste, inscriptible par tous, publie et épingle l'avertissement.
   * Idempotent : si un salon est déjà configuré et existe encore, il est réutilisé et le message remis à jour.
   */
  async setup(guild: Guild, opts: { name?: string; channelId?: string; windowMinutes?: number } = {}): Promise<{ channelId: string; created: boolean }> {
    const existing = await this.getConfig(guild.id);
    let channel = opts.channelId ? await guild.channels.fetch(opts.channelId).catch(() => null) : existing ? await guild.channels.fetch(existing.channelId).catch(() => null) : null;
    let created = false;
    if (!channel || channel.type !== ChannelType.GuildText) {
      channel = await guild.channels.create({
        name: opts.name ?? HONEYPOT_DEFAULT_NAME,
        type: ChannelType.GuildText,
        position: 0,
        topic: '⛔ Anti-spam trap — do not send messages here.',
        reason: 'Redemption Story — salon piège anti-spam',
        permissionOverwrites: [
          { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
          { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks] },
        ],
      });
      created = true;
    }
    if (channel.type !== ChannelType.GuildText) throw new Error('honeypot_channel_type');
    // (Re)publie l'avertissement
    let messageId = existing?.channelId === channel.id ? existing.messageId : null;
    const old = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (old) await old.edit({ embeds: [this.embed()] });
    else {
      const msg = await channel.send({ embeds: [this.embed()] });
      await msg.pin().catch(() => null);
      messageId = msg.id;
    }
    const windowMinutes = opts.windowMinutes ?? existing?.deleteWindowMinutes ?? 60;
    await prisma.honeypotChannel.upsert({
      where: { guildId: guild.id },
      create: { guildId: guild.id, channelId: channel.id, messageId, enabled: true, deleteWindowMinutes: windowMinutes },
      update: { channelId: channel.id, messageId, enabled: true, deleteWindowMinutes: windowMinutes },
    });
    this.channels.set(guild.id, { channelId: channel.id, windowMinutes });
    await loggingService.log({ guildId: guild.id, category: 'SECURITY', action: 'honeypot.setup', title: '🍯 Salon piège configuré', description: `<#${channel.id}>` });
    return { channelId: channel.id, created };
  }

  async setEnabled(guildId: string, enabled: boolean): Promise<void> {
    const row = await prisma.honeypotChannel.update({ where: { guildId }, data: { enabled } });
    if (enabled) this.channels.set(guildId, { channelId: row.channelId, windowMinutes: row.deleteWindowMinutes });
    else this.channels.delete(guildId);
  }

  /** Retire la configuration (et supprime le salon si `deleteChannel`). */
  async remove(guild: Guild, deleteChannel = false): Promise<void> {
    const row = await this.getConfig(guild.id);
    this.channels.delete(guild.id);
    if (!row) return;
    await prisma.honeypotChannel.delete({ where: { guildId: guild.id } });
    if (deleteChannel) await (await guild.channels.fetch(row.channelId).catch(() => null))?.delete('Redemption Story — salon piège retiré').catch(() => null);
  }

  async handleMessage(message: Message): Promise<void> {
    if (!message.inGuild()) return;
    const trap = this.channels.get(message.guildId);
    if (!trap || message.channelId !== trap.channelId) return;
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    const config = await guildConfigService.get(message.guildId);
    const level = member ? resolveInternalLevel(member as GuildMember, config, env().OWNER_IDS) : 'everyone';
    const isStaff = level !== 'everyone' || !!member?.permissions.has(PermissionFlagsBits.ManageMessages);
    const decision = decideHoneypot({ channelId: message.channelId, trapChannelId: trap.channelId, isBot: message.author.bot, isWebhook: !!message.webhookId, isSystem: message.system, isStaff });
    if (decision === 'ignore') return;
    await message.delete().catch(() => null);
    if (decision === 'staff' || !member) return;

    const key = `${message.guildId}:${member.id}`;
    if (this.processing.has(key)) return;
    this.processing.add(key);
    try {
      const deleted = await this.purgeRecentMessages(member, trap.windowMinutes);
      let kicked = false;
      if (member.kickable) {
        await moderationService.kick({ guild: message.guild, target: member, moderator: message.client.user, reason: 'Salon piège anti-spam (get-banned)', metadata: { honeypot: true, deleted } });
        kicked = true;
      }
      await loggingService.log({
        guildId: message.guildId,
        category: 'SECURITY',
        action: 'honeypot.triggered',
        title: '🍯 Salon piège déclenché',
        description: `${member.user.tag} (<@${member.id}>) a écrit dans <#${trap.channelId}>.`,
        fields: [
          { name: 'Contenu', value: (message.content || '—').slice(0, 1000) },
          { name: 'Messages supprimés', value: String(deleted), inline: true },
          { name: 'Expulsé', value: kicked ? 'Oui' : 'Non (hiérarchie / permissions)', inline: true },
        ],
        color: BRAND.colors.danger,
        targetId: member.id,
      });
    } catch (err) {
      log.error({ err, guild: message.guildId, user: member.id }, 'Salon piège : action impossible');
    } finally {
      setTimeout(() => this.processing.delete(key), 10_000).unref();
    }
  }

  /** Supprime les messages récents (cache du bot) de ce membre dans tous les salons textuels. */
  private async purgeRecentMessages(member: GuildMember, windowMinutes: number): Promise<number> {
    const since = Date.now() - windowMinutes * 60_000;
    let total = 0;
    for (const channel of member.guild.channels.cache.values()) {
      if (!channel.isTextBased() || channel.isDMBased() || !('bulkDelete' in channel)) continue;
      const mine = channel.messages.cache.filter((m) => m.author.id === member.id && m.createdTimestamp >= since);
      if (!mine.size) continue;
      const deleted = await channel.bulkDelete(mine, true).catch(() => null);
      total += deleted?.size ?? 0;
    }
    return total;
  }
}

export const honeypotService = new HoneypotService();
