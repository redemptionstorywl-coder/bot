import { MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { embedService } from '../services/EmbedService';
import { templateService } from '../services/TemplateService';
import { paginate } from '../utils/pagination';
import { renderReportPages, templateName } from '../commands/admin/_template';

/**
 * Confirmation de `/template apply` (namespace `tpl`, admin) :
 *  - `tpl:apply:<key>:<userId>:<createMissing 1|0>` → applique le modèle puis affiche le rapport paginé
 *  - `tpl:cancel:<key>:<userId>`                    → annule
 */
export default defineButton({
  id: 'tpl',
  permissions: { internal: 'admin' },
  cooldown: 3,
  async execute(interaction, args, { t }) {
    if (!interaction.inCachedGuild()) return;
    const [action = '', key = '', userId = '', createMissingFlag = '1'] = args;
    if (userId && userId !== interaction.user.id) {
      await interaction.reply({ embeds: [embedService.error(t('admin.template.not_author'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const tpl = templateService.getTemplate(key);
    if (action === 'cancel' || !tpl) {
      await interaction.update({ content: tpl ? t('admin.template.cancelled') : t('admin.template.unknown', { key }), embeds: [], components: [] });
      return;
    }
    await interaction.deferUpdate();
    await interaction.editReply({ content: t('admin.template.applying', { name: templateName(t, tpl) }), embeds: [], components: [] });
    await interaction.guild.channels.fetch();
    await interaction.guild.roles.fetch();
    const report = await templateService.apply(interaction.guild, key, interaction.user.id, { createMissing: createMissingFlag !== '0' });
    await interaction.editReply({ content: null });
    await paginate(interaction, { pages: renderReportPages(t, report), userId: interaction.user.id, ephemeral: true });
  },
});
