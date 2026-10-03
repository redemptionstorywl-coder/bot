import { ChannelType, GuildMember, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type GuildBasedChannel } from 'discord.js';
import { defineCommand } from '../../structures';
import type { InteractionContext } from '../../structures/types';
import { embedService, type ButtonSpec, type EmbedSpec, type MessageSpec } from '../../services/EmbedService';
import { EmbedTemplateError, embedTemplateService } from '../../services/EmbedTemplateService';
import { embedBuilderSessions, renderBuilder, renderContextFromInteraction } from '../../services/EmbedBuilderSession';
import { buildMessageWithBrand } from '../../services/AnnouncementService';
import { TEMPLATE_VARIABLES } from '../../config/constants';
import { chunk, paginate } from '../../utils/pagination';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Traduit une erreur du service de templates. */
export function templateErrorMessage(err: unknown, t: InteractionContext['t']): string | null {
  if (err instanceof EmbedTemplateError) return t(`embeds.errors.${err.code}`, { details: err.details ?? '' });
  return null;
}

/**
 * /embed — créateur d'embeds interactif + templates réutilisables.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Créer, modifier et envoyer des embeds personnalisés')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Ouvrir le créateur d’embed interactif')
        .addStringOption((o) => o.setName('template').setDescription('Partir d’un template existant').setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Modifier un embed déjà envoyé par le bot')
        .addStringOption((o) => o.setName('message').setDescription('Lien du message ou ID').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Salon du message (si ID seul)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread)),
    )
    .addSubcommand((s) => s.setName('variables').setDescription('Afficher les variables disponibles ({server}, {user}…)'))
    .addSubcommandGroup((g) =>
      g
        .setName('template')
        .setDescription('Gérer les templates d’embeds')
        .addSubcommand((s) => s.setName('list').setDescription('Lister les templates'))
        .addSubcommand((s) =>
          s
            .setName('delete')
            .setDescription('Supprimer un template')
            .addStringOption((o) => o.setName('name').setDescription('Nom du template').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('preview')
            .setDescription('Prévisualiser un template')
            .addStringOption((o) => o.setName('name').setDescription('Nom du template').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('send')
            .setDescription('Envoyer un template dans un salon')
            .addStringOption((o) => o.setName('name').setDescription('Nom du template').setRequired(true).setAutocomplete(true))
            .addChannelOption((o) => o.setName('channel').setDescription('Salon de destination').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread)),
        ),
    ),
  module: 'embeds',
  permissions: { internal: 'staff', discord: [PermissionFlagsBits.ManageMessages], bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
  cooldown: 2,

  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = interaction.options.getFocused().toLowerCase();
    const templates = await embedTemplateService.list(interaction.guildId);
    const choices = templates
      .filter((tpl) => tpl.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((tpl) => ({ name: tpl.name.slice(0, 100), value: tpl.name }));
    return interaction.respond(choices);
  },

  async execute(interaction, ctx) {
    const { t, config, lang } = ctx;
    if (!interaction.guild || !config) return;
    const guildId = interaction.guild.id;
    await embedTemplateService.ensureDefaults(guildId, interaction.user.id, config.defaultLanguage);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'template') {
        switch (sub) {
          case 'list': {
            const templates = await embedTemplateService.list(guildId);
            if (!templates.length) {
              await interaction.reply({ embeds: [embedService.info(t('embeds.cmd.template_list_empty'))], ...EPHEMERAL });
              return;
            }
            const pages = chunk(templates, 10).map((page, i, all) =>
              embedService
                .brand(t('embeds.cmd.template_list_title', { count: templates.length }))
                .setDescription(page.map((tpl) => `**${tpl.name}**${tpl.description ? ` — ${tpl.description}` : ''}`).join('\n'))
                .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
            );
            await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
            return;
          }
          case 'delete': {
            const name = interaction.options.getString('name', true);
            const tpl = await embedTemplateService.getByName(guildId, name);
            if (!tpl) throw new EmbedTemplateError('not_found', name);
            await embedTemplateService.delete(tpl.id);
            await interaction.reply({ embeds: [embedService.success(t('embeds.cmd.template_deleted', { name }))], ...EPHEMERAL });
            return;
          }
          case 'preview': {
            const name = interaction.options.getString('name', true);
            const tpl = await embedTemplateService.getByName(guildId, name);
            if (!tpl) throw new EmbedTemplateError('not_found', name);
            const spec = embedTemplateService.toMessageSpec(tpl);
            const built = buildMessageWithBrand(spec, { guild: interaction.guild, member: interaction.member instanceof GuildMember ? interaction.member : null, user: interaction.user, language: lang }, config.brandColor);
            await interaction.reply({ content: built.content || undefined, embeds: built.embeds, components: built.components, allowedMentions: { parse: [] }, ...EPHEMERAL });
            return;
          }
          case 'send': {
            const name = interaction.options.getString('name', true);
            const channel = interaction.options.getChannel('channel', true) as GuildBasedChannel;
            const tpl = await embedTemplateService.getByName(guildId, name);
            if (!tpl) throw new EmbedTemplateError('not_found', name);
            await interaction.deferReply(EPHEMERAL);
            const spec: MessageSpec = embedTemplateService.toMessageSpec(tpl);
            const message = await embedTemplateService.sendSpec(guildId, channel.id, spec, {
              client: interaction.client,
              guild: interaction.guild,
              member: interaction.member instanceof GuildMember ? interaction.member : null,
              user: interaction.user,
              language: lang,
            });
            await interaction.editReply({ embeds: [embedService.success(t('embeds.cmd.sent', { channel: `<#${channel.id}>`, url: message.url }))] });
            return;
          }
        }
        return;
      }

      switch (sub) {
        case 'variables': {
          const embed = embedService.brand(t('embeds.cmd.variables_title'), t('embeds.cmd.variables_desc')).addFields(
            Object.entries(TEMPLATE_VARIABLES).map(([k, v]) => ({ name: `\`${k}\``, value: v, inline: true })),
          );
          await interaction.reply({ embeds: [embed], ...EPHEMERAL });
          return;
        }
        case 'create': {
          const templateName = interaction.options.getString('template');
          let spec: EmbedSpec = {};
          let buttons: ButtonSpec[] | undefined;
          if (templateName) {
            const tpl = await embedTemplateService.getByName(guildId, templateName);
            if (!tpl) throw new EmbedTemplateError('not_found', templateName);
            const ms = embedTemplateService.toMessageSpec(tpl);
            spec = ms.embeds?.[0] ?? {};
            buttons = ms.buttons;
          }
          const session = embedBuilderSessions.create({ guildId, userId: interaction.user.id, mode: 'embed', spec, buttons });
          await interaction.reply({ ...renderBuilder(session, renderContextFromInteraction(interaction, ctx)), ...EPHEMERAL });
          return;
        }
        case 'edit': {
          const ref = embedTemplateService.parseMessageReference(interaction.options.getString('message', true), interaction.options.getChannel('channel')?.id ?? interaction.channelId);
          if (!ref || !ref.channelId) {
            await interaction.reply({ embeds: [embedService.error(t('embeds.errors.invalid_reference'))], ...EPHEMERAL });
            return;
          }
          await interaction.deferReply(EPHEMERAL);
          const message = await embedTemplateService.fetchBotMessage(ref.channelId, ref.messageId, { client: interaction.client });
          if (message.guildId !== guildId) throw new EmbedTemplateError('message_not_found', ref.messageId);
          const first = message.embeds[0];
          if (!first) throw new EmbedTemplateError('no_embed', ref.messageId);
          const session = embedBuilderSessions.create({
            guildId,
            userId: interaction.user.id,
            mode: 'embed',
            spec: embedService.fromApiEmbed(first.toJSON()),
            content: message.content || undefined,
            buttons: embedTemplateService.buttonsFromMessage(message),
            target: { channelId: ref.channelId, messageId: ref.messageId },
          });
          await interaction.editReply(renderBuilder(session, renderContextFromInteraction(interaction, ctx)));
          return;
        }
      }
    } catch (err) {
      const msg = templateErrorMessage(err, t);
      if (!msg) throw err;
      const embeds = [embedService.error(msg)];
      if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
      else await interaction.reply({ embeds, ...EPHEMERAL });
    }
  },
});
