import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { templateService } from '../../services/TemplateService';
import { SERVER_TEMPLATES } from '../../templates';
import { paginate } from '../../utils/pagination';
import { confirmRow, renderPlanPages, renderPlanSummary, templateName } from './_template';

/**
 * /template — pré-configure tout le serveur à partir d'un modèle (shop, battle-royale, prison, school) :
 * détection des salons et rôles existants par nom, configuration via les services, publication des premiers messages.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Pré-configurer le serveur à partir d’un modèle (salons et rôles détectés par nom)')
    .addSubcommand((s) => s.setName('list').setDescription('Lister les modèles disponibles'))
    .addSubcommand((s) =>
      s
        .setName('apply')
        .setDescription('Appliquer un modèle à ce serveur')
        .addStringOption((o) =>
          o
            .setName('template')
            .setDescription('Modèle')
            .setRequired(true)
            .addChoices(...SERVER_TEMPLATES.map((tpl) => ({ name: `${tpl.emoji} ${tpl.key}`, value: tpl.key }))),
        )
        .addBooleanOption((o) => o.setName('dry_run').setDescription('Afficher le plan sans rien modifier')),
    ),
  permissions: { internal: 'admin', bot: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels] },
  cooldown: 10,
  async execute(interaction, { t }) {
    if (!interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const embed = embedService.brand(
        t('admin.template.list_title'),
        `${t('admin.template.list_description')}\n\n${templateService
          .listTemplates()
          .map((tpl) => t('admin.template.list_item', { emoji: tpl.emoji, name: templateName(t, tpl), description: t(`admin.template.templates.${tpl.key}.description`), key: tpl.key }))
          .join('\n\n')}`,
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const key = interaction.options.getString('template', true);
    const tpl = templateService.getTemplate(key);
    if (!tpl) {
      await interaction.editReply({ embeds: [embedService.error(t('admin.template.unknown', { key }))] });
      return;
    }
    const dryRun = interaction.options.getBoolean('dry_run') ?? false;
    await interaction.guild.channels.fetch();
    await interaction.guild.roles.fetch();
    const { steps } = await templateService.plan(interaction.guild, key);
    if (dryRun) {
      await paginate(interaction, { pages: renderPlanPages(t, tpl, steps, { dryRun }), userId: interaction.user.id, ephemeral: true });
      return;
    }
    await interaction.editReply({
      content: t('admin.template.confirm', { name: templateName(t, tpl), server: interaction.guild.name }),
      embeds: [renderPlanSummary(t, tpl, steps)],
      components: [confirmRow(t, key, interaction.user.id)],
    });
  },
});
