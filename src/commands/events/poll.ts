import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PollType } from '@prisma/client';
import { defineCommand, type InteractionContext } from '../../structures';
import { parseOptionsInput, parsePollOptions, pollService, type PollOption, type PollResults, type PollWithVotes } from '../../services/PollService';
import { embedService } from '../../services/EmbedService';
import { translationService, type Translator } from '../../services/TranslationService';
import { discordTimestamp, parseDuration } from '../../utils/time';
import { chunk, paginate } from '../../utils/pagination';

const fr = (key: string) => translationService.translate('fr', key);
const en = (key: string) => ({ 'en-US': translationService.translate('en', key), 'en-GB': translationService.translate('en', key) });
const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const MAX_DURATION_SECONDS = 30 * 86400; // 30 jours

export function buildPollListPages(polls: PollWithVotes[], t: Translator, serverName: string) {
  if (!polls.length) return [embedService.brand(t('polls.list.title', { server: serverName }), t('polls.list.empty'))];
  return chunk(polls, 10).map((page, i, all) =>
    embedService
      .brand(
        t('polls.list.title', { server: serverName }),
        page
          .map((p) => {
            const voters = new Set(p.votes.map((v) => v.userId)).size;
            const question = p.question.length > 60 ? `${p.question.slice(0, 57)}…` : p.question;
            return p.ended
              ? t('polls.list.line_ended', { id: p.id, question, count: voters })
              : t('polls.list.line_active', { id: p.id, question, count: voters, ends: p.endsAt ? t('polls.list.ends_suffix', { when: discordTimestamp(p.endsAt, 'R') }) : '' });
          })
          .join('\n'),
      )
      .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
  );
}

/**
 * Pages de résultats détaillés : page 1 = synthèse par option ; pages suivantes = votants par option
 * (uniquement pour les sondages non anonymes).
 */
export function buildPollResultsPages(poll: PollWithVotes, options: PollOption[], results: PollResults, voters: string[][] | null, t: Translator) {
  const title = t('polls.results.title', { question: poll.question.slice(0, 200) });
  const summary = embedService.brand(
    title,
    options.map((o, i) => `${o.emoji ?? '•'} **${o.label}**\n\`${results.bars[i]}\` ${t('polls.results.option_votes', { percent: results.percentages[i], count: results.counts[i] })}`).join('\n\n'),
  );
  summary.setFooter({ text: `${t('polls.results.summary', { voters: results.voters, total: results.total })}${poll.anonymous ? ` • ${t('polls.embed.anonymous')}` : ''}` });
  if (!voters) {
    summary.addFields({ name: '​', value: t('polls.results.anonymous_notice') });
    return [summary];
  }
  const pages = [summary];
  options.forEach((o, i) => {
    const list = voters[i] ?? [];
    const groups = list.length ? chunk(list, 30) : [[]];
    for (const group of groups) {
      pages.push(
        embedService
          .brand(t('polls.results.voters_for', { option: o.label }), group.length ? group.map((id) => `<@${id}>`).join(', ') : t('polls.results.no_voters'))
          .setFooter({ text: t('polls.embed.votes', { count: list.length }) }),
      );
    }
  });
  return pages.map((e, i) => e.setFooter({ text: `${e.data.footer?.text ?? ''} • ${t('core.page', { current: i + 1, total: pages.length })}` }));
}

async function notFound(interaction: ChatInputCommandInteraction, t: Translator, id: number) {
  await interaction.reply({ embeds: [embedService.error(t('polls.not_found', { id }))], ...EPHEMERAL });
}

const idOption = (o: import('discord.js').SlashCommandIntegerOption) =>
  o.setName('id').setDescription(fr('polls.commands.id')).setDescriptionLocalizations(en('polls.commands.id')).setRequired(true).setMinValue(1);

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription(fr('polls.commands.description'))
    .setDescriptionLocalizations(en('polls.commands.description'))
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription(fr('polls.commands.create'))
        .setDescriptionLocalizations(en('polls.commands.create'))
        .addStringOption((o) => o.setName('question').setDescription(fr('polls.commands.question')).setDescriptionLocalizations(en('polls.commands.question')).setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('options').setDescription(fr('polls.commands.options')).setDescriptionLocalizations(en('polls.commands.options')).setMaxLength(1000))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription(fr('polls.commands.type'))
            .setDescriptionLocalizations(en('polls.commands.type'))
            .addChoices(
              { name: fr('polls.commands.type_yes_no'), name_localizations: en('polls.commands.type_yes_no'), value: 'yes_no' },
              { name: fr('polls.commands.type_multiple'), name_localizations: en('polls.commands.type_multiple'), value: 'multiple' },
            ),
        )
        .addBooleanOption((o) => o.setName('anonymous').setDescription(fr('polls.commands.anonymous')).setDescriptionLocalizations(en('polls.commands.anonymous')))
        .addBooleanOption((o) => o.setName('multi_select').setDescription(fr('polls.commands.multi_select')).setDescriptionLocalizations(en('polls.commands.multi_select')))
        .addStringOption((o) => o.setName('duration').setDescription(fr('polls.commands.duration')).setDescriptionLocalizations(en('polls.commands.duration')))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription(fr('polls.commands.channel'))
            .setDescriptionLocalizations(en('polls.commands.channel'))
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) => s.setName('end').setDescription(fr('polls.commands.end')).setDescriptionLocalizations(en('polls.commands.end')).addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('results').setDescription(fr('polls.commands.results')).setDescriptionLocalizations(en('polls.commands.results')).addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('list').setDescription(fr('polls.commands.list')).setDescriptionLocalizations(en('polls.commands.list'))),
  module: 'polls',
  permissions: { internal: 'staff', bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
  cooldown: 2,
  async execute(interaction, ctx: InteractionContext) {
    const { t, config } = ctx;
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    switch (sub) {
      case 'create': {
        const question = interaction.options.getString('question', true);
        const optionsRaw = interaction.options.getString('options');
        const typeRaw = interaction.options.getString('type');
        const anonymous = interaction.options.getBoolean('anonymous') ?? false;
        const multiSelect = interaction.options.getBoolean('multi_select') ?? false;
        const durationRaw = interaction.options.getString('duration');
        const channel = interaction.options.getChannel('channel') ?? interaction.channel;

        const type: PollType = typeRaw === 'yes_no' || (!typeRaw && !optionsRaw) ? PollType.YES_NO : PollType.MULTIPLE;
        let options: PollOption[] | undefined;
        if (type === PollType.MULTIPLE) {
          if (!optionsRaw) {
            await interaction.reply({ embeds: [embedService.error(t('polls.create.options_required'))], ...EPHEMERAL });
            return;
          }
          const parsed = parseOptionsInput(optionsRaw);
          if (!parsed) {
            await interaction.reply({ embeds: [embedService.error(t('polls.create.invalid_options'))], ...EPHEMERAL });
            return;
          }
          options = parsed;
        }
        let endsAt: Date | null = null;
        if (durationRaw) {
          const seconds = parseDuration(durationRaw);
          if (!seconds || seconds > MAX_DURATION_SECONDS) {
            await interaction.reply({ embeds: [embedService.error(t('polls.create.invalid_duration', { value: durationRaw }))], ...EPHEMERAL });
            return;
          }
          endsAt = new Date(Date.now() + seconds * 1000);
        }
        if (!channel || !('send' in channel) || channel.isDMBased()) {
          await interaction.reply({ embeds: [embedService.error(t('polls.create.channel_invalid'))], ...EPHEMERAL });
          return;
        }
        await interaction.deferReply(EPHEMERAL);
        const poll = await pollService.create(guildId, { question, channelId: channel.id, options, type, anonymous, multiSelect, endsAt }, interaction.user.id);
        await interaction.editReply({ embeds: [embedService.success(t('polls.create.success', { channel: channel.id, id: poll.id }))] });
        return;
      }
      case 'end': {
        const id = interaction.options.getInteger('id', true);
        const poll = await pollService.get(id);
        if (!poll || poll.guildId !== guildId) return notFound(interaction, t, id);
        if (poll.ended) {
          await interaction.reply({ embeds: [embedService.warning(t('polls.end.already_ended'))], ...EPHEMERAL });
          return;
        }
        await interaction.deferReply(EPHEMERAL);
        const ended = await pollService.end(id, interaction.user.id);
        const voters = new Set((ended ?? poll).votes.map((v) => v.userId)).size;
        await interaction.editReply({ embeds: [embedService.success(t('polls.end.success', { id, count: voters }))] });
        return;
      }
      case 'results': {
        const id = interaction.options.getInteger('id', true);
        const data = await pollService.results(id);
        if (!data || data.poll.guildId !== guildId) return notFound(interaction, t, id);
        await interaction.deferReply(EPHEMERAL);
        const options = data.options.length ? data.options : parsePollOptions(data.poll.options);
        await paginate(interaction, { pages: buildPollResultsPages(data.poll, options, data.results, data.voters, t), userId: interaction.user.id, ephemeral: true });
        return;
      }
      case 'list': {
        await interaction.deferReply(EPHEMERAL);
        const polls = await pollService.list(guildId);
        await paginate(interaction, { pages: buildPollListPages(polls, t, interaction.guild.name), userId: interaction.user.id, ephemeral: true });
        return;
      }
    }
  },
});
