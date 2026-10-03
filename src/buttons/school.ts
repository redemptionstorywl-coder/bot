import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { defineButton } from '../structures';
import { schoolService, SchoolError } from '../services/SchoolService';
import { embedService } from '../services/EmbedService';
import { buildCustomId } from '../utils/customId';

/** Boutons `school:accept:<id>` / `school:reject:<id>` sur les candidatures (staff). */
export default defineButton({
  id: 'school',
  module: 'school',
  permissions: { internal: 'staff' },
  async execute(interaction, args, { t, lang }) {
    const [action, rawId] = args;
    const id = Number(rawId);
    if (!interaction.guildId || !Number.isInteger(id)) return;

    if (action === 'reject') {
      const modal = new ModalBuilder()
        .setCustomId(buildCustomId('school', 'reject', id))
        .setTitle(t('school.application.reject_modal_title', { id }).slice(0, 45))
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('note').setLabel(t('school.application.note_label').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)));
      await interaction.showModal(modal);
      return;
    }
    if (action === 'accept') {
      await interaction.deferUpdate();
      try {
        const app = await schoolService.reviewApplication({ guildId: interaction.guildId, id, reviewerId: interaction.user.id, decision: 'ACCEPTED' });
        await interaction.editReply({ embeds: [schoolService.buildApplicationEmbed(app, lang)], components: schoolService.buildApplicationButtons(app, lang, true) });
        await interaction.followUp({ embeds: [embedService.success(t('school.application.accepted', { id: app.id, user: `<@${app.userId}>` }))], flags: MessageFlags.Ephemeral });
      } catch (err) {
        if (err instanceof SchoolError) return interaction.followUp({ embeds: [embedService.error(t(`school.errors.${err.code}`))], flags: MessageFlags.Ephemeral });
        throw err;
      }
    }
  },
});
