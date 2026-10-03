import { MessageFlags } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { parsePollOptions, pollService } from '../services/PollService';
import { embedService } from '../services/EmbedService';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Select menu `poll:vote:<pollId>` (6–10 options ou multi-sélection). Les valeurs sont les index d'options. */
export default defineSelectMenu({
  id: 'poll',
  module: 'polls',
  cooldown: 1,
  async execute(interaction, args, { t, config }) {
    const [action, rawId] = args;
    const id = Number(rawId);
    if (action !== 'vote' || !Number.isInteger(id) || !interaction.isStringSelectMenu() || !interaction.guildId || !config) return;
    await interaction.deferReply(EPHEMERAL);

    const poll = await pollService.get(id);
    if (!poll || poll.guildId !== interaction.guildId) {
      await interaction.editReply({ embeds: [embedService.error(t('polls.not_found', { id }))] });
      return;
    }
    const indexes = interaction.values.map(Number);
    const result = await pollService.vote(id, interaction.user.id, indexes);
    if (!result.ok) {
      await interaction.editReply({ embeds: [result.reason === 'not_found' ? embedService.error(t('polls.not_found', { id })) : embedService.warning(t(`polls.vote.${result.reason}`))] });
      return;
    }
    if (result.removed || !result.indexes.length) {
      await interaction.editReply({ embeds: [embedService.info(t('polls.vote.removed'))] });
      return;
    }
    const options = parsePollOptions(poll.options);
    const labels = result.indexes.map((i) => `**${options[i]?.label ?? i + 1}**`).join(', ');
    await interaction.editReply({ embeds: [embedService.success(t('polls.vote.recorded', { options: labels }))] });
  },
});
