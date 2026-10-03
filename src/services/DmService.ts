import { EmbedBuilder, type Client, type Guild, type GuildMember, type User } from 'discord.js';
import { BRAND } from '../config/constants';
import { loggingService } from './LoggingService';
import { renderTemplate } from '../utils/variables';
import { childLogger } from '../utils/logger';
import { sleep } from '../utils/time';

const log = childLogger('DmService');

export interface DmContent {
  message: string;
  /** Afficher le message dans un embed (titre optionnel) */
  asEmbed: boolean;
  title?: string;
  color?: number;
  imageUrl?: string;
}

export interface MassDmJob {
  id: string;
  guildId: string;
  actorId: string;
  content: DmContent;
  roleId?: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  startedAt: number;
  finishedAt?: number;
  cancelled: boolean;
}

export interface DmResult {
  ok: boolean;
  reason?: 'dm_closed' | 'bot' | 'unknown';
}

/** Intervalle entre deux DMs pour rester sous les limites Discord (~1 DM / 1,2 s). */
const DM_INTERVAL_MS = 1200;

/**
 * Envoi de messages privés par le bot : un membre (`/dm user`) ou tous les membres (`/dm all`).
 * Les envois massifs tournent en arrière-plan, un seul à la fois par serveur, avec progression et annulation.
 */
export class DmService {
  private client: Client | null = null;
  private readonly jobs = new Map<string, MassDmJob>();

  attach(client: Client): void {
    this.client = client;
  }

  buildPayload(content: DmContent, member: GuildMember, guild: Guild) {
    const ctx = { member, guild, user: member.user };
    const text = renderTemplate(content.message, ctx);
    if (!content.asEmbed) return { content: text.slice(0, 2000) };
    const embed = new EmbedBuilder().setColor(content.color ?? BRAND.colors.primary).setDescription(text.slice(0, 4096)).setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined }).setTimestamp();
    if (content.title) embed.setTitle(renderTemplate(content.title, ctx).slice(0, 256));
    if (content.imageUrl) embed.setImage(content.imageUrl);
    return { embeds: [embed] };
  }

  async sendToMember(member: GuildMember, content: DmContent): Promise<DmResult> {
    if (member.user.bot) return { ok: false, reason: 'bot' };
    try {
      await member.send(this.buildPayload(content, member, member.guild));
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 50007) return { ok: false, reason: 'dm_closed' };
      log.warn({ err, userId: member.id }, 'DM impossible');
      return { ok: false, reason: 'unknown' };
    }
  }

  getActiveJob(guildId: string): MassDmJob | undefined {
    const job = this.jobs.get(guildId);
    return job && !job.finishedAt ? job : undefined;
  }

  getLastJob(guildId: string): MassDmJob | undefined {
    return this.jobs.get(guildId);
  }

  cancel(guildId: string): boolean {
    const job = this.getActiveJob(guildId);
    if (!job) return false;
    job.cancelled = true;
    return true;
  }

  /** Liste les membres ciblés (humains, et porteurs du rôle si fourni). */
  async resolveTargets(guild: Guild, roleId?: string): Promise<GuildMember[]> {
    const members = await guild.members.fetch();
    return [...members.values()].filter((m) => !m.user.bot && (!roleId || m.roles.cache.has(roleId)));
  }

  /**
   * Lance un envoi massif en arrière-plan. Retourne le job immédiatement.
   * `onProgress` est appelé toutes les 10 envois et à la fin.
   */
  startMassDm(guild: Guild, actor: User, content: DmContent, targets: GuildMember[], roleId?: string, onProgress?: (job: MassDmJob) => Promise<void> | void): MassDmJob {
    if (this.getActiveJob(guild.id)) throw new Error('mass_dm_running');
    const job: MassDmJob = { id: `${guild.id}-${Date.now()}`, guildId: guild.id, actorId: actor.id, content, roleId, total: targets.length, sent: 0, failed: 0, skipped: 0, startedAt: Date.now(), cancelled: false };
    this.jobs.set(guild.id, job);
    void this.run(guild, targets, job, onProgress);
    return job;
  }

  private async run(guild: Guild, targets: GuildMember[], job: MassDmJob, onProgress?: (job: MassDmJob) => Promise<void> | void): Promise<void> {
    for (const member of targets) {
      if (job.cancelled) break;
      const result = await this.sendToMember(member, job.content);
      if (result.ok) job.sent++;
      else if (result.reason === 'dm_closed') job.skipped++;
      else job.failed++;
      if ((job.sent + job.failed + job.skipped) % 10 === 0) await Promise.resolve(onProgress?.(job)).catch(() => null);
      await sleep(DM_INTERVAL_MS);
    }
    job.finishedAt = Date.now();
    await Promise.resolve(onProgress?.(job)).catch(() => null);
    await loggingService.log({
      guildId: guild.id,
      category: 'MESSAGE',
      action: job.cancelled ? 'dm.mass_cancelled' : 'dm.mass_sent',
      title: job.cancelled ? '✉️ Envoi massif annulé' : '✉️ Envoi massif terminé',
      description: job.content.message.slice(0, 1000),
      fields: [
        { name: 'Envoyés', value: String(job.sent), inline: true },
        { name: 'DM fermés', value: String(job.skipped), inline: true },
        { name: 'Échecs', value: String(job.failed), inline: true },
        { name: 'Cible', value: job.roleId ? `<@&${job.roleId}>` : 'Tous les membres', inline: true },
      ],
      actorId: job.actorId,
    });
  }

  get attached(): boolean {
    return this.client !== null;
  }
}

export const dmService = new DmService();
