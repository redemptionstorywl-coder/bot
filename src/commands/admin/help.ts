import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { env } from '../../config/env';

const CATEGORY_LABELS: Record<string, string> = {
  admin: '⚙️ Administration',
  moderation: '🛡️ Modération',
  tickets: '🎫 Tickets',
  roles: '🎭 Rôles',
  announcements: '📢 Annonces',
  embeds: '🎨 Embeds',
  events: '📅 Événements',
  whitelist: '📝 Whitelist',
  'battle-royale': '⚔️ Battle Royale',
  school: '🎓 School RP',
  shop: '🛒 Shop',
};

export default defineCommand({
  data: new SlashCommandBuilder().setName('help').setDescription('Liste des commandes disponibles'),
  dmPermission: true,
  cooldown: 5,
  async execute(interaction, { client, t, config }) {
    const grouped = new Map<string, string[]>();
    for (const cmd of client.commands.values()) {
      if (cmd.module && config && !config.modules[cmd.module]) continue;
      if (cmd.guildKinds?.length && config && !cmd.guildKinds.includes(config.kind)) continue;
      const cat = cmd.category ?? 'misc';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(`\`/${cmd.data.name}\` — ${cmd.data.description}`);
    }
    const embed = embedService.brand(t('admin.help.title'), t('admin.help.description', { dashboard: env().DASHBOARD_URL }));
    for (const [cat, list] of [...grouped.entries()].sort()) {
      embed.addFields({ name: CATEGORY_LABELS[cat] ?? cat, value: list.join('\n').slice(0, 1024) });
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});
