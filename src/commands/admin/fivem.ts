import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { FiveMFramework } from '@prisma/client';
import { defineCommand } from '../../structures';
import { ZodError } from 'zod';
import type { FiveMServer } from '@prisma/client';
import { fivemService, FiveMError } from '../../services/FiveMService';
import { fivemSyncService } from '../../services/FiveMSyncService';
import { BattleRoyaleError } from '../../services/BattleRoyaleService';
import type { SyncSettingsPatch } from '../../services/fivem/sync';
import type { Translator } from '../../services/TranslationService';
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
    .addSubcommand((s) => s.setName('players').setDescription('Joueurs connectés').addStringOption((o) => o.setName('key').setDescription('Clé du serveur').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) =>
      s
        .setName('sync')
        .setDescription('Synchronisation jeu ⇄ Discord (sans option = afficher)')
        .addStringOption((o) => o.setName('key').setDescription('Clé du serveur').setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName('bans_to_discord').setDescription('Ban en jeu → ban Discord'))
        .addBooleanOption((o) => o.setName('bans_to_game').setDescription('Ban Discord → ban en jeu'))
        .addBooleanOption((o) => o.setName('kicks').setDescription('Kick en jeu → kick Discord'))
        .addBooleanOption((o) => o.setName('nicknames').setDescription('Pseudo en jeu → surnom Discord'))
        .addStringOption((o) => o.setName('nickname_format').setDescription('Format du surnom : {name} {id} {level}').setMaxLength(64))
        .addRoleOption((o) => o.setName('linked_role').setDescription('Rôle donné quand le compte est lié'))
        .addRoleOption((o) => o.setName('online_role').setDescription('Rôle « En jeu »'))
        .addChannelOption((o) => o.setName('counter_channel').setDescription('Salon vocal / catégorie renommé avec le nombre de joueurs').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildCategory))
        .addBooleanOption((o) => o.setName('require_discord').setDescription('Refuser la connexion sans Discord lié / membre'))
        .addRoleOption((o) => o.setName('require_role').setDescription('Rôle Discord requis pour se connecter'))
        .addBooleanOption((o) => o.setName('require_whitelist').setDescription('Whitelist acceptée requise pour se connecter'))
        .addStringOption((o) =>
          o
            .setName('clear')
            .setDescription('Retirer un rôle / salon configuré')
            .addChoices(
              { name: 'linked_role', value: 'linkedRoleId' },
              { name: 'online_role', value: 'onlineRoleId' },
              { name: 'counter_channel', value: 'playerCountChannelId' },
              { name: 'require_role', value: 'requireRoleId' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('link')
        .setDescription('Lier manuellement un membre à une licence FiveM')
        .addUserOption((o) => o.setName('member').setDescription('Membre Discord').setRequired(true))
        .addStringOption((o) => o.setName('license').setDescription('license:xxxxxxxx…').setRequired(true).setMaxLength(128)),
    ),
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
          const links = await fivemSyncService.discordIdsFor(guildId, players);
          const pages = chunk(players, 20).map((group, i, all) =>
            embedService
              .brand(
                t('fivem.players.title', { name: server.name, count: players.length }),
                group
                  .map((p) => {
                    const discordId = links.get(p.id);
                    return `\`${String(p.id).padStart(3, ' ')}\` **${p.name}**${p.ping !== undefined ? ` · ${p.ping} ms` : ''} · ${discordId ? `<@${discordId}>` : t('fivem.players.not_linked')}`;
                  })
                  .join('\n'),
              )
              .setFooter({ text: `${t('core.page', { current: i + 1, total: all.length })}${status.lastSeenAt ? ` • ${t('fivem.status.last_update')} ${discordTimestamp(status.lastSeenAt, 'R')}` : ''}` }),
          );
          await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
          return;
        }
        case 'sync': {
          const key = interaction.options.getString('key', true);
          const o = interaction.options;
          const patch: SyncSettingsPatch = {};
          const bool = (name: string, field: keyof SyncSettingsPatch) => {
            const v = o.getBoolean(name);
            if (v !== null) (patch as Record<string, unknown>)[field] = v;
          };
          bool('bans_to_discord', 'syncBansToDiscord');
          bool('bans_to_game', 'syncBansToGame');
          bool('kicks', 'syncKicks');
          bool('nicknames', 'syncNicknames');
          bool('require_discord', 'requireDiscord');
          bool('require_whitelist', 'requireWhitelist');
          const format = o.getString('nickname_format');
          if (format !== null) patch.nicknameFormat = format;
          const linkedRole = o.getRole('linked_role');
          if (linkedRole) patch.linkedRoleId = linkedRole.id;
          const onlineRole = o.getRole('online_role');
          if (onlineRole) patch.onlineRoleId = onlineRole.id;
          const requireRole = o.getRole('require_role');
          if (requireRole) patch.requireRoleId = requireRole.id;
          const counter = o.getChannel('counter_channel');
          if (counter) patch.playerCountChannelId = counter.id;
          const clear = o.getString('clear') as 'linkedRoleId' | 'onlineRoleId' | 'playerCountChannelId' | 'requireRoleId' | null;
          if (clear) patch[clear] = null;
          const changed = Object.keys(patch).length > 0;
          if (changed) await interaction.deferReply(ephemeral);
          const server = changed ? await fivemSyncService.updateSyncSettings(guildId, key, patch) : await fivemService.requireServer(guildId, key);
          const embed = buildSyncEmbed(server, t, changed);
          if (changed) await interaction.editReply({ embeds: [embed] });
          else await interaction.reply({ embeds: [embed], ...ephemeral });
          return;
        }
        case 'link': {
          const user = interaction.options.getUser('member', true);
          if (user.bot) return fail('fivem.link.bot');
          const license = interaction.options.getString('license', true).trim();
          if (!/^license2?:[a-z0-9]{8,64}$/i.test(license)) return fail('fivem.link.invalid');
          await fivemSyncService.linkManually(guildId, user.id, license, interaction.user.id);
          await interaction.reply({ embeds: [embedService.success(t('fivem.link.done', { user: `<@${user.id}>`, license }))], ...ephemeral });
          return;
        }
      }
    } catch (err) {
      if (err instanceof ZodError) {
        const embeds = [embedService.error(t('fivem.sync.invalid', { details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500) }))];
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
        else await interaction.reply({ embeds, ...ephemeral });
        return;
      }
      if (err instanceof BattleRoyaleError) {
        const embeds = [embedService.error(t(`battleroyale.errors.${err.code}`))];
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
        else await interaction.reply({ embeds, ...ephemeral });
        return;
      }
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

/** Récapitulatif des options de synchronisation d'un serveur. */
function buildSyncEmbed(server: FiveMServer, t: Translator, updated: boolean) {
  const yes = (v: boolean) => (v ? `✅ ${t('fivem.sync.on')}` : `➖ ${t('fivem.sync.off')}`);
  const role = (id: string | null) => (id ? `<@&${id}>` : '—');
  return embedService
    .brand(t(updated ? 'fivem.sync.updated' : 'fivem.sync.title', { name: server.name }))
    .addFields(
      { name: t('fivem.sync.bans_to_discord'), value: yes(server.syncBansToDiscord), inline: true },
      { name: t('fivem.sync.bans_to_game'), value: yes(server.syncBansToGame), inline: true },
      { name: t('fivem.sync.kicks'), value: yes(server.syncKicks), inline: true },
      { name: t('fivem.sync.nicknames'), value: `${yes(server.syncNicknames)}\n\`${server.nicknameFormat}\``, inline: true },
      { name: t('fivem.sync.linked_role'), value: role(server.linkedRoleId), inline: true },
      { name: t('fivem.sync.online_role'), value: role(server.onlineRoleId), inline: true },
      { name: t('fivem.sync.counter_channel'), value: server.playerCountChannelId ? `<#${server.playerCountChannelId}>` : '—', inline: true },
      { name: t('fivem.sync.require_discord'), value: yes(server.requireDiscord), inline: true },
      { name: t('fivem.sync.require_role'), value: role(server.requireRoleId), inline: true },
      { name: t('fivem.sync.require_whitelist'), value: yes(server.requireWhitelist), inline: true },
    )
    .setFooter({ text: t('fivem.sync.footer') });
}
