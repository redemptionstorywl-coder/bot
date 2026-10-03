import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { PanelStyle } from '@prisma/client';
import { defineCommand } from '../../structures';
import { embedService, type EmbedSpec } from '../../services/EmbedService';
import { TicketError, ticketService } from '../../services/TicketService';
import { EPHEMERAL, replyTicketError } from './_shared';

/**
 * /ticket-panel — publie / liste / supprime les panneaux d'ouverture de tickets.
 * À la première utilisation, les types par défaut sont créés si le serveur n'en a aucun.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Gérer les panneaux d’ouverture de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Publier un panneau de tickets')
        .addChannelOption((o) => o.setName('channel').setDescription('Salon où publier').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName('style').setDescription('Bouton unique ou menu déroulant').addChoices({ name: '🎫 Bouton « Ouvrir un ticket »', value: 'buttons' }, { name: '📋 Menu déroulant des types', value: 'select' }))
        .addStringOption((o) => o.setName('types').setDescription('Clés des types, séparées par des virgules (vide = tous)').setMaxLength(400))
        .addStringOption((o) => o.setName('title').setDescription('Titre de l’embed ({server})').setMaxLength(256))
        .addStringOption((o) => o.setName('description').setDescription('Description de l’embed').setMaxLength(4000))
        .addStringOption((o) => o.setName('color').setDescription('Couleur hex (#7C3AED)').setMaxLength(7))
        .addStringOption((o) => o.setName('image').setDescription('URL d’image').setMaxLength(2048))
        .addStringOption((o) => o.setName('thumbnail').setDescription('URL de miniature').setMaxLength(2048)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Lister les panneaux'))
    .addSubcommand((s) => s.setName('delete').setDescription('Supprimer un panneau').addIntegerOption((o) => o.setName('id').setDescription('ID du panneau').setRequired(true).setMinValue(1))),
  module: 'tickets',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.Administrator], bot: [PermissionFlagsBits.ManageChannels] },
  cooldown: 3,
  async execute(interaction, ctx) {
    const { t, config, lang } = ctx;
    if (!interaction.inCachedGuild() || !config) return;
    const guildId = interaction.guildId;
    const o = interaction.options;
    try {
      switch (o.getSubcommand()) {
        case 'create': {
          await interaction.deferReply(EPHEMERAL);
          const channel = o.getChannel('channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
          const style = o.getString('style') === 'select' ? PanelStyle.SELECT : PanelStyle.BUTTONS;
          const seeded = await ticketService.ensureDefaultTypes(guildId, config.defaultLanguage);
          const all = await ticketService.listTypes(guildId, { enabledOnly: true });
          if (!all.length) throw new TicketError('no_types');
          const wanted = (o.getString('types') ?? '')
            .split(',')
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean);
          const unknown = wanted.filter((k) => !all.some((ty) => ty.key === k));
          if (unknown.length) throw new TicketError('unknown_types', { keys: unknown.join(', ') });
          const typeIds = wanted.length ? wanted.map((k) => all.find((ty) => ty.key === k)!.id) : [];

          const defaults = ticketService.defaultPanelEmbed(t);
          const spec: EmbedSpec = {
            title: o.getString('title') ?? defaults.title,
            description: o.getString('description') ?? defaults.description,
            footer: defaults.footer,
          };
          const color = o.getString('color');
          if (color) spec.color = color.startsWith('#') ? color : `#${color}`;
          const image = o.getString('image');
          if (image) spec.image = image;
          const thumbnail = o.getString('thumbnail');
          if (thumbnail) spec.thumbnail = thumbnail;
          const valid = embedService.safeValidate(spec);
          if (!valid.success) throw new TicketError('invalid_embed', { details: valid.error });

          const panel = await ticketService.createPanel({ guild: interaction.guild, channel, style, typeIds, embed: valid.data, lang, brandColor: config.brandColor });
          const count = typeIds.length || all.length;
          const lines = [t('tickets.panel.created', { channel: `<#${channel.id}>`, id: panel.id, count })];
          if (seeded) lines.unshift(t('tickets.panel.seeded', { count: seeded }));
          await interaction.editReply({ embeds: [embedService.success(lines.join('\n'))] });
          return;
        }
        case 'delete': {
          await interaction.deferReply(EPHEMERAL);
          const id = o.getInteger('id', true);
          await ticketService.deletePanel(guildId, id);
          await interaction.editReply({ embeds: [embedService.success(t('tickets.panel.deleted', { id }))] });
          return;
        }
        case 'list':
        default: {
          await interaction.deferReply(EPHEMERAL);
          const panels = await ticketService.listPanels(guildId);
          if (!panels.length) {
            await interaction.editReply({ embeds: [embedService.info(t('tickets.panel.list_empty'))] });
            return;
          }
          const all = await ticketService.listTypes(guildId, { enabledOnly: true });
          const lines = panels.map((p) => {
            const ids = Array.isArray(p.typeIds) ? (p.typeIds as number[]) : [];
            return t('tickets.panel.list_line', { id: p.id, channel: `<#${p.channelId}>`, style: p.style, count: ids.length || all.length });
          });
          await interaction.editReply({ embeds: [embedService.brand(t('tickets.panel.list_title'), lines.join('\n'))] });
          return;
        }
      }
    } catch (err) {
      if (await replyTicketError(interaction, t, err)) return;
      throw err;
    }
  },
});
