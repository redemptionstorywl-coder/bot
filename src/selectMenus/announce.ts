import { MessageFlags, type AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService } from '../services/EmbedService';
import { embedBuilderSessions, renderBuilder, renderContextFromInteraction, type BuilderSession } from '../services/EmbedBuilderSession';
import { buildTranslationModal } from '../modals/announce';

async function refresh(interaction: AnySelectMenuInteraction, session: BuilderSession, ctx: InteractionContext): Promise<void> {
  embedBuilderSessions.save(session);
  const payload = renderBuilder(session, renderContextFromInteraction(interaction, ctx));
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

/**
 * Menus des annonces : `announce:<action>:<sessionId>`
 *  - langs : langues cibles (multi)
 *  - trsel : langue à traduire → modal
 *  - roles : rôles à mentionner (RoleSelect)
 *  - chan  : salon de publication (ChannelSelect)
 */
export default defineSelectMenu({
  id: 'announce',
  module: 'announcements',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t, config } = ctx;
    if (!interaction.guildId || !config) return;
    const [action = '', sid = ''] = args;
    const session = embedBuilderSessions.get(interaction.guildId, interaction.user.id, sid);
    if (!session?.announcement) {
      await interaction.reply({ embeds: [embedService.warning(t('embeds.errors.session_expired'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const ann = session.announcement;

    switch (action) {
      case 'langs': {
        if (!interaction.isStringSelectMenu()) return;
        const values = interaction.values.filter((v) => config.enabledLanguages.includes(v));
        const all = config.enabledLanguages.every((l) => values.includes(l));
        ann.targetLanguages = all ? '*' : values;
        session.view = 'main';
        await refresh(interaction, session, ctx);
        return;
      }
      case 'trsel': {
        if (!interaction.isStringSelectMenu()) return;
        const lang = interaction.values[0];
        if (!lang || !config.enabledLanguages.includes(lang)) {
          session.notice = { type: 'error', text: t('core.invalid_input', { details: lang ?? '' }) };
          await refresh(interaction, session, ctx);
          return;
        }
        await interaction.showModal(buildTranslationModal(session, lang, t));
        return;
      }
      case 'roles': {
        if (!interaction.isRoleSelectMenu()) return;
        ann.mentionRoleIds = [...interaction.roles.keys()].slice(0, 10);
        await refresh(interaction, session, ctx);
        return;
      }
      case 'chan': {
        if (!interaction.isChannelSelectMenu()) return;
        ann.channelId = interaction.values[0];
        session.view = 'main';
        await refresh(interaction, session, ctx);
        return;
      }
      default:
        await refresh(interaction, session, ctx);
    }
  },
});
