import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { defineCommand } from '../../structures';
import { battleRoyaleService, BattleRoyaleError } from '../../services/BattleRoyaleService';
import { fivemService } from '../../services/FiveMService';
import { fivemIdentifierSchema } from '../../services/fivem/schemas';
import { embedService } from '../../services/EmbedService';

/** /br-link <identifier> — lie l'identifiant FiveM (license:…) au profil ; vérifie la présence en jeu si un serveur est configuré. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('br-link')
    .setDescription('Lier votre identifiant FiveM (license:…) à votre profil')
    .addStringOption((o) => o.setName('identifier').setDescription('Identifiant FiveM, ex: license:0123abcd…').setRequired(true).setMaxLength(128)),
  module: 'battleRoyale',
  guildKinds: [GuildKind.BATTLE_ROYALE],
  cooldown: 10,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const parsed = fivemIdentifierSchema.safeParse(interaction.options.getString('identifier', true).trim());
    if (!parsed.success) return interaction.reply({ embeds: [embedService.error(t('battleroyale.link.invalid'))], ...ephemeral });
    await interaction.deferReply(ephemeral);
    const guildId = interaction.guild.id;
    const identifier = parsed.data;
    let verified: boolean | null = null;
    if (await fivemService.hasServers(guildId)) verified = await fivemService.isIdentifierOnline(guildId, identifier);
    try {
      await battleRoyaleService.linkIdentifier(guildId, interaction.user.id, identifier, interaction.user.displayName);
    } catch (err) {
      if (err instanceof BattleRoyaleError) return interaction.editReply({ embeds: [embedService.error(t(`battleroyale.errors.${err.code}`))] });
      throw err;
    }
    const embed = embedService.success(t('battleroyale.link.done', { identifier }));
    if (verified === true) embed.addFields({ name: t('battleroyale.link.verification'), value: t('battleroyale.link.verified') });
    else if (verified === false) embed.addFields({ name: t('battleroyale.link.verification'), value: t('battleroyale.link.not_online') });
    await interaction.editReply({ embeds: [embed] });
  },
});
