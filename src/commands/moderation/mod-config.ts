import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService, type WarnThreshold } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { parseDuration, formatDuration } from '../../utils/time';
import { canManageRole } from '../../utils/permissions';
import { EPHEMERAL, MOD_PERMS, replyError } from './_shared';

function describeThresholds(t: (k: string, v?: Record<string, string | number>) => string, lang: string, list: WarnThreshold[]): string {
  if (!list.length) return t('moderation.config.no_thresholds');
  return list.map((th) => `**${th.count}** → ${t(`moderation.actions.${th.action}`)}${th.duration ? ` (${formatDuration(th.duration, lang)})` : ''}`).join('\n');
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('mod-config')
    .setDescription('Configurer la modération (seuils de warns, rôle mute, DM)')
    .addSubcommandGroup((g) =>
      g
        .setName('thresholds')
        .setDescription('Seuils d’escalade des avertissements')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Ajouter / remplacer un seuil')
            .addIntegerOption((o) => o.setName('count').setDescription('Nombre d’avertissements actifs').setRequired(true).setMinValue(1).setMaxValue(100))
            .addStringOption((o) =>
              o
                .setName('action')
                .setDescription('Action automatique')
                .setRequired(true)
                .addChoices({ name: 'Timeout', value: 'TIMEOUT' }, { name: 'Kick', value: 'KICK' }, { name: 'Ban', value: 'BAN' }, { name: 'Tempban', value: 'TEMPBAN' }),
            )
            .addStringOption((o) => o.setName('duration').setDescription('Durée (timeout / tempban), ex: 1h, 2d')),
        )
        .addSubcommand((s) => s.setName('remove').setDescription('Retirer un seuil').addIntegerOption((o) => o.setName('count').setDescription('Nombre d’avertissements du seuil').setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName('list').setDescription('Lister les seuils')),
    )
    .addSubcommand((s) => s.setName('mute-role').setDescription('Définir le rôle mute').addRoleOption((o) => o.setName('role').setDescription('Rôle (vide = retirer)')))
    .addSubcommand((s) => s.setName('dm').setDescription('Envoyer un DM aux membres sanctionnés').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('show').setDescription('Afficher la configuration de modération')),
  module: 'moderation',
  permissions: MOD_PERMS.admin,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const { t, lang } = ctx;
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const cfg = await moderationService.getConfig(guildId);

    if (group === 'thresholds') {
      if (sub === 'add') {
        const count = interaction.options.getInteger('count', true);
        const action = interaction.options.getString('action', true) as WarnThreshold['action'];
        const rawDuration = interaction.options.getString('duration');
        let duration: number | undefined;
        if (rawDuration) {
          const sec = parseDuration(rawDuration);
          if (!sec || sec < 60) return replyError(interaction, ctx, 'moderation.errors.invalid_duration');
          duration = sec;
        }
        if (action === 'TIMEOUT' && duration && duration > 28 * 86400) return replyError(interaction, ctx, 'moderation.errors.invalid_timeout_duration');
        if ((action === 'TIMEOUT' || action === 'TEMPBAN') && !duration) duration = action === 'TIMEOUT' ? 3600 : 86400;
        const next = [...cfg.warnThresholds.filter((th) => th.count !== count), { count, action, duration }];
        const updated = await moderationService.updateConfig(guildId, { warnThresholds: next });
        await interaction.reply({ embeds: [embedService.success(t('moderation.config.threshold_added', { count, action: t(`moderation.actions.${action}`) }) + '\n\n' + describeThresholds(t, lang, updated.warnThresholds))], ...EPHEMERAL });
        return;
      }
      if (sub === 'remove') {
        const count = interaction.options.getInteger('count', true);
        if (!cfg.warnThresholds.some((th) => th.count === count)) return replyError(interaction, ctx, 'moderation.config.threshold_not_found', { count });
        const updated = await moderationService.updateConfig(guildId, { warnThresholds: cfg.warnThresholds.filter((th) => th.count !== count) });
        await interaction.reply({ embeds: [embedService.success(t('moderation.config.threshold_removed', { count }) + '\n\n' + describeThresholds(t, lang, updated.warnThresholds))], ...EPHEMERAL });
        return;
      }
      await interaction.reply({ embeds: [embedService.brand(t('moderation.config.thresholds_title'), describeThresholds(t, lang, cfg.warnThresholds))], ...EPHEMERAL });
      return;
    }

    if (sub === 'mute-role') {
      const role = interaction.options.getRole('role');
      if (role && !canManageRole(interaction.guild.members.me, role.id)) return replyError(interaction, ctx, 'core.role_hierarchy');
      await moderationService.updateConfig(guildId, { muteRoleId: role?.id ?? null });
      await interaction.reply({ embeds: [embedService.success(role ? t('moderation.config.mute_role_set', { role: `<@&${role.id}>` }) : t('moderation.config.mute_role_removed'))], ...EPHEMERAL });
      return;
    }

    if (sub === 'dm') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await moderationService.updateConfig(guildId, { dmOnSanction: enabled });
      await interaction.reply({ embeds: [embedService.success(t('moderation.config.dm_set', { state: enabled ? t('core.enabled') : t('core.disabled') }))], ...EPHEMERAL });
      return;
    }

    const stats = await moderationService.stats(guildId, 30);
    const embed = embedService.brand(t('moderation.config.title', { server: interaction.guild.name })).addFields(
      { name: t('moderation.config.mute_role'), value: cfg.muteRoleId ? `<@&${cfg.muteRoleId}>` : t('core.none'), inline: true },
      { name: t('moderation.config.dm'), value: cfg.dmOnSanction ? t('core.enabled') : t('core.disabled'), inline: true },
      { name: t('moderation.lockdown.status_title'), value: cfg.lockdownActive ? t('moderation.lockdown.active') : t('moderation.lockdown.inactive'), inline: true },
      { name: t('moderation.config.thresholds_title'), value: describeThresholds(t, lang, cfg.warnThresholds), inline: false },
      { name: t('moderation.config.stats_title'), value: t('moderation.config.stats', { total: stats.total, warnings: stats.activeWarnings, bans: stats.activeBans, mutes: stats.activeMutes }), inline: false },
    );
    await interaction.reply({ embeds: [embed], ...EPHEMERAL });
  },
});
