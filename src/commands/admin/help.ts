import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { env } from '../../config/env';

/** Libellé traduit d'une catégorie (dossier de commandes), ou le nom du dossier si inconnu. */
function categoryLabel(t: (key: string) => string, category: string): string {
  const key = `panels_core.help.categories.${category}`;
  const label = t(key);
  return label === key ? category : label;
}

/**
 * /help — `/config` en premier (toute la configuration), puis les commandes d'action par catégorie
 * (modules désactivés et types de serveur non concernés masqués).
 */
export default defineCommand({
  data: new SlashCommandBuilder().setName('help').setDescription('Liste des commandes disponibles'),
  dmPermission: true,
  cooldown: 5,
  async execute(interaction, { client, t, config }) {
    const embed = embedService.brand(t('admin.help.title'), t('panels_core.help.description', { dashboard: env().DASHBOARD_URL }));

    const configCmd = client.commands.get('config');
    if (configCmd) {
      const moduleOption = configCmd.data.toJSON().options?.[0] as { choices?: { name: string }[] } | undefined;
      const panels = (moduleOption?.choices ?? []).map((c) => c.name).join(' · ');
      embed.addFields({ name: t('panels_core.help.config_title'), value: t('panels_core.help.config_value', { panels: panels || '—' }).slice(0, 1024) });
    }

    const grouped = new Map<string, string[]>();
    for (const cmd of client.commands.values()) {
      if (cmd.data.name === 'config') continue;
      if (cmd.module && config && !config.modules[cmd.module]) continue;
      if (cmd.guildKinds?.length && config && !cmd.guildKinds.includes(config.kind)) continue;
      const cat = cmd.category ?? 'misc';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(`\`/${cmd.data.name}\` — ${cmd.data.description}`);
    }
    for (const [cat, list] of [...grouped.entries()].sort()) {
      if (embed.data.fields && embed.data.fields.length >= 25) break;
      embed.addFields({ name: categoryLabel(t, cat), value: list.join('\n').slice(0, 1024) });
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});
