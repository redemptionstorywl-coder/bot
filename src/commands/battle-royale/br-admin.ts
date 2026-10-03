import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { defineCommand } from '../../structures';
import { battleRoyaleService, BattleRoyaleError, PROFILE_FIELDS, STAT_FIELDS, type ProfileField, type StatField } from '../../services/BattleRoyaleService';
import { embedService } from '../../services/EmbedService';
import { discordTimestamp } from '../../utils/time';

const FIELD_CHOICES = [...STAT_FIELDS, ...PROFILE_FIELDS].map((f) => ({ name: f, value: f }));

/** /br-admin — saisons, stats et XP (admin). */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('br-admin')
    .setDescription('Administration Battle Royale')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommandGroup((g) =>
      g
        .setName('season')
        .setDescription('Saisons / Battle Pass')
        .addSubcommand((s) => s.setName('set').setDescription('Définir la saison active').addIntegerOption((o) => o.setName('season').setDescription('Numéro de saison').setRequired(true).setMinValue(1)))
        .addSubcommand((s) =>
          s
            .setName('new')
            .setDescription('Créer une nouvelle saison (Battle Pass)')
            .addStringOption((o) => o.setName('name').setDescription('Nom de la saison').setRequired(true).setMaxLength(100))
            .addIntegerOption((o) => o.setName('days').setDescription('Durée en jours (défaut 90)').setMinValue(1).setMaxValue(365))
            .addIntegerOption((o) => o.setName('tiers').setDescription('Nombre de paliers (défaut 30)').setMinValue(1).setMaxValue(100))
            .addIntegerOption((o) => o.setName('xp_per_tier').setDescription('XP par palier (défaut 1000)').setMinValue(1)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('Lister les saisons')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('stats')
        .setDescription('Modifier les stats d’un joueur')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Définir une valeur')
            .addUserOption((o) => o.setName('user').setDescription('Joueur').setRequired(true))
            .addStringOption((o) => o.setName('field').setDescription('Champ').setRequired(true).addChoices(...FIELD_CHOICES))
            .addStringOption((o) => o.setName('value').setDescription('Valeur (nombre, ou true/false pour battlePassPremium)').setRequired(true))
            .addIntegerOption((o) => o.setName('season').setDescription('Saison (stats de saison uniquement)').setMinValue(1)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('xp')
        .setDescription('XP')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Ajouter (ou retirer) de l’XP')
            .addUserOption((o) => o.setName('user').setDescription('Joueur').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('Quantité (négatif pour retirer)').setRequired(true)),
        ),
    ),
  module: 'battleRoyale',
  guildKinds: [GuildKind.BATTLE_ROYALE],
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.Administrator] },
  cooldown: 2,
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(true);
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;

    try {
      if (group === 'season' && sub === 'set') {
        const pass = await battleRoyaleService.setSeason(guildId, interaction.options.getInteger('season', true), interaction.user.id);
        return interaction.reply({ embeds: [embedService.success(t('battleroyale.admin.season_set', { season: pass.season, name: pass.name }))], ...ephemeral });
      }
      if (group === 'season' && sub === 'new') {
        const tiersCount = interaction.options.getInteger('tiers') ?? 30;
        const xpPerTier = interaction.options.getInteger('xp_per_tier') ?? 1000;
        const pass = await battleRoyaleService.newSeason(guildId, {
          name: interaction.options.getString('name', true),
          durationDays: interaction.options.getInteger('days') ?? 90,
          tiers: Array.from({ length: tiersCount }, (_, i) => ({ tier: i + 1, xpRequired: (i + 1) * xpPerTier, freeReward: null, premiumReward: null })),
          actorId: interaction.user.id,
        });
        return interaction.reply({ embeds: [embedService.success(t('battleroyale.admin.season_new', { season: pass.season, name: pass.name, ends: discordTimestamp(pass.endsAt, 'D') }))], ...ephemeral });
      }
      if (group === 'season' && sub === 'list') {
        const seasons = await battleRoyaleService.listSeasons(guildId);
        if (!seasons.length) return interaction.reply({ embeds: [embedService.info(t('battleroyale.battlepass.none'))], ...ephemeral });
        return interaction.reply({ embeds: [embedService.brand(t('battleroyale.admin.seasons_title'), seasons.map((s) => `${s.active ? '🟢' : '⚪'} **${s.season}** · ${s.name} · ${discordTimestamp(s.startsAt, 'd')} → ${discordTimestamp(s.endsAt, 'd')}`).join('\n'))], ...ephemeral });
      }
      if (group === 'stats' && sub === 'set') {
        const user = interaction.options.getUser('user', true);
        const field = interaction.options.getString('field', true) as StatField | ProfileField;
        const raw = interaction.options.getString('value', true).trim().toLowerCase();
        let value: number | boolean;
        if (field === 'battlePassPremium') value = ['true', '1', 'yes', 'oui', 'on'].includes(raw);
        else {
          value = Number(raw);
          if (!Number.isFinite(value) || value < 0) return interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: raw }))], ...ephemeral });
        }
        await battleRoyaleService.adminSetStat(guildId, user.id, field, value, interaction.options.getInteger('season') ?? undefined, interaction.user.id);
        return interaction.reply({ embeds: [embedService.success(t('battleroyale.admin.stat_set', { user: `<@${user.id}>`, field, value: String(value) }))], ...ephemeral });
      }
      if (group === 'xp' && sub === 'add') {
        const user = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);
        const profile = await battleRoyaleService.addXp(guildId, user.id, amount, interaction.user.id);
        return interaction.reply({ embeds: [embedService.success(t('battleroyale.admin.xp_added', { user: `<@${user.id}>`, amount, xp: profile.xp, level: profile.level }))], ...ephemeral });
      }
    } catch (err) {
      if (err instanceof BattleRoyaleError) return interaction.reply({ embeds: [embedService.error(t(`battleroyale.errors.${err.code}`))], ...ephemeral });
      throw err;
    }
  },
});
