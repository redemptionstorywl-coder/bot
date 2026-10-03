import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { defineButton } from '../structures';
import { whitelistService, WhitelistError } from '../services/WhitelistService';
import { embedService } from '../services/EmbedService';
import { buildCustomId } from '../utils/customId';

/** Boutons `whitelist:accept:<id>` / `whitelist:reject:<id>` du salon de review (staff). */
export default defineButton({
  id: 'whitelist',
  module: 'whitelist',
  permissions: { internal: 'staff' },
  async execute(interaction, args, { t, lang }) {
    const [action, rawId] = args;
    const id = Number(rawId);
    if (!interaction.guildId || !Number.isInteger(id)) return;

    if (action === 'reject') {
      const modal = new ModalBuilder()
        .setCustomId(buildCustomId('whitelist', 'reject', id))
        .setTitle(t('whitelist.review.reject_modal_title', { id }).slice(0, 45))
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('note').setLabel(t('whitelist.review.note_label').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)));
      await interaction.showModal(modal);
      return;
    }

    if (action === 'accept') {
      await interaction.deferUpdate();
      try {
        const row = await whitelistService.review({ guildId: interaction.guildId, id, reviewerId: interaction.user.id, decision: 'ACCEPTED' });
        await interaction.editReply({ embeds: [whitelistService.buildReviewEmbed(row, lang)], components: whitelistService.buildReviewButtons(row, lang, true) });
        await interaction.followUp({ embeds: [embedService.success(t('whitelist.review.accepted', { id: row.id, user: `<@${row.userId}>` }))], flags: MessageFlags.Ephemeral });
      } catch (err) {
        if (err instanceof WhitelistError) {
          await interaction.followUp({ embeds: [embedService.error(t(`whitelist.errors.${err.code}`))], flags: MessageFlags.Ephemeral });
          return;
        }
        throw err;
      }
    }
  },
});
