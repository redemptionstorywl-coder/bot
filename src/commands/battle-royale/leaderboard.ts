import { SlashCommandBuilder } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { defineCommand } from '../../structures';
import { battleRoyaleService, rankLabel, type LeaderboardMetric } from '../../services/BattleRoyaleService';
import { embedService } from '../../services/EmbedService';
import { chunk, paginate } from '../../utils/pagination';

/** /leaderboard <wins|kills|level|kd> [season] — top 10 par page, médailles. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Classements Battle Royale')
    .addStringOption((o) =>
      o
        .setName('metric')
        .setDescription('Classement')
        .setRequired(true)
        .addChoices({ name: '🏆 wins', value: 'wins' }, { name: '🔫 kills', value: 'kills' }, { name: '⭐ level', value: 'level' }, { name: '⚖️ kd', value: 'kd' }),
    )
    .addIntegerOption((o) => o.setName('season').setDescription('Saison (vide = courante)').setMinValue(1)),
  module: 'battleRoyale',
  guildKinds: [GuildKind.BATTLE_ROYALE],
  cooldown: 5,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    await interaction.deferReply();
    const guildId = interaction.guild.id;
    const metric = interaction.options.getString('metric', true) as LeaderboardMetric;
    const season = interaction.options.getInteger('season') ?? (await battleRoyaleService.getCurrentSeason(guildId));
    const rows = await battleRoyaleService.leaderboard(guildId, metric, season, 100);
    if (!rows.length) {
      await interaction.editReply({ embeds: [embedService.info(t('battleroyale.leaderboard.empty', { season }))] });
      return;
    }
    const value = (r: (typeof rows)[number]) => (metric === 'wins' ? `${r.wins} 🏆` : metric === 'kills' ? `${r.kills} 🔫` : metric === 'level' ? `${t('battleroyale.profile.level')} ${r.level} · ${r.xp} XP` : `${r.kd.toFixed(2)} K/D`);
    const pages = chunk(rows, 10).map((group, page, all) =>
      embedService
        .brand(t('battleroyale.leaderboard.title', { metric: t(`battleroyale.leaderboard.metrics.${metric}`), season }))
        .setDescription(group.map((r, i) => `${rankLabel(page * 10 + i)} <@${r.userId}> — **${value(r)}**`).join('\n'))
        .setFooter({ text: t('core.page', { current: page + 1, total: all.length }) }),
    );
    await paginate(interaction, { pages, userId: interaction.user.id });
  },
});
