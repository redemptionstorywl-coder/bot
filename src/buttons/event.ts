import { MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { eventService } from '../services/EventService';
import { embedService } from '../services/EmbedService';
import { paginate } from '../utils/pagination';
import { buildParticipantsPages } from '../commands/events/event';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/**
 * Boutons `event:<action>:<id>[:<userId>]`
 *  - join / leave / list : sur le message public de l'événement
 *  - cancel_confirm / cancel_abort : confirmation éphémère de /event cancel
 */
export default defineButton({
  id: 'event',
  module: 'events',
  cooldown: 1,
  async execute(interaction, args, { t, config }) {
    const [action, rawId, ownerId] = args;
    const id = Number(rawId);
    if (!Number.isInteger(id) || !interaction.guildId || !config) return;

    switch (action) {
      case 'join': {
        await interaction.deferReply(EPHEMERAL);
        const event = await eventService.get(id);
        if (!event || event.guildId !== interaction.guildId) {
          await interaction.editReply({ embeds: [embedService.error(t('events.not_found', { id }))] });
          return;
        }
        const result = await eventService.join(id, interaction.user.id);
        if (result.ok) await interaction.editReply({ embeds: [embedService.success(t('events.join.success', { name: event.name, count: result.count }))] });
        else if (result.reason === 'not_found') await interaction.editReply({ embeds: [embedService.error(t('events.not_found', { id }))] });
        else await interaction.editReply({ embeds: [embedService.warning(t(`events.join.${result.reason}`))] });
        return;
      }
      case 'leave': {
        await interaction.deferReply(EPHEMERAL);
        const event = await eventService.get(id);
        if (!event || event.guildId !== interaction.guildId) {
          await interaction.editReply({ embeds: [embedService.error(t('events.not_found', { id }))] });
          return;
        }
        const result = await eventService.leave(id, interaction.user.id);
        if (result.ok) await interaction.editReply({ embeds: [embedService.success(t('events.leave.success', { name: event.name }))] });
        else if (result.reason === 'not_found') await interaction.editReply({ embeds: [embedService.error(t('events.not_found', { id }))] });
        else await interaction.editReply({ embeds: [embedService.warning(t(`events.leave.${result.reason}`))] });
        return;
      }
      case 'list': {
        await interaction.deferReply(EPHEMERAL);
        const event = await eventService.get(id);
        if (!event || event.guildId !== interaction.guildId) {
          await interaction.editReply({ embeds: [embedService.error(t('events.not_found', { id }))] });
          return;
        }
        await paginate(interaction, { pages: buildParticipantsPages(event, t), userId: interaction.user.id, ephemeral: true });
        return;
      }
      case 'cancel_confirm':
      case 'cancel_abort': {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ embeds: [embedService.error(t('events.cancel.not_yours'))], ...EPHEMERAL });
          return;
        }
        if (action === 'cancel_abort') {
          await interaction.update({ embeds: [embedService.info(t('events.cancel.aborted'))], components: [] });
          return;
        }
        await interaction.deferUpdate();
        const event = await eventService.get(id);
        if (!event || event.guildId !== interaction.guildId) {
          await interaction.editReply({ embeds: [embedService.error(t('events.not_found', { id }))], components: [] });
          return;
        }
        await eventService.cancel(id, interaction.user.id);
        await interaction.editReply({ embeds: [embedService.success(t('events.cancel.success', { name: event.name }))], components: [] });
        return;
      }
    }
  },
});
