import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { EventStatus } from '@prisma/client';
import { defineCommand, type InteractionContext } from '../../structures';
import { eventService, type EventWithParticipants } from '../../services/EventService';
import { embedService } from '../../services/EmbedService';
import { translationService, type Translator } from '../../services/TranslationService';
import { LANGUAGES } from '../../config/constants';
import { buildCustomId } from '../../utils/customId';
import { discordTimestamp } from '../../utils/time';
import { chunk, paginate } from '../../utils/pagination';

const fr = (key: string) => translationService.translate('fr', key);
const en = (key: string) => ({ 'en-US': translationService.translate('en', key), 'en-GB': translationService.translate('en', key) });

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Modal de création / édition (5 champs max). Pré-remplie avec `event` en édition. */
export function buildEventModal(t: Translator, customId: string, event?: EventWithParticipants): ModalBuilder {
  const text = (id: string, label: string, style: TextInputStyle, required: boolean, placeholder: string, value?: string | null, max = 200) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required).setPlaceholder(placeholder.slice(0, 100)).setMaxLength(max);
    if (value) input.setValue(value.slice(0, max));
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  };
  const startValue = event ? formatDateForInput(event.startsAt) : undefined;
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle((event ? t('events.modal.edit_title', { id: event.id }) : t('events.modal.create_title')).slice(0, 45))
    .addComponents(
      text('name', t('events.modal.name'), TextInputStyle.Short, true, t('events.modal.name_placeholder'), event?.name, 100),
      text('description', t('events.modal.description'), TextInputStyle.Paragraph, true, t('events.modal.description_placeholder'), event?.description, 2000),
      text('date', t('events.modal.date'), TextInputStyle.Short, true, t('events.modal.date_placeholder'), startValue, 40),
      text('location', t('events.modal.location'), TextInputStyle.Short, false, t('events.modal.location_placeholder'), event?.location, 100),
      text('max', t('events.modal.max'), TextInputStyle.Short, false, t('events.modal.max_placeholder'), event?.maxParticipants ? String(event.maxParticipants) : undefined, 5),
    );
}

/** `31/01/2025 20:00` (heure locale du processus) pour pré-remplir la modal d'édition. */
export function formatDateForInput(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function buildEventListPages(events: EventWithParticipants[], t: Translator, serverName: string) {
  if (!events.length) return [embedService.brand(t('events.list.title', { server: serverName }), t('events.list.empty'))];
  return chunk(events, 10).map((page, i, all) =>
    embedService
      .brand(
        t('events.list.title', { server: serverName }),
        page.map((e) => t('events.list.line', { emoji: eventService.statusEmoji(e.status), id: e.id, name: e.name, when: discordTimestamp(e.startsAt, 'R'), count: e.participants.length })).join('\n'),
      )
      .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
  );
}

export function buildParticipantsPages(event: EventWithParticipants, t: Translator) {
  const title = t('events.participants.title', { name: event.name });
  if (!event.participants.length) return [embedService.brand(title, t('events.participants.empty'))];
  return chunk(event.participants, 20).map((page, i, all) =>
    embedService
      .brand(title, page.map((p, j) => `\`${i * 20 + j + 1}.\` <@${p.userId}> — ${discordTimestamp(p.joinedAt, 'R')}`).join('\n'))
      .setFooter({ text: `${t('events.participants.count', { count: event.participants.length })} • ${t('core.page', { current: i + 1, total: all.length })}` }),
  );
}

async function notFound(interaction: ChatInputCommandInteraction, t: Translator, id: number) {
  await interaction.reply({ embeds: [embedService.error(t('events.not_found', { id }))], ...EPHEMERAL });
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription(fr('events.commands.description'))
    .setDescriptionLocalizations(en('events.commands.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription(fr('events.commands.create'))
        .setDescriptionLocalizations(en('events.commands.create'))
        .addStringOption((o) => o.setName('image').setDescription(fr('events.commands.create_image')).setDescriptionLocalizations(en('events.commands.create_image')))
        .addRoleOption((o) => o.setName('role').setDescription(fr('events.commands.create_role')).setDescriptionLocalizations(en('events.commands.create_role')))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription(fr('events.commands.create_channel'))
            .setDescriptionLocalizations(en('events.commands.create_channel'))
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addStringOption((o) =>
          o
            .setName('language')
            .setDescription(fr('events.commands.create_language'))
            .setDescriptionLocalizations(en('events.commands.create_language'))
            .addChoices(...LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription(fr('events.commands.edit'))
        .setDescriptionLocalizations(en('events.commands.edit'))
        .addIntegerOption((o) => o.setName('id').setDescription(fr('events.commands.id')).setDescriptionLocalizations(en('events.commands.id')).setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription(fr('events.commands.cancel'))
        .setDescriptionLocalizations(en('events.commands.cancel'))
        .addIntegerOption((o) => o.setName('id').setDescription(fr('events.commands.id')).setDescriptionLocalizations(en('events.commands.id')).setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription(fr('events.commands.list'))
        .setDescriptionLocalizations(en('events.commands.list'))
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription(fr('events.commands.list_status'))
            .setDescriptionLocalizations(en('events.commands.list_status'))
            .addChoices(
              { name: fr('events.list.filter_all'), name_localizations: en('events.list.filter_all'), value: 'all' },
              { name: fr('events.list.filter_scheduled'), name_localizations: en('events.list.filter_scheduled'), value: EventStatus.SCHEDULED },
              { name: fr('events.list.filter_ongoing'), name_localizations: en('events.list.filter_ongoing'), value: EventStatus.ONGOING },
              { name: fr('events.list.filter_ended'), name_localizations: en('events.list.filter_ended'), value: EventStatus.ENDED },
              { name: fr('events.list.filter_cancelled'), name_localizations: en('events.list.filter_cancelled'), value: EventStatus.CANCELLED },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('participants')
        .setDescription(fr('events.commands.participants'))
        .setDescriptionLocalizations(en('events.commands.participants'))
        .addIntegerOption((o) => o.setName('id').setDescription(fr('events.commands.id')).setDescriptionLocalizations(en('events.commands.id')).setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('remind')
        .setDescription(fr('events.commands.remind'))
        .setDescriptionLocalizations(en('events.commands.remind'))
        .addIntegerOption((o) => o.setName('id').setDescription(fr('events.commands.id')).setDescriptionLocalizations(en('events.commands.id')).setRequired(true).setMinValue(1)),
    ),
  module: 'events',
  permissions: { internal: 'staff', bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
  cooldown: 2,
  async execute(interaction, ctx: InteractionContext) {
    const { t, config } = ctx;
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    switch (sub) {
      case 'create': {
        const image = interaction.options.getString('image');
        const role = interaction.options.getRole('role');
        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        const language = interaction.options.getString('language');
        if (image && !/^https?:\/\/\S+$/i.test(image)) {
          await interaction.reply({ embeds: [embedService.error(t('events.create.invalid_image'))], ...EPHEMERAL });
          return;
        }
        if (!channel || !('send' in channel) || channel.isDMBased()) {
          await interaction.reply({ embeds: [embedService.error(t('events.create.channel_invalid'))], ...EPHEMERAL });
          return;
        }
        eventService.stashOptions(interaction.user.id, { guildId, channelId: channel.id, imageUrl: image, mentionRoleId: role?.id ?? null, language });
        await interaction.showModal(buildEventModal(t, buildCustomId('event', 'create')));
        return;
      }
      case 'edit': {
        const id = interaction.options.getInteger('id', true);
        const event = await eventService.get(id);
        if (!event || event.guildId !== guildId) return notFound(interaction, t, id);
        if (event.status === EventStatus.ENDED || event.status === EventStatus.CANCELLED) {
          await interaction.reply({ embeds: [embedService.warning(t('events.edit.not_editable'))], ...EPHEMERAL });
          return;
        }
        await interaction.showModal(buildEventModal(t, buildCustomId('event', 'edit', id), event));
        return;
      }
      case 'cancel': {
        const id = interaction.options.getInteger('id', true);
        const event = await eventService.get(id);
        if (!event || event.guildId !== guildId) return notFound(interaction, t, id);
        if (event.status === EventStatus.CANCELLED) {
          await interaction.reply({ embeds: [embedService.warning(t('events.cancel.already'))], ...EPHEMERAL });
          return;
        }
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(buildCustomId('event', 'cancel_confirm', id, interaction.user.id)).setLabel(t('events.cancel.button')).setStyle(ButtonStyle.Danger).setEmoji('⛔'),
          new ButtonBuilder().setCustomId(buildCustomId('event', 'cancel_abort', id, interaction.user.id)).setLabel(t('events.cancel.keep')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({
          embeds: [embedService.warning(t('events.cancel.confirm', { name: event.name, count: event.participants.length }), t('events.cancel.confirm_title'))],
          components: [row],
          ...EPHEMERAL,
        });
        return;
      }
      case 'list': {
        await interaction.deferReply(EPHEMERAL);
        const filter = interaction.options.getString('status') ?? 'all';
        const events = await eventService.list(guildId, filter === 'all' ? undefined : (filter as EventStatus));
        await paginate(interaction, { pages: buildEventListPages(events, t, interaction.guild.name), userId: interaction.user.id, ephemeral: true });
        return;
      }
      case 'participants': {
        const id = interaction.options.getInteger('id', true);
        const event = await eventService.get(id);
        if (!event || event.guildId !== guildId) return notFound(interaction, t, id);
        await interaction.deferReply(EPHEMERAL);
        await paginate(interaction, { pages: buildParticipantsPages(event, t), userId: interaction.user.id, ephemeral: true });
        return;
      }
      case 'remind': {
        const id = interaction.options.getInteger('id', true);
        const event = await eventService.get(id);
        if (!event || event.guildId !== guildId) return notFound(interaction, t, id);
        await interaction.deferReply(EPHEMERAL);
        const sent = await eventService.remind(id);
        await interaction.editReply({ embeds: [sent ? embedService.success(t('events.remind.success', { name: event.name })) : embedService.warning(t('events.remind.unavailable'))] });
        return;
      }
    }
  },
});
