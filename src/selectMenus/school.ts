import { MessageFlags } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { schoolService, SchoolError } from '../services/SchoolService';
import { embedService } from '../services/EmbedService';

/** Menus `school:class` / `school:house` affichés après l'inscription : l'utilisateur choisit sa classe / maison. */
export default defineSelectMenu({
  id: 'school',
  module: 'school',
  async execute(interaction, args, { t }) {
    if (!interaction.guildId || !interaction.isStringSelectMenu()) return;
    const [kind] = args;
    const id = Number(interaction.values[0]);
    if (!Number.isInteger(id)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (kind === 'class') {
        const p = await schoolService.assignClass(interaction.guildId, interaction.user.id, id, interaction.user.id);
        await interaction.editReply({ embeds: [embedService.success(t('school.register.class_set', { name: p.class?.name ?? '—' }))] });
      } else if (kind === 'house') {
        const p = await schoolService.assignHouse(interaction.guildId, interaction.user.id, id, interaction.user.id);
        await interaction.editReply({ embeds: [embedService.success(t('school.register.house_set', { name: p.house?.name ?? '—' }))] });
      }
    } catch (err) {
      if (err instanceof SchoolError) return interaction.editReply({ embeds: [embedService.error(t(`school.errors.${err.code}`))] });
      throw err;
    }
  },
});
