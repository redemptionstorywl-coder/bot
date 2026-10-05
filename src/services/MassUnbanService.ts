import type { Guild, User } from 'discord.js';
import type { LogCategory, Sanction } from '@prisma/client';
import { prisma } from '../database/client';
import { BRAND } from '../config/constants';
import { loggingService } from './LoggingService';
import { guildConfigService } from './GuildConfigService';
import { ModerationError, auditReason, moderationService } from './ModerationService';
import { fivemSyncService } from './FiveMSyncService';
import { formatDuration } from '../utils/time';
import { childLogger } from '../utils/logger';

const log = childLogger('MassUnban');

/** Débannissement de masse d'un serveur (`/unban-all`, dashboard). */
export interface MassUnbanJob {
  guildId: string;
  /** Membre qui a lancé l'opération */
  actorId: string;
  /** Nombre de bannis au départ (0 tant que la liste n'est pas récupérée) */
  total: number;
  /** Débannis avec succès */
  done: number;
  /** Échecs (permissions, erreur Discord…) */
  failed: number;
  startedAt: Date;
  /** Défini quand l'opération est terminée (normalement, annulée ou en erreur) */
  finishedAt?: Date;
  cancelled: boolean;
}

export interface MassUnbanOptions {
  reason?: string | null;
  /** Relayer chaque débannissement vers les serveurs FiveM (défaut : oui, comme un unban classique) */
  syncGame?: boolean;
  /** Appelé après la récupération de la liste, toutes les 10 entrées traitées, puis à la fin (`finishedAt` défini) */
  onProgress?: (job: MassUnbanJob) => void;
}

/** Pause entre deux débannissements : ~2 par seconde, sous les limites de débit Discord. */
export const MASS_UNBAN_DELAY_MS = 500;
/** Fréquence des rappels de progression (en entrées traitées). */
export const MASS_UNBAN_PROGRESS_EVERY = 10;
/** Phrase à taper dans le modal de confirmation de `/unban-all`. */
export const UNBAN_ALL_CONFIRMATION = 'UNBAN ALL';
const BANS_PAGE_SIZE = 1000;
/** Garde-fou de pagination (1 000 pages = 1 000 000 de bannis). */
const MAX_PAGES = 1000;
/** Code Discord « Unknown Ban » : le membre n'est déjà plus banni. */
const UNKNOWN_BAN = 10026;

/** Confirmation du modal : `UNBAN ALL` exactement (casse comprise ; espaces de bord et multiples tolérés). */
export function isUnbanAllConfirmed(input: string | null | undefined): boolean {
  return typeof input === 'string' && input.trim().replace(/\s+/g, ' ') === UNBAN_ALL_CONFIRMATION;
}

/** Barre de progression texte : `▰▰▰▱▱▱… 45%`. */
export function progressBar(processed: number, total: number, width = 20): string {
  const ratio = total > 0 ? Math.min(1, Math.max(0, processed / total)) : 1;
  const filled = Math.round(ratio * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)} ${Math.floor(ratio * 100)}%`;
}

/** Plus grand snowflake d'une liste (curseur `after` de la pagination des bans). */
function maxSnowflake(ids: readonly string[]): string {
  return ids.reduce((max, id) => (BigInt(id) > BigInt(max) ? id : max));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Débannissement de masse : un seul job à la fois par serveur, débannissement séquentiel (~2/s),
 * annulable, Ban.active=false, UNE case UNBAN récapitulative ({ massUnban: true, count }), logs SECURITY + MODERATION.
 * Chaque unban est marqué (moderationService.markRecent) pour que guildBanRemove.logs ne crée pas une case par membre,
 * et (fivemSyncService.markBulk) pour ne pas le relayer en jeu (`syncGame: false`) ou le relayer sans log par membre.
 */
export class MassUnbanService {
  private readonly jobs = new Map<string, MassUnbanJob>();
  private readonly running = new Set<string>();
  private readonly delayMs: number;
  private readonly progressEvery: number;

  constructor(opts: { delayMs?: number; progressEvery?: number } = {}) {
    this.delayMs = opts.delayMs ?? MASS_UNBAN_DELAY_MS;
    this.progressEvery = Math.max(1, opts.progressEvery ?? MASS_UNBAN_PROGRESS_EVERY);
  }

  /** IDs de tous les membres bannis (pagination par 1000, curseur `after`). */
  private async bannedIds(guild: Guild): Promise<string[]> {
    const ids: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await guild.bans.fetch({ limit: BANS_PAGE_SIZE, after, cache: false });
      const keys = [...batch.keys()];
      ids.push(...keys);
      if (keys.length < BANS_PAGE_SIZE) break;
      const next = maxSnowflake(keys);
      if (next === after) break;
      after = next;
    }
    return [...new Set(ids)];
  }

  /** Nombre de membres bannis du serveur. */
  async count(guild: Guild): Promise<number> {
    return (await this.bannedIds(guild)).length;
  }

  /**
   * Lance le débannissement de tous les membres bannis en arrière-plan et rend le job (copie).
   * Lève `ModerationError('moderation.unban_all.already_running')` si un job tourne déjà sur ce serveur.
   */
  start(guild: Guild, actor: User, opts: MassUnbanOptions = {}): MassUnbanJob {
    if (this.running.has(guild.id)) throw new ModerationError('moderation.unban_all.already_running');
    const job: MassUnbanJob = { guildId: guild.id, actorId: actor.id, total: 0, done: 0, failed: 0, startedAt: new Date(), cancelled: false };
    this.running.add(guild.id);
    this.jobs.set(guild.id, job);
    void this.run(guild, actor, job, opts);
    return { ...job };
  }

  /** Dernier job du serveur (en cours ou terminé), null si aucun depuis le démarrage. */
  status(guildId: string): MassUnbanJob | null {
    const job = this.jobs.get(guildId);
    return job ? { ...job } : null;
  }

  /** Demande l'arrêt du job en cours (effectif après le membre en cours). false si aucun job ne tourne. */
  cancel(guildId: string): boolean {
    const job = this.jobs.get(guildId);
    if (!job || !this.running.has(guildId)) return false;
    job.cancelled = true;
    return true;
  }

  private async run(guild: Guild, actor: User, job: MassUnbanJob, opts: MassUnbanOptions): Promise<void> {
    const syncGame = opts.syncGame ?? true;
    const reason = opts.reason?.trim() ? opts.reason.trim().slice(0, 512) : null;
    const notify = () => {
      try {
        opts.onProgress?.({ ...job });
      } catch (err) {
        log.warn({ err, guild: guild.id }, 'Rappel de progression en erreur');
      }
    };
    let pending: string[] = [];
    const flush = async () => {
      const ids = pending;
      pending = [];
      if (ids.length) await prisma.ban.updateMany({ where: { guildId: guild.id, userId: { in: ids }, active: true }, data: { active: false } }).catch((err) => log.warn({ err, guild: guild.id }, 'Ban.active non mis à jour'));
    };
    try {
      const ids = await this.bannedIds(guild);
      job.total = ids.length;
      notify();
      if (ids.length) await this.logStart(guild, actor, ids.length, syncGame);
      const audit = auditReason(actor, reason ?? 'unban-all');
      for (const [index, userId] of ids.entries()) {
        if (job.cancelled) break;
        if (index > 0 && this.delayMs > 0) await sleep(this.delayMs);
        if (job.cancelled) break;
        // Anti-doublons : pas de case / log par membre (guildBanRemove.logs), relais en jeu selon `syncGame` (guildBanRemove.fivem).
        moderationService.markRecent(guild.id, 'unban', userId);
        fivemSyncService.markBulk('unban', guild.id, userId, syncGame ? 'quiet' : 'skip');
        try {
          await guild.bans.remove(userId, audit);
          job.done++;
          pending.push(userId);
        } catch (err) {
          moderationService.consumeRecent(guild.id, 'unban', userId);
          if ((err as { code?: number }).code === UNKNOWN_BAN) {
            job.done++; // déjà plus banni
            pending.push(userId);
          } else {
            job.failed++;
            log.debug({ err, guild: guild.id, user: userId }, 'Débannissement impossible');
          }
        }
        if ((job.done + job.failed) % this.progressEvery === 0) {
          await flush();
          notify();
        }
      }
    } catch (err) {
      log.error({ err, guild: guild.id }, 'Débannissement de masse interrompu');
    } finally {
      await flush();
      job.finishedAt = new Date();
      await this.finish(guild, actor, job, reason, syncGame).catch((err) => log.error({ err, guild: guild.id }, 'Rapport de débannissement de masse impossible'));
      this.running.delete(guild.id);
      notify();
    }
  }

  /** Case récapitulative unique + logs SECURITY / MODERATION. */
  private async finish(guild: Guild, actor: User, job: MassUnbanJob, reason: string | null, syncGame: boolean): Promise<void> {
    if (!job.total) return;
    const durationMs = job.finishedAt!.getTime() - job.startedAt.getTime();
    let sanction: Sanction | null = null;
    if (job.done > 0) {
      sanction = await moderationService.createSanction({
        guildId: guild.id,
        type: 'UNBAN',
        userId: null,
        moderatorId: actor.id,
        reason,
        metadata: { massUnban: true, count: job.done, failed: job.failed, total: job.total, cancelled: job.cancelled, syncGame, durationMs },
      });
    }
    const { t, lang } = await moderationService.guildTranslator(guild.id);
    const moderator = `<@${actor.id}>`;
    const fields = [
      { name: t('moderation.unban_all.report_done'), value: String(job.done), inline: true },
      { name: t('moderation.unban_all.report_failed'), value: String(job.failed), inline: true },
      { name: t('moderation.unban_all.report_total'), value: String(job.total), inline: true },
      { name: t('moderation.unban_all.report_duration'), value: formatDuration(Math.max(1, Math.round(durationMs / 1000)), lang), inline: true },
      { name: t('moderation.unban_all.report_game'), value: t(syncGame ? 'core.yes' : 'core.no'), inline: true },
      { name: t('core.reason'), value: reason ?? t('core.no_reason'), inline: false },
    ];
    for (const category of await this.logCategories(guild.id)) {
      await loggingService.log({
        guildId: guild.id,
        category,
        action: 'mod.unban_all',
        title: sanction ? t('moderation.unban_all.log_title', { number: sanction.caseNumber }) : t('moderation.unban_all.log_title_nocase'),
        description: t(job.cancelled ? 'moderation.unban_all.log_cancelled' : 'moderation.unban_all.log_description', { moderator, done: job.done }),
        fields,
        actorId: actor.id,
        color: BRAND.colors.warning,
        data: { caseNumber: sanction?.caseNumber ?? null, type: 'UNBAN', metadata: sanction?.metadata ?? { massUnban: true, count: job.done } },
      });
    }
  }

  private async logStart(guild: Guild, actor: User, count: number, syncGame: boolean): Promise<void> {
    const { t } = await moderationService.guildTranslator(guild.id);
    await loggingService.log({
      guildId: guild.id,
      category: 'SECURITY',
      action: 'mod.unban_all.start',
      title: t('moderation.unban_all.log_start_title'),
      description: t('moderation.unban_all.log_start_description', { moderator: `<@${actor.id}>`, count, game: t(syncGame ? 'moderation.unban_all.game_on' : 'moderation.unban_all.game_off') }),
      actorId: actor.id,
      color: BRAND.colors.warning,
      data: { count, syncGame },
    });
  }

  /** SECURITY + MODERATION ; une seule entrée si les deux catégories aboutissent au même salon de logs. */
  private async logCategories(guildId: string): Promise<LogCategory[]> {
    const cfg = await guildConfigService.get(guildId).catch(() => null);
    const security = cfg?.logChannels.SECURITY ?? cfg?.logChannels.SYSTEM ?? null;
    const moderation = cfg?.logChannels.MODERATION ?? cfg?.logChannels.SYSTEM ?? null;
    return security && security === moderation ? ['SECURITY'] : ['SECURITY', 'MODERATION'];
  }
}

export const massUnbanService = new MassUnbanService();
