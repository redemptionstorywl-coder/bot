import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { AnnouncementStatus } from '@prisma/client';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService } from '../services/EmbedService';
import { AnnouncementError, announcementService, type AnnouncementInput } from '../services/AnnouncementService';
import { embedBuilderSessions, isEmbedEmpty, parentView, renderBuilder, renderContextFromInteraction, type BuilderSession } from '../services/EmbedBuilderSession';
import { buildDateModal } from '../modals/announce';
import { discordTimestamp } from '../utils/time';

async function refresh(interaction: ButtonInteraction, session: BuilderSession, ctx: InteractionContext): Promise<void> {
  embedBuilderSessions.save(session);
  const payload = renderBuilder(session, renderContextFromInteraction(interaction, ctx));
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

function errorText(err: unknown, t: InteractionContext['t']): string {
  return err instanceof AnnouncementError ? t(`announcements.errors.${err.code}`, { details: err.details ?? '' }) : t('core.error');
}

/** Données persistables depuis la session. */
export function draftInput(session: BuilderSession, t: InteractionContext['t']): AnnouncementInput {
  const ann = session.announcement!;
  return {
    title: ann.title ?? session.spec.title ?? t('announcements.untitled'),
    content: session.content ?? null,
    spec: session.spec,
    channelId: ann.channelId ?? null,
    mentionRoleIds: ann.mentionRoleIds,
    mentionEveryone: ann.mentionEveryone,
    buttons: session.buttons,
  };
}

/** Crée ou met à jour l'annonce en base depuis la session (sans toucher aux messages publiés). */
export async function persistDraft(session: BuilderSession, ctx: InteractionContext, actorId: string): Promise<number> {
  const ann = session.announcement!;
  const input = draftInput(session, ctx.t);
  if (ann.id) {
    await announcementService.update(ann.id, input, { actorId, sync: false });
    return ann.id;
  }
  const created = await announcementService.create(session.guildId, input, actorId);
  ann.id = created.id;
  ann.status = created.status;
  return created.id;
}

/**
 * Boutons des annonces :
 *  - `announce:<action>:<sessionId>` : étapes de l'éditeur
 *  - `announce:del:<id>:<userId>` / `announce:delcancel:<id>:<userId>` : confirmation de suppression
 */
export default defineButton({
  id: 'announce',
  module: 'announcements',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t, config } = ctx;
    if (!interaction.guildId || !config) return;
    const [action = '', arg1 = '', arg2 = ''] = args;

    // ── Confirmation de suppression (hors session) ──
    if (action === 'del' || action === 'delcancel') {
      if (arg2 !== interaction.user.id) {
        await interaction.reply({ embeds: [embedService.error(t('announcements.errors.not_your_confirmation'))], flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'delcancel') {
        await interaction.update({ embeds: [embedService.info(t('announcements.cmd.delete_cancelled'))], components: [] });
        return;
      }
      await interaction.deferUpdate();
      try {
        const id = Number(arg1);
        const ann = await announcementService.get(id);
        if (!ann || ann.guildId !== interaction.guildId) throw new AnnouncementError('not_found', arg1);
        await announcementService.delete(id, interaction.user.id);
        await interaction.editReply({ embeds: [embedService.success(t('announcements.cmd.deleted', { id }))], components: [] });
      } catch (err) {
        await interaction.editReply({ embeds: [embedService.error(errorText(err, t))], components: [] });
      }
      return;
    }

    // ── Actions de session ──
    const session = embedBuilderSessions.get(interaction.guildId, interaction.user.id, arg1);
    if (!session?.announcement) {
      await interaction.reply({ embeds: [embedService.warning(t('embeds.errors.session_expired'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const ann = session.announcement;

    switch (action) {
      case 'embed':
      case 'mentions':
      case 'channel':
        session.view = action;
        await refresh(interaction, session, ctx);
        return;
      case 'back':
        session.view = parentView(session);
        await refresh(interaction, session, ctx);
        return;
      case 'everyone':
        ann.mentionEveryone = !ann.mentionEveryone;
        await refresh(interaction, session, ctx);
        return;
      case 'date':
        await interaction.showModal(buildDateModal(session, t));
        return;
      case 'cancel':
        embedBuilderSessions.delete(session);
        await interaction.update({ embeds: [embedService.info(ann.id ? t('announcements.builder.cancelled_saved', { id: ann.id }) : t('announcements.builder.cancelled'))], components: [] });
        return;
      case 'draft': {
        await interaction.deferUpdate();
        try {
          const id = await persistDraft(session, ctx, interaction.user.id);
          session.notice = { type: 'success', text: t('announcements.builder.draft_saved', { id }) };
        } catch (err) {
          session.notice = { type: 'error', text: errorText(err, t) };
        }
        await refresh(interaction, session, ctx);
        return;
      }
      case 'publish': {
        if (isEmbedEmpty(session.spec) && !session.content) {
          session.notice = { type: 'error', text: t('embeds.errors.empty_embed') };
          await refresh(interaction, session, ctx);
          return;
        }
        if (!ann.channelId) {
          session.notice = { type: 'error', text: t('announcements.errors.no_channel') };
          session.view = 'channel';
          await refresh(interaction, session, ctx);
          return;
        }
        await interaction.deferUpdate();
        try {
          const id = await persistDraft(session, ctx, interaction.user.id);
          if (ann.status === AnnouncementStatus.PUBLISHED) {
            const current = await announcementService.get(id);
            if (current) await announcementService.syncMessages(current, interaction.user.id);
            session.notice = { type: 'success', text: t('announcements.builder.messages_updated', { id, count: current?.messages.length ?? 0 }) };
          } else {
            const published = await announcementService.publish(id, { actorId: interaction.user.id });
            ann.status = published.status;
            ann.scheduledAt = undefined;
            const links = published.messages.map((m) => `https://discord.com/channels/${session.guildId}/${m.channelId}/${m.messageId}`).join('\n');
            session.notice = { type: 'success', text: t('announcements.builder.published', { id, links }) };
          }
        } catch (err) {
          session.notice = { type: 'error', text: errorText(err, t) };
        }
        await refresh(interaction, session, ctx);
        return;
      }
      case 'schedule': {
        if (!ann.scheduledAt) {
          await interaction.showModal(buildDateModal(session, t));
          return;
        }
        if (!ann.channelId) {
          session.notice = { type: 'error', text: t('announcements.errors.no_channel') };
          session.view = 'channel';
          await refresh(interaction, session, ctx);
          return;
        }
        await interaction.deferUpdate();
        try {
          const id = await persistDraft(session, ctx, interaction.user.id);
          const schedule = await announcementService.schedule(id, ann.scheduledAt, interaction.user.id);
          ann.status = AnnouncementStatus.SCHEDULED;
          session.notice = { type: 'success', text: t('announcements.builder.scheduled', { id, date: discordTimestamp(schedule.scheduledAt, 'F'), relative: discordTimestamp(schedule.scheduledAt, 'R') }) };
        } catch (err) {
          session.notice = { type: 'error', text: errorText(err, t) };
        }
        await refresh(interaction, session, ctx);
        return;
      }
      default:
        await refresh(interaction, session, ctx);
    }
  },
});
