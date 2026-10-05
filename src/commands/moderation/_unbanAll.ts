import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type Client } from 'discord.js';
import type { InteractionContext } from '../../structures/types';
import { BRAND } from '../../config/constants';
import { embedService } from '../../services/EmbedService';
import { MASS_UNBAN_DELAY_MS, UNBAN_ALL_CONFIRMATION, massUnbanService, progressBar, type MassUnbanJob } from '../../services/MassUnbanService';
import { buildCustomId } from '../../utils/customId';
import { TTLCache } from '../../utils/cache';
import { formatDuration } from '../../utils/time';
import { childLogger } from '../../utils/logger';

/**
 * Interface Discord de `/unban-all` (namespace `unbanall`, boutons + modal, rattachés à la commande `unban-all`) :
 *  - `unbanall:confirm:<1|0>` (bouton) → modal `unbanall:run:<1|0>` où il faut taper `UNBAN ALL` (1 = relayer en jeu)
 *  - `unbanall:abort`   (bouton) → abandonne avant le lancement
 *  - `unbanall:cancel`  (bouton) → arrête le job en cours
 *  - `unbanall:status`  (bouton) → actualise la progression (et reprend la main sur le message pour les mises à jour)
 */

const log = childLogger('UnbanAll');
type Payload = { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] };

export const UNBANALL = 'unbanall';
export const uid = (...parts: string[]): string => buildCustomId(UNBANALL, ...parts);

/** Raison et relais en jeu en attente de confirmation (clé `${guildId}:${userId}`) : une raison ne tient pas dans un customId. */
export const pendingUnbanAll = new TTLCache<{ reason: string | null; syncGame: boolean }>(15 * 60_000, 1000);
export const pendingUnbanAllKey = (guildId: string, userId: string): string => `${guildId}:${userId}`;

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

export function renderUnbanAllConfirm({ t, lang }: Pick<InteractionContext, 't' | 'lang'>, opts: { count: number; reason: string | null; syncGame: boolean }): Payload {
  const embed = embedService.warning(
    t('moderation.unban_all.confirm_description', {
      count: opts.count,
      duration: formatDuration(seconds(opts.count * MASS_UNBAN_DELAY_MS), lang),
      reason: opts.reason ?? t('core.no_reason'),
      game: t(opts.syncGame ? 'moderation.unban_all.game_on' : 'moderation.unban_all.game_off'),
    }),
    t('moderation.unban_all.confirm_title'),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(uid('confirm', opts.syncGame ? '1' : '0')).setLabel(t('moderation.unban_all.btn_confirm')).setStyle(ButtonStyle.Danger).setEmoji('🔓'),
    new ButtonBuilder().setCustomId(uid('abort')).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export function buildUnbanAllModal(t: InteractionContext['t'], syncGame: boolean): ModalBuilder {
  const input = new TextInputBuilder().setCustomId('confirm').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setPlaceholder(UNBAN_ALL_CONFIRMATION);
  return new ModalBuilder()
    .setCustomId(uid('run', syncGame ? '1' : '0'))
    .setTitle(t('moderation.unban_all.modal_title').slice(0, 45))
    .addLabelComponents(new LabelBuilder().setLabel(t('moderation.unban_all.modal_label').slice(0, 45)).setDescription(t('moderation.unban_all.modal_help').slice(0, 100)).setTextInputComponent(input));
}

/** Progression (job en cours) ou rapport final (job terminé). */
export function renderUnbanAllStatus({ t, lang }: Pick<InteractionContext, 't' | 'lang'>, job: MassUnbanJob, opts: { cancelling?: boolean } = {}): Payload {
  const processed = job.done + job.failed;
  if (job.finishedAt) {
    if (!job.total) return { embeds: [embedService.info(t('moderation.unban_all.none'))], components: [] };
    const lines = [
      t('moderation.unban_all.report_description', { done: job.done, failed: job.failed, total: job.total, duration: formatDuration(seconds(job.finishedAt.getTime() - job.startedAt.getTime()), lang) }),
    ];
    if (job.cancelled && job.total > processed) lines.push(t('moderation.unban_all.report_remaining', { count: job.total - processed }));
    if (job.done > 0) lines.push(t('moderation.unban_all.report_case'));
    const embed = new EmbedBuilder()
      .setColor(job.cancelled || job.failed ? BRAND.colors.warning : BRAND.colors.primary)
      .setTitle(t(job.cancelled ? 'moderation.unban_all.report_title_cancelled' : 'moderation.unban_all.report_title'))
      .setDescription(lines.join('\n'))
      .setFooter({ text: BRAND.footer })
      .setTimestamp(job.finishedAt);
    return { embeds: [embed], components: [] };
  }
  const description = job.total
    ? t('moderation.unban_all.progress_description', {
        bar: progressBar(processed, job.total),
        processed,
        total: job.total,
        done: job.done,
        failed: job.failed,
        remaining: formatDuration(seconds((job.total - processed) * MASS_UNBAN_DELAY_MS), lang),
      })
    : t('moderation.unban_all.listing');
  const embed = new EmbedBuilder()
    .setColor(BRAND.colors.warning)
    .setTitle(t('moderation.unban_all.progress_title'))
    .setDescription(opts.cancelling || job.cancelled ? `${description}\n\n${t('moderation.unban_all.cancelling')}` : description)
    .setFooter({ text: BRAND.footer });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(uid('cancel')).setLabel(t('moderation.unban_all.btn_cancel')).setStyle(ButtonStyle.Danger).setEmoji('⏹️').setDisabled(Boolean(opts.cancelling || job.cancelled)),
    new ButtonBuilder().setCustomId(uid('status')).setLabel(t('moderation.unban_all.btn_refresh')).setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );
  return { embeds: [embed], components: [row] };
}

// ───── Messages à tenir à jour pendant le job ─────

type Editor = (payload: Payload) => Promise<unknown>;
/** Réponses éphémères suivies par serveur (clé = id d'interaction) ; un jeton d'interaction expire après 15 min. */
const editors = new Map<string, Map<string, Editor>>();
const MAX_EDITORS = 5;

/** Suit un message éphémère : il sera mis à jour à chaque progression du job du serveur. */
export function watchUnbanAll(guildId: string, id: string, edit: Editor): void {
  const map = editors.get(guildId) ?? new Map<string, Editor>();
  map.set(id, edit);
  while (map.size > MAX_EDITORS) map.delete(map.keys().next().value!);
  editors.set(guildId, map);
}

/**
 * Callback `onProgress` du job : met à jour les messages suivis. À la fin, si aucun message n'a pu être mis à jour
 * (jetons expirés), le rapport est envoyé en DM à l'auteur.
 */
export function unbanAllProgress(client: Client, ctx: Pick<InteractionContext, 't' | 'lang'>, guildName: string): (job: MassUnbanJob) => void {
  return (job) => {
    void (async () => {
      const map = editors.get(job.guildId);
      const payload = renderUnbanAllStatus(ctx, job);
      let delivered = 0;
      for (const [id, edit] of map ?? []) {
        const ok = await edit(payload).then(() => true).catch(() => false);
        if (ok) delivered++;
        else map!.delete(id);
      }
      if (!job.finishedAt) return;
      editors.delete(job.guildId);
      if (delivered || !job.total) return;
      const user = await client.users.fetch(job.actorId).catch(() => null);
      const embed = payload.embeds[0]!.setAuthor({ name: ctx.t('moderation.unban_all.dm_title', { server: guildName }).slice(0, 256) });
      const sent = await user?.send({ embeds: [embed] }).then(() => true).catch(() => false);
      if (!sent) log.warn({ guild: job.guildId, user: job.actorId }, 'Rapport /unban-all non délivré (jetons expirés, DM fermés)');
    })();
  };
}

/** Job en cours sur le serveur (null si aucun ou terminé). */
export function runningUnbanAll(guildId: string): MassUnbanJob | null {
  const job = massUnbanService.status(guildId);
  return job && !job.finishedAt ? job : null;
}
