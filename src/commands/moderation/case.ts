import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { EPHEMERAL, MOD_PERMS, replyError } from './_shared';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Afficher une sanction par son numéro')
    .addIntegerOption((o) => o.setName('number').setDescription('Numéro de case').setRequired(true).setMinValue(1)),
  module: 'moderation',
  permissions: MOD_PERMS.view,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const number = interaction.options.getInteger('number', true);
    const sanction = await moderationService.getCase(interaction.guild.id, number);
    if (!sanction) return replyError(interaction, ctx, 'moderation.case_not_found', { number });
    const embed = moderationService.buildSanctionEmbed(ctx.t, ctx.lang, sanction);
    if (sanction.userId) {
      const user = await interaction.client.users.fetch(sanction.userId).catch(() => null);
      if (user) embed.setThumbnail(user.displayAvatarURL({ size: 128 })).setAuthor({ name: user.tag });
    }
    await interaction.reply({ embeds: [embed], ...EPHEMERAL });
  },
});
