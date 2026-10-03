import { AttachmentBuilder, MessageFlags, type ButtonInteraction } from 'discord.js';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService } from '../services/EmbedService';
import { EmbedTemplateError, embedTemplateService } from '../services/EmbedTemplateService';
import { embedBuilderSessions, isEmbedEmpty, parentView, renderBuilder, renderContextFromInteraction, type BuilderSession } from '../services/EmbedBuilderSession';
import { buildEmbedModal, type EmbedModalKind } from '../modals/embed';

const MODAL_ACTIONS: EmbedModalKind[] = ['title', 'color', 'images', 'footer', 'content', 'template', 'import'];

async function refresh(interaction: ButtonInteraction, session: BuilderSession, ctx: InteractionContext): Promise<void> {
  embedBuilderSessions.save(session);
  const payload = renderBuilder(session, renderContextFromInteraction(interaction, ctx));
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

/**
 * Boutons du créateur d'embeds : `embed:<action>:<sessionId>`.
 * Partagé avec le mode annonce (édition de l'embed d'une annonce).
 */
export default defineButton({
  id: 'embed',
  module: 'embeds',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guildId || !ctx.config) return;
    const [action = '', sid = ''] = args;
    const session = embedBuilderSessions.get(interaction.guildId, interaction.user.id, sid);
    if (!session) {
      await interaction.reply({ embeds: [embedService.warning(t('embeds.errors.session_expired'))], flags: MessageFlags.Ephemeral });
      return;
    }

    if (MODAL_ACTIONS.includes(action as EmbedModalKind)) {
      await interaction.showModal(buildEmbedModal(action as EmbedModalKind, session, t));
      return;
    }

    switch (action) {
      case 'timestamp':
        session.spec.timestamp = !session.spec.timestamp;
        await refresh(interaction, session, ctx);
        return;
      case 'colorview':
        session.view = 'color';
        break;
      case 'colorbrand':
        session.spec = { ...session.spec, color: undefined };
        session.view = parentView(session);
        session.notice = { type: 'success', text: t('embeds.builder.color_reset') };
        break;
      case 'buttons':
        session.view = 'buttons';
        await refresh(interaction, session, ctx);
        return;
      case 'back':
        session.view = parentView(session);
        await refresh(interaction, session, ctx);
        return;
      case 'export': {
        const json = embedTemplateService.exportJson({ content: session.content, embeds: [session.spec], buttons: session.buttons.length ? session.buttons : undefined });
        if (json.length <= 1900) await interaction.reply({ content: `\`\`\`json\n${json}\n\`\`\``, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ content: t('embeds.builder.export_file'), files: [new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: `embed-${session.id}.json` })], flags: MessageFlags.Ephemeral });
        return;
      }
      case 'cancel':
        embedBuilderSessions.delete(session);
        await interaction.update({ embeds: [embedService.info(t('embeds.builder.cancelled'))], components: [] });
        return;
      case 'update': {
        if (!session.target) return;
        if (isEmbedEmpty(session.spec)) {
          session.notice = { type: 'error', text: t('embeds.errors.empty_embed') };
          await refresh(interaction, session, ctx);
          return;
        }
        await interaction.deferUpdate();
        try {
          const message = await embedTemplateService.editMessage(session.target.channelId, session.target.messageId, { content: session.content, embeds: [session.spec], buttons: session.buttons }, {
            client: interaction.client,
            guild: interaction.guild,
            language: ctx.lang,
          });
          session.notice = { type: 'success', text: t('embeds.builder.updated', { url: message.url }) };
        } catch (err) {
          session.notice = { type: 'error', text: err instanceof EmbedTemplateError ? t(`embeds.errors.${err.code}`, { details: err.details ?? '' }) : t('core.error') };
        }
        await refresh(interaction, session, ctx);
        return;
      }
      default:
        await refresh(interaction, session, ctx);
    }
  },
});
