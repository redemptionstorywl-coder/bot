import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { buildCustomId } from '../../utils/customId';
import { discordTimestamp } from '../../utils/time';
import { EPHEMERAL, MOD_PERMS, readReason } from './_shared';

/**
 * /lockdown on|off|status — demande une confirmation par bouton (mod:lockdown:on|off),
 * l'action réelle est faite dans src/buttons/mod.ts via moderationService.setLockdown().
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Verrouiller / déverrouiller tout le serveur')
    .addSubcommand((s) => s.setName('on').setDescription('Activer le lockdown (sauvegarde puis refuse l’écriture partout)').addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(512)))
    .addSubcommand((s) => s.setName('off').setDescription('Désactiver le lockdown et restaurer les permissions'))
    .addSubcommand((s) => s.setName('status').setDescription('État du lockdown')),
  module: 'moderation',
  permissions: MOD_PERMS.admin,
  cooldown: 3,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const { t } = ctx;
    const sub = interaction.options.getSubcommand();
    const cfg = await moderationService.getConfig(interaction.guild.id);

    if (sub === 'status') {
      const state = cfg.lockdownState;
      const embed = cfg.lockdownActive
        ? embedService
            .error(t('moderation.lockdown.status_on', { since: state ? discordTimestamp(new Date(state.at), 'R') : '—', actor: state ? `<@${state.actorId}>` : '—', channels: Object.keys(state?.channels ?? {}).length, reason: state?.reason ?? t('core.no_reason') }), t('moderation.lockdown.status_title'))
        : embedService.brand(t('moderation.lockdown.status_title'), t('moderation.lockdown.status_off'));
      await interaction.reply({ embeds: [embed], ...EPHEMERAL });
      return;
    }

    const enable = sub === 'on';
    if (cfg.lockdownActive === enable) {
      await interaction.reply({ embeds: [embedService.warning(t(enable ? 'moderation.lockdown.already_on' : 'moderation.lockdown.already_off'))], ...EPHEMERAL });
      return;
    }
    const reason = enable ? readReason(interaction) : null;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId('mod', 'lockdown', enable ? 'on' : 'off', reason ?? '')).setLabel(t('core.confirm')).setStyle(enable ? ButtonStyle.Danger : ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(buildCustomId('mod', 'cancel')).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary),
    );
    const embed = enable
      ? embedService.error(t('moderation.lockdown.confirm_on', { reason: reason ?? t('core.no_reason') }), t('moderation.lockdown.confirm_title'))
      : embedService.brand(t('moderation.lockdown.confirm_title'), t('moderation.lockdown.confirm_off'));
    await interaction.reply({ embeds: [embed], components: [row], ...EPHEMERAL });
  },
});
