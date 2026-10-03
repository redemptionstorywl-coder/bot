import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { formatDuration } from '../../utils/time';
import { scheduler } from '../../services/SchedulerService';
import { prisma } from '../../database/client';

export default defineCommand({
  data: new SlashCommandBuilder().setName('status').setDescription('État du bot (uptime, latence, base de données)').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  permissions: { internal: 'staff' },
  cooldown: 5,
  async execute(interaction, { client, t, lang }) {
    const started = Date.now();
    let db = '🟢';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = '🔴';
    }
    const dbMs = Date.now() - started;
    const embed = embedService.brand(t('admin.status.title')).addFields(
      { name: t('admin.status.uptime'), value: formatDuration(client.uptimeSeconds, lang), inline: true },
      { name: t('admin.status.ping'), value: `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: t('admin.status.database'), value: `${db} ${dbMs} ms`, inline: true },
      { name: t('admin.status.guilds'), value: String(client.guilds.cache.size), inline: true },
      { name: t('admin.status.users'), value: String(client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)), inline: true },
      { name: t('admin.status.memory'), value: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`, inline: true },
      { name: t('admin.status.tasks'), value: scheduler.registered.map((n) => `\`${n}\``).join(', ') || '—' },
    );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});
