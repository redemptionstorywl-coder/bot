import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { FiveMFramework } from '@prisma/client';
import { defineCommand } from '../../structures';
import { fivemService, FiveMError } from '../../services/FiveMService';
import { embedService } from '../../services/EmbedService';
import { env } from '../../config/env';
import { discordTimestamp } from '../../utils/time';
import { chunk, paginate } from '../../utils/pagination';

const FRAMEWORK_CHOICES = Object.values(FiveMFramework).map((f) => ({ name: f, value: f }));

/**
 * /fivem — gestion des serveurs FiveM reliés à ce Discord (clé, framework, host, statut, maintenance).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('fivem')
    .setDescription('Gérer les serveurs FiveM reliés à ce Discord')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Ajouter un serveur FiveM')
        .addStringOption((o) => o.setName('key').setDescription('Clé unique (ex: main, prison-1)').setRequired(true).setMaxLength(64))
        .addStringOption((o) => o.setName('name').setDescription('Nom affiché').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('framework').setDescription('Framework').setRequired(true).addChoices(...FRAMEWORK_CHOICES))
        .addStringOption((o) => o.setName('host').setDescription('URL du serveur pour le polling (ex: http://1.2.3.4:30120)').setMaxLength(200))
        .addStringOption((o) => o.setName('api_key').setDescription('Clé API propre à ce serveur (sinon FIVEM_API_KEY globale)').setMaxLength(128)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Retirer un serveur').addStringOption((o) => o.setName('key').setDescription('Clé du serveur').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Lister les serveurs configurés'))
    .addSubcommand((s) => s.setName('status').setDescription('Afficher le statut d’un serveur').addStringOption((o) => o.setName('key').setDescription('Clé du serveur (vide = tous)').setAutocomplete(true)))
    .addSubcommand((s) =>
      s
        .setName('maintenance')
        .setDescription('Activer / désactiver la maintenance')
        .addStringOption((o) => o.setName('key').setDescription('Clé du serveur').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('state').setDescription('on / off').setRequired(true).addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
    )
    .addSubcommand((s) =>
      s
        .setName('status-channel')
        .setDescription('Salon du message de statut auto-mis à jour')
        .addStringOption((o) => o.setName('key').setDescription('Clé du serveur').setRequired(true).setAutocomplete(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Salon (vide = désactiver)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) => s.setName('players').setDescription('Joueurs connectés').addStringOption((o) => o.setName('key').setDescription('Clé du serveur').setRequired(true).setAutocomplete(true))),
  module: 'fivem',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.Administrator] },
  cooldown: 2,
  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = interaction.options.getFocused().toLowerCase();
    const servers = await fivemService.listServers(interaction.guildId);
    await interaction.respond(servers.filter((s) => s.key.includes(focused) || s.name.toLowerCase().includes(focused)).slice(0, 25).map((s) => ({ name: `${s.name} (${s.key})`, value: s.key })));
  },
  async execute(interaction, { t, lang, config }) {
    if (!interaction.guild || !config) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const fail = (key: string, vars?: Record<string, string | number>) => interaction.reply({ embeds: [embedService.error(t(key, vars))], ...ephemeral });

    try {
      switch (sub) {
        case 'add': {
          const server = await fivemService.addServer({
            guildId,
            key: interaction.options.getString('key', true),
            name: interaction.options.getString('name', true),
            framework: interaction.options.getString('framework', true) as FiveMFramework,
            host: interaction.options.getString('host'),
            apiKey: interaction.options.getString('api_key'),
          });
          const apiBase = `${env().DASHBOARD_URL}/api/fivem/servers/${guildId}/${server.key}`;
          await interaction.reply({
            embeds: [
              embedService
                .success(t('fivem.add.done', { name: server.name, key: server.key, framework: server.framework }))
                .addFields({ name: t('fivem.add.api_base'), value: `\`${apiBase}\`` }, { name: t('fivem.add.auth'), value: t('fivem.add.auth_hint', { header: 'x-api-key' }) })
                .setFooter({ text: t('fivem.add.docs') }),
            ],
            ...ephemeral,
          });
          return;
        }
        case 'remove': {
          const server = await fivemService.removeServer(guildId, interaction.options.getString('key', true));
          await interaction.reply({ embeds: [embedService.success(t('fivem.remove.done', { name: server.name }))], ...ephemeral });
          return;
        }
        case 'list': {
          const servers = await fivemService.listServers(guildId);
          if (!servers.length) return fail('fivem.list.empty');
          const lines = servers.map((s) => {
            const st = fivemService.getResolvedStatus(s);
            const icon = st.maintenance ? '🟠' : st.online ? '🟢' : '🔴';
            return `${icon} **${s.name}** \`${s.key}\` · ${s.framework} · ${st.online ? `${st.players}/${st.maxPlayers || '—'}` : t('fivem.status.offline')}${s.host ? ` · \`${s.host}\`` : ''}${s.statusChannelId ? ` · <#${s.statusChannelId}>` : ''}`;
          });
          await interaction.reply({ embeds: [embedService.brand(t('fivem.list.title', { count: servers.length }), lines.join('\n'))], ...ephemeral });
          return;
        }
        case 'status': {
          const key = interaction.options.getString('key');
          const servers = key ? [await fivemService.requireServer(guildId, key)] : await fivemService.listServers(guildId);
          if (!servers.length) return fail('fivem.list.empty');
          await interaction.reply({ embeds: servers.slice(0, 10).map((s) => fivemService.buildStatusEmbed(s, lang)), ...ephemeral });
          return;
        }
        case 'maintenance': {
          const enabled = interaction.options.getString('state', true) === 'on';
          const server = await fivemService.setMaintenance(guildId, interaction.options.getString('key', true), enabled, interaction.user.id);
          await interaction.reply({ embeds: [embedService.success(t(enabled ? 'fivem.maintenance.on' : 'fivem.maintenance.off', { name: server.name }))], ...ephemeral });
          return;
        }
        case 'status-channel': {
          await interaction.deferReply(ephemeral);
          const channel = interaction.options.getChannel('channel');
          const server = await fivemService.setStatusChannel(guildId, interaction.options.getString('key', true), channel?.id ?? null);
          await interaction.editReply({ embeds: [embedService.success(channel ? t('fivem.status_channel.set', { name: server.name, channel: `<#${channel.id}>` }) : t('fivem.status_channel.removed', { name: server.name }))] });
          return;
        }
        case 'players': {
          await interaction.deferReply(ephemeral);
          const server = await fivemService.requireServer(guildId, interaction.options.getString('key', true));
          const players = await fivemService.getPlayers(server);
          if (!players.length) {
            await interaction.editReply({ embeds: [embedService.info(t('fivem.players.empty', { name: server.name }))] });
            return;
          }
          const status = fivemService.getResolvedStatus(server);
          const pages = chunk(players, 20).map((group, i, all) =>
            embedService
              .brand(t('fivem.players.title', { name: server.name, count: players.length }), group.map((p) => `\`${String(p.id).padStart(3, ' ')}\` **${p.name}**${p.ping !== undefined ? ` · ${p.ping} ms` : ''}`).join('\n'))
              .setFooter({ text: `${t('core.page', { current: i + 1, total: all.length })}${status.lastSeenAt ? ` • ${t('fivem.status.last_update')} ${discordTimestamp(status.lastSeenAt, 'R')}` : ''}` }),
          );
          await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
          return;
        }
      }
    } catch (err) {
      if (err instanceof FiveMError) {
        const embeds = [embedService.error(t(`fivem.errors.${err.code}`))];
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
        else await interaction.reply({ embeds, ...ephemeral });
        return;
      }
      throw err;
    }
  },
});
