import { MessageFlags, type AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService, type ButtonSpec } from '../services/EmbedService';
import { EmbedTemplateError, embedTemplateService } from '../services/EmbedTemplateService';
import { embedBuilderSessions, isEmbedEmpty, renderBuilder, renderContextFromInteraction, MAX_BUTTONS, type BuilderSession } from '../services/EmbedBuilderSession';
import { buildEmbedModal } from '../modals/embed';
import { buildCustomId } from '../utils/customId';

async function refresh(interaction: AnySelectMenuInteraction, session: BuilderSession, ctx: InteractionContext): Promise<void> {
  embedBuilderSessions.save(session);
  const payload = renderBuilder(session, renderContextFromInteraction(interaction, ctx));
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

/**
 * Menus du créateur d'embeds : `embed:<action>:<sessionId>`
 *  - fields  : ajouter / supprimer / vider les champs
 *  - send    : salon de destination (ChannelSelect)
 *  - btnmenu : ajouter un bouton lien / supprimer / vider
 *  - btnrole : ajouter des boutons rôle `rolemenu:toggle:<roleId>` (RoleSelect)
 */
export default defineSelectMenu({
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

    switch (action) {
      case 'fields': {
        if (!interaction.isStringSelectMenu()) return;
        const value = interaction.values[0] ?? '';
        if (value === 'add') {
          await interaction.showModal(buildEmbedModal('field', session, t));
          return;
        }
        if (value === 'clear') session.spec.fields = undefined;
        else if (value.startsWith('rm:')) {
          const index = Number(value.slice(3));
          const fields = [...(session.spec.fields ?? [])];
          if (Number.isInteger(index) && index >= 0 && index < fields.length) fields.splice(index, 1);
          session.spec.fields = fields.length ? fields : undefined;
        }
        await refresh(interaction, session, ctx);
        return;
      }
      case 'btnmenu': {
        if (!interaction.isStringSelectMenu()) return;
        const value = interaction.values[0] ?? '';
        if (value === 'link') {
          await interaction.showModal(buildEmbedModal('link', session, t));
          return;
        }
        if (value === 'clear') session.buttons = [];
        else if (value.startsWith('rm:')) {
          const index = Number(value.slice(3));
          if (Number.isInteger(index) && index >= 0 && index < session.buttons.length) session.buttons.splice(index, 1);
        }
        await refresh(interaction, session, ctx);
        return;
      }
      case 'btnrole': {
        if (!interaction.isRoleSelectMenu()) return;
        let added = 0;
        for (const role of interaction.roles.values()) {
          if (session.buttons.length >= MAX_BUTTONS) break;
          const customId = buildCustomId('rolemenu', 'toggle', role.id);
          if (session.buttons.some((b) => b.customId === customId)) continue;
          const btn: ButtonSpec = { label: role.name.slice(0, 80), style: 'secondary', customId };
          session.buttons.push(btn);
          added++;
        }
        session.notice = added ? { type: 'success', text: t('embeds.builder.role_buttons_added', { count: added }) } : { type: 'error', text: t('embeds.errors.buttons_limit', { max: MAX_BUTTONS }) };
        await refresh(interaction, session, ctx);
        return;
      }
      case 'send': {
        if (!interaction.isChannelSelectMenu()) return;
        const channelId = interaction.values[0];
        if (!channelId) return;
        if (isEmbedEmpty(session.spec) && !session.content) {
          session.notice = { type: 'error', text: t('embeds.errors.empty_embed') };
          await refresh(interaction, session, ctx);
          return;
        }
        await interaction.deferUpdate();
        try {
          const message = await embedTemplateService.sendSpec(
            interaction.guildId,
            channelId,
            { content: session.content, embeds: isEmbedEmpty(session.spec) ? [] : [session.spec], buttons: session.buttons },
            { client: interaction.client, guild: interaction.guild, language: ctx.lang },
          );
          session.notice = { type: 'success', text: t('embeds.builder.sent', { channel: `<#${channelId}>`, url: message.url }) };
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
