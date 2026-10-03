import { SlashCommandBuilder } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { defineCommand } from '../../structures';
import { battleRoyaleService, parseTiers, progressBar } from '../../services/BattleRoyaleService';
import { embedService } from '../../services/EmbedService';
import { chunk, paginate } from '../../utils/pagination';
import { discordTimestamp } from '../../utils/time';

/** /battlepass — progression personnelle + liste des paliers de la saison active. */
export default defineCommand({
  data: new SlashCommandBuilder().setName('battlepass').setDescription('Battle Pass : progression et paliers'),
  module: 'battleRoyale',
  guildKinds: [GuildKind.BATTLE_ROYALE],
  cooldown: 3,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    await interaction.deferReply();
    const guildId = interaction.guild.id;
    const pass = await battleRoyaleService.getActiveBattlePass(guildId);
    if (!pass) {
      await interaction.editReply({ embeds: [embedService.info(t('battleroyale.battlepass.none'))] });
      return;
    }
    const profile = await battleRoyaleService.ensureProfile(guildId, interaction.user.id, interaction.user.displayName);
    const tiers = parseTiers(pass.tiers);
    const bp = battleRoyaleService.getBattlePassProgress(profile, pass);
    const header = `**${t('battleroyale.profile.tier')} ${bp.tier}/${tiers.length}**${profile.battlePassPremium ? ' ⭐ Premium' : ''} · ${profile.battlePassXp} XP\n\`${progressBar(bp.ratio)}\` ${bp.nextTier ? `${bp.current}/${bp.needed} XP → ${t('battleroyale.profile.tier')} ${bp.nextTier.tier}` : t('battleroyale.battlepass.maxed')}\n${t('battleroyale.battlepass.ends')} ${discordTimestamp(pass.endsAt, 'R')}`;
    const none = t('core.none');
    const pages = chunk(tiers, 10).map((group, i, all) =>
      embedService
        .brand(t('battleroyale.battlepass.title', { season: pass.season, name: pass.name }), header)
        .addFields({
          name: t('battleroyale.battlepass.tiers'),
          value: group.map((tier) => `${tier.tier <= bp.tier ? '✅' : '🔒'} **${tier.tier}** · ${tier.xpRequired} XP · 🆓 ${tier.freeReward ?? none} · ⭐ ${tier.premiumReward ?? none}`).join('\n'),
        })
        .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
    );
    if (!pages.length) pages.push(embedService.brand(t('battleroyale.battlepass.title', { season: pass.season, name: pass.name }), header));
    await paginate(interaction, { pages, userId: interaction.user.id });
  },
});
