import { GuildMember, MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { giveawayService } from '../services/GiveawayService';
import { embedService } from '../services/EmbedService';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Bouton `giveaway:enter:<id>` : participation / retrait (toggle), conditions vérifiées par le service. */
export default defineButton({
  id: 'giveaway',
  module: 'giveaways',
  cooldown: 2,
  async execute(interaction, args, { t, config }) {
    const [action, rawId] = args;
    const id = Number(rawId);
    if (action !== 'enter' || !Number.isInteger(id) || !interaction.guildId || !config) return;
    await interaction.deferReply(EPHEMERAL);

    const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [embedService.error(t('core.member_not_found'))] });
      return;
    }
    const giveaway = await giveawayService.get(id);
    if (!giveaway || giveaway.guildId !== interaction.guildId) {
      await interaction.editReply({ embeds: [embedService.error(t('giveaways.not_found', { id }))] });
      return;
    }
    const result = await giveawayService.toggleEntry(id, member);
    if (result.ok) {
      await interaction.editReply({ embeds: [embedService.success(t(result.entered ? 'giveaways.enter.joined' : 'giveaways.enter.left', { count: result.count }))] });
      return;
    }
    switch (result.reason) {
      case 'not_found':
        await interaction.editReply({ embeds: [embedService.error(t('giveaways.not_found', { id }))] });
        return;
      case 'ended':
        await interaction.editReply({ embeds: [embedService.warning(t('giveaways.enter.ended'))] });
        return;
      case 'missing_role':
        await interaction.editReply({ embeds: [embedService.warning(t('giveaways.enter.missing_role', { role: `<@&${result.roleId}>` }))] });
        return;
      case 'min_messages':
        await interaction.editReply({ embeds: [embedService.warning(t('giveaways.enter.min_messages', { required: result.required, current: result.current }))] });
        return;
    }
  },
});
