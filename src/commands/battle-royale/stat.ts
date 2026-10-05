import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type Guild, type User } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { defineCommand } from '../../structures';
import type { InteractionContext } from '../../structures/types';
import { battleRoyaleService, computeKd, levelProgress, progressBar } from '../../services/BattleRoyaleService';
import { leaderboardService } from '../../services/LeaderboardService';
import { fivemSyncService } from '../../services/FiveMSyncService';
import { embedService } from '../../services/EmbedService';
import { STAT_USER_PREFIX, parseStatTarget, pickByName, statChannelGate } from '../../services/battleroyale/stat';
import { discordTimestamp, formatDuration } from '../../utils/time';

const nf = (lang: string) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR');

/** Résout le joueur visé par l'option `joueur` (pseudo en jeu, mention, ID, choix d'autocomplete) ; null si introuvable. */
async function resolveTarget(interaction: ChatInputCommandInteraction, guild: Guild): Promise<{ user: User | null; userId: string } | null> {
  const target = parseStatTarget(interaction.options.getString('joueur'));
  if (target.kind === 'self') return { user: interaction.user, userId: interaction.user.id };
  if (target.kind === 'user') return { user: await interaction.client.users.fetch(target.userId).catch(() => null), userId: target.userId };
  const match = pickByName(await battleRoyaleService.searchPlayers(guild.id, target.query, 25), target.query);
  if (!match) return null;
  return { user: await interaction.client.users.fetch(match.userId).catch(() => null), userId: match.userId };
}

async function execute(interaction: ChatInputCommandInteraction, ctx: InteractionContext): Promise<unknown> {
  const { t, lang } = ctx;
  const guild = interaction.guild;
  if (!guild || !ctx.config) return;
  const settings = await leaderboardService.getSettings(guild.id);
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  if (statChannelGate(settings.statChannelId, interaction.channelId, parentId) === 'redirect') {
    return interaction.reply({ embeds: [embedService.info(t('battleroyale.stat.wrong_channel', { channel: `<#${settings.statChannelId}>` }))], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply();
  const target = await resolveTarget(interaction, guild);
  if (!target) {
    await interaction.editReply({ embeds: [embedService.info(t('battleroyale.stat.not_found', { query: interaction.options.getString('joueur') ?? '' }))] });
    return;
  }
  const self = target.userId === interaction.user.id;
  const profile = await battleRoyaleService.getProfile(guild.id, target.userId);
  if (!profile) {
    await interaction.editReply({ embeds: [embedService.info(self ? t('battleroyale.stat.none_self') : t('battleroyale.stat.none', { user: `<@${target.userId}>` }))] });
    return;
  }
  const season = await battleRoyaleService.getCurrentSeason(guild.id);
  const [stats, pass, player] = await Promise.all([battleRoyaleService.getStats(profile.id, season), battleRoyaleService.getActiveBattlePass(guild.id), fivemSyncService.getPlayerSummary(guild.id, target.userId)]);
  const rank = stats && stats.matches > 0 ? await battleRoyaleService.seasonRank(guild.id, season, stats) : null;
  const n = nf(lang);
  const lp = levelProgress(profile.xp);
  const kills = stats?.kills ?? 0;
  const deaths = stats?.deaths ?? 0;
  const member = await guild.members.fetch(target.userId).catch(() => null);
  const name = profile.nickname ?? player?.name ?? member?.displayName ?? target.user?.displayName ?? target.userId;
  const seasonLabel = pass?.season === season ? `${season} · ${pass.name}` : String(season);
  const embed = embedService
    .brand(t('battleroyale.stat.title', { name }))
    .setDescription(
      [
        target.user ? `<@${target.userId}>` : null,
        `**${t('battleroyale.profile.level')} ${lp.level}** · ${n.format(profile.xp)} XP`,
        `\`${progressBar(lp.ratio)}\` ${n.format(lp.current)}/${n.format(lp.needed)} XP`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .addFields(
      { name: t('battleroyale.profile.wins'), value: n.format(stats?.wins ?? 0), inline: true },
      { name: t('battleroyale.profile.kills'), value: n.format(kills), inline: true },
      { name: t('battleroyale.stat.deaths'), value: n.format(deaths), inline: true },
      { name: t('battleroyale.profile.kd'), value: computeKd(kills, deaths).toFixed(2), inline: true },
      { name: t('battleroyale.profile.matches'), value: n.format(stats?.matches ?? 0), inline: true },
      { name: t('battleroyale.profile.top10'), value: n.format(stats?.top10 ?? 0), inline: true },
      { name: t('battleroyale.stat.damage'), value: n.format(stats?.damage ?? 0), inline: true },
      { name: t('battleroyale.profile.playtime'), value: profile.playtimeMinutes > 0 ? formatDuration(profile.playtimeMinutes * 60, lang) : '—', inline: true },
      { name: t('battleroyale.stat.rank'), value: rank ? t('battleroyale.stat.rank_value', { rank: rank.rank, total: rank.total }) : t('battleroyale.stat.unranked'), inline: true },
      { name: t('battleroyale.profile.season'), value: seasonLabel, inline: true },
      {
        name: t('battleroyale.profile.status'),
        value: player ? (player.online ? t('battleroyale.profile.in_game', { server: player.serverName ?? '—' }) : t('battleroyale.profile.offline')) : t('battleroyale.profile.not_linked'),
        inline: true,
      },
      { name: t('battleroyale.profile.last_seen'), value: player?.lastSeenAt ? discordTimestamp(player.lastSeenAt, 'R') : '—', inline: true },
    )
    .setFooter({ text: t('battleroyale.stat.footer', { season }) });
  const avatar = member?.displayAvatarURL({ size: 256 }) ?? target.user?.displayAvatarURL({ size: 256 });
  if (avatar) embed.setThumbnail(avatar);
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

/**
 * /stat [joueur] — statistiques Battle Royale (soi-même ou un autre joueur : pseudo en jeu avec autocomplete, mention ou ID).
 * Salon dédié facultatif (`/config module:battleroyale` → 📺 Affichage) : ailleurs, réponse éphémère avec un lien.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('stat')
    .setDescription('Statistiques Battle Royale (les vôtres ou celles d’un joueur)')
    .addStringOption((o) => o.setName('joueur').setDescription('Pseudo en jeu, mention ou ID (vide = vous)').setAutocomplete(true).setMaxLength(100)),
  module: 'battleRoyale',
  guildKinds: [GuildKind.BATTLE_ROYALE],
  permissions: { internal: 'everyone' },
  cooldown: 3,
  execute,
  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const query = String(interaction.options.getFocused() ?? '');
    const target = parseStatTarget(query);
    const search = target.kind === 'name' ? target.query : '';
    const matches = await battleRoyaleService.searchPlayers(interaction.guildId, search, 25);
    return interaction.respond(matches.map((m) => ({ name: m.name.slice(0, 100), value: `${STAT_USER_PREFIX}${m.userId}` })));
  },
});
