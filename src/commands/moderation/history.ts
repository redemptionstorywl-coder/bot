import { SlashCommandBuilder } from 'discord.js';
import { SanctionType } from '@prisma/client';
import { defineCommand } from '../../structures';
import { moderationService } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { paginate, chunk } from '../../utils/pagination';
import { EPHEMERAL, MOD_PERMS, sanctionLine } from './_shared';

const PAGE_SIZE = 8;
const USER_TYPES = Object.values(SanctionType).filter((t) => !['PURGE', 'LOCK', 'UNLOCK', 'SLOWMODE', 'LOCKDOWN', 'LOCKDOWN_END'].includes(t));

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Historique des sanctions d’un utilisateur')
    .addUserOption((o) => o.setName('user').setDescription('Utilisateur').setRequired(true))
    .addStringOption((o) => o.setName('type').setDescription('Filtrer par type').addChoices(...USER_TYPES.map((t) => ({ name: t, value: t })))),
  module: 'moderation',
  permissions: MOD_PERMS.view,
  cooldown: 3,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const { t } = ctx;
    const user = interaction.options.getUser('user', true);
    const type = (interaction.options.getString('type') ?? undefined) as SanctionType | undefined;
    await interaction.deferReply(EPHEMERAL);
    const guildId = interaction.guild.id;
    const [page, warnings] = await Promise.all([moderationService.listSanctions(guildId, { userId: user.id, type, page: 1, pageSize: 50 }), moderationService.countActiveWarnings(guildId, user.id)]);

    const stats: Partial<Record<SanctionType, number>> = {};
    for (const s of page.items) stats[s.type] = (stats[s.type] ?? 0) + 1;
    const summary = Object.entries(stats)
      .map(([k, n]) => `${moderationService.typeLabel(t, k as SanctionType)} : **${n}**`)
      .join(' • ');
    const header = [summary || null, t('moderation.history.active_warnings', { count: warnings })].filter(Boolean).join('\n');
    const title = t('moderation.history.title', { user: user.tag });
    const groups = chunk(page.items, PAGE_SIZE);
    if (!groups.length) groups.push([]);
    const pages = groups.map((items, i) =>
      embedService
        .brand(title, `${header}\n\n${items.map((s) => sanctionLine(ctx, s)).join('\n') || t('moderation.history.empty')}`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setFooter({ text: t('moderation.history.footer', { total: page.total, page: i + 1, pages: groups.length }) }),
    );
    await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
  },
});
