import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { defineCommand } from '../../structures';
import { battleRoyaleService, computeKd, levelProgress, progressBar } from '../../services/BattleRoyaleService';
import { embedService } from '../../services/EmbedService';
import { fivemSyncService } from '../../services/FiveMSyncService';
import { discordTimestamp, formatDuration } from '../../utils/time';

/** /profile [user] — profil Battle Royale : niveau, XP, stats de la saison courante, Battle Pass. */
export default defineCommand({
  data: new SlashCommandBuilder().setName('profile').setDescription('Profil Battle Royale').addUserOption((o) => o.setName('user').setDescription('Joueur (vide = vous)')),
  module: 'battleRoyale',
  guildKinds: [GuildKind.BATTLE_ROYALE],
  cooldown: 3,
  async execute(interaction, { t, lang, config }) {
    if (!interaction.guild || !config) return;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const self = target.id === interaction.user.id;
    await interaction.deferReply(self ? {} : { flags: MessageFlags.Ephemeral });
    const guildId = interaction.guild.id;
    const profile = self ? await battleRoyaleService.ensureProfile(guildId, target.id, target.displayName) : await battleRoyaleService.getProfile(guildId, target.id);
    if (!profile) {
      await interaction.editReply({ embeds: [embedService.info(t('battleroyale.profile.none', { user: `<@${target.id}>` }))] });
      return;
    }
    const season = await battleRoyaleService.getCurrentSeason(guildId);
    const stats = await battleRoyaleService.getStats(profile.id, season);
    const pass = await battleRoyaleService.getActiveBattlePass(guildId);
    const bp = battleRoyaleService.getBattlePassProgress(profile, pass);
    const lp = levelProgress(profile.xp);
    const player = await fivemSyncService.getPlayerSummary(guildId, target.id);
    const kills = stats?.kills ?? 0;
    const deaths = stats?.deaths ?? 0;
    const embed = embedService
      .brand(t('battleroyale.profile.title', { name: profile.nickname ?? target.displayName }))
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .setDescription(`**${t('battleroyale.profile.level')} ${lp.level}** · ${profile.xp} XP\n\`${progressBar(lp.ratio)}\` ${lp.current}/${lp.needed} XP`)
      .addFields(
        { name: t('battleroyale.profile.wins'), value: String(stats?.wins ?? 0), inline: true },
        { name: t('battleroyale.profile.kills'), value: String(kills), inline: true },
        { name: t('battleroyale.profile.kd'), value: computeKd(kills, deaths).toFixed(2), inline: true },
        { name: t('battleroyale.profile.matches'), value: String(stats?.matches ?? 0), inline: true },
        { name: t('battleroyale.profile.top10'), value: String(stats?.top10 ?? 0), inline: true },
        { name: t('battleroyale.profile.playtime'), value: formatDuration(profile.playtimeMinutes * 60, lang), inline: true },
        { name: t('battleroyale.profile.season'), value: pass ? `${season} · ${pass.name}` : String(season), inline: true },
        { name: t('battleroyale.profile.battlepass'), value: `${t('battleroyale.profile.tier')} ${bp.tier}${profile.battlePassPremium ? ' ⭐' : ''}${bp.nextTier ? ` · \`${progressBar(bp.ratio, 8)}\` ${bp.current}/${bp.needed}` : bp.maxed ? ` · ${t('battleroyale.battlepass.maxed')}` : ''}`, inline: true },
        { name: t('battleroyale.profile.identifier'), value: profile.identifier ? `\`${profile.identifier}\`` : t('battleroyale.profile.not_linked'), inline: true },
      );
    if (player) {
      embed.addFields(
        { name: t('battleroyale.profile.status'), value: player.online ? t('battleroyale.profile.in_game', { server: player.serverName ?? '—' }) : t('battleroyale.profile.offline'), inline: true },
        { name: t('battleroyale.profile.last_seen'), value: player.lastSeenAt ? discordTimestamp(player.lastSeenAt, 'R') : '—', inline: true },
        { name: t('battleroyale.profile.ingame_name'), value: player.name && player.name !== '—' ? player.name : '—', inline: true },
      );
    }
    await interaction.editReply({ embeds: [embed] });
  },
});
