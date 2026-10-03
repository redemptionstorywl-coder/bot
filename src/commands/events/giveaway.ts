import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { defineCommand, type InteractionContext } from '../../structures';
import { asStringArray, giveawayService, type GiveawayWithEntries } from '../../services/GiveawayService';
import { embedService } from '../../services/EmbedService';
import { translationService, type Translator } from '../../services/TranslationService';
import { LANGUAGES } from '../../config/constants';
import { discordTimestamp, parseDuration } from '../../utils/time';
import { chunk, paginate } from '../../utils/pagination';

const fr = (key: string) => translationService.translate('fr', key);
const en = (key: string) => ({ 'en-US': translationService.translate('en', key), 'en-GB': translationService.translate('en', key) });
const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const MAX_DURATION_SECONDS = 60 * 86400; // 60 jours

export function buildGiveawayListPages(giveaways: GiveawayWithEntries[], t: Translator, serverName: string) {
  if (!giveaways.length) return [embedService.brand(t('giveaways.list.title', { server: serverName }), t('giveaways.list.empty'))];
  return chunk(giveaways, 10).map((page, i, all) =>
    embedService
      .brand(
        t('giveaways.list.title', { server: serverName }),
        page
          .map((g) => {
            const winners = asStringArray(g.winners);
            return g.ended
              ? t('giveaways.list.line_ended', { id: g.id, prize: g.prize, when: discordTimestamp(g.endsAt, 'R'), winners: winners.length ? winners.map((w) => `<@${w}>`).join(', ') : t('giveaways.embed.no_winner') })
              : t('giveaways.list.line_active', { id: g.id, prize: g.prize, when: discordTimestamp(g.endsAt, 'R'), count: g.entries.length });
          })
          .join('\n'),
      )
      .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
  );
}

async function notFound(interaction: ChatInputCommandInteraction, t: Translator, id: number) {
  const payload = { embeds: [embedService.error(t('giveaways.not_found', { id }))] };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, ...EPHEMERAL });
}

const idOption = (o: import('discord.js').SlashCommandIntegerOption) =>
  o.setName('id').setDescription(fr('giveaways.commands.id')).setDescriptionLocalizations(en('giveaways.commands.id')).setRequired(true).setMinValue(1);

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription(fr('giveaways.commands.description'))
    .setDescriptionLocalizations(en('giveaways.commands.description'))
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription(fr('giveaways.commands.create'))
        .setDescriptionLocalizations(en('giveaways.commands.create'))
        .addStringOption((o) => o.setName('prize').setDescription(fr('giveaways.commands.prize')).setDescriptionLocalizations(en('giveaways.commands.prize')).setRequired(true).setMaxLength(190))
        .addStringOption((o) => o.setName('duration').setDescription(fr('giveaways.commands.duration')).setDescriptionLocalizations(en('giveaways.commands.duration')).setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription(fr('giveaways.commands.winners')).setDescriptionLocalizations(en('giveaways.commands.winners')).setRequired(true).setMinValue(1).setMaxValue(50))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription(fr('giveaways.commands.channel'))
            .setDescriptionLocalizations(en('giveaways.commands.channel'))
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption((o) => o.setName('required_role').setDescription(fr('giveaways.commands.required_role')).setDescriptionLocalizations(en('giveaways.commands.required_role')))
        .addIntegerOption((o) => o.setName('min_messages').setDescription(fr('giveaways.commands.min_messages')).setDescriptionLocalizations(en('giveaways.commands.min_messages')).setMinValue(0).setMaxValue(100000))
        .addStringOption((o) =>
          o
            .setName('language')
            .setDescription(fr('giveaways.commands.language'))
            .setDescriptionLocalizations(en('giveaways.commands.language'))
            .addChoices(...LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }))),
        )
        .addStringOption((o) => o.setName('description').setDescription(fr('giveaways.commands.description_opt')).setDescriptionLocalizations(en('giveaways.commands.description_opt')).setMaxLength(1000)),
    )
    .addSubcommand((s) => s.setName('end').setDescription(fr('giveaways.commands.end')).setDescriptionLocalizations(en('giveaways.commands.end')).addIntegerOption(idOption))
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription(fr('giveaways.commands.reroll'))
        .setDescriptionLocalizations(en('giveaways.commands.reroll'))
        .addIntegerOption(idOption)
        .addIntegerOption((o) => o.setName('count').setDescription(fr('giveaways.commands.reroll_count')).setDescriptionLocalizations(en('giveaways.commands.reroll_count')).setMinValue(1).setMaxValue(50)),
    )
    .addSubcommand((s) => s.setName('cancel').setDescription(fr('giveaways.commands.cancel')).setDescriptionLocalizations(en('giveaways.commands.cancel')).addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('list').setDescription(fr('giveaways.commands.list')).setDescriptionLocalizations(en('giveaways.commands.list'))),
  module: 'giveaways',
  permissions: { internal: 'staff', bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
  cooldown: 2,
  async execute(interaction, ctx: InteractionContext) {
    const { t, config } = ctx;
    if (!interaction.guild || !config) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    switch (sub) {
      case 'create': {
        const prize = interaction.options.getString('prize', true);
        const durationRaw = interaction.options.getString('duration', true);
        const winners = interaction.options.getInteger('winners', true);
        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        const requiredRole = interaction.options.getRole('required_role');
        const minMessages = interaction.options.getInteger('min_messages') ?? 0;
        const language = interaction.options.getString('language');
        const description = interaction.options.getString('description');

        const seconds = parseDuration(durationRaw);
        if (!seconds || seconds > MAX_DURATION_SECONDS) {
          await interaction.reply({ embeds: [embedService.error(t('giveaways.create.invalid_duration', { value: durationRaw }))], ...EPHEMERAL });
          return;
        }
        if (!channel || !('send' in channel) || channel.isDMBased()) {
          await interaction.reply({ embeds: [embedService.error(t('giveaways.create.channel_invalid'))], ...EPHEMERAL });
          return;
        }
        await interaction.deferReply(EPHEMERAL);
        const giveaway = await giveawayService.create(
          guildId,
          { prize, description, winnersCount: winners, endsAt: new Date(Date.now() + seconds * 1000), channelId: channel.id, requiredRoleId: requiredRole?.id ?? null, minMessages, language },
          interaction.user.id,
        );
        await interaction.editReply({ embeds: [embedService.success(t('giveaways.create.success', { prize: giveaway.prize, channel: channel.id, id: giveaway.id, when: discordTimestamp(giveaway.endsAt, 'R') }))] });
        return;
      }
      case 'end': {
        const id = interaction.options.getInteger('id', true);
        const giveaway = await giveawayService.get(id);
        if (!giveaway || giveaway.guildId !== guildId) return notFound(interaction, t, id);
        await interaction.deferReply(EPHEMERAL);
        const result = await giveawayService.end(id, { force: true, actorId: interaction.user.id });
        if (!result.ok) {
          await interaction.editReply({ embeds: [embedService.warning(t(result.reason === 'already_ended' ? 'giveaways.end.already_ended' : 'giveaways.not_found', { id }))] });
          return;
        }
        await interaction.editReply({
          embeds: [
            embedService.success(
              result.winners.length ? t('giveaways.end.success', { prize: giveaway.prize, winners: result.winners.map((w) => `<@${w}>`).join(', ') }) : t('giveaways.end.no_winner', { prize: giveaway.prize }),
            ),
          ],
        });
        return;
      }
      case 'reroll': {
        const id = interaction.options.getInteger('id', true);
        const count = interaction.options.getInteger('count') ?? 1;
        const giveaway = await giveawayService.get(id);
        if (!giveaway || giveaway.guildId !== guildId) return notFound(interaction, t, id);
        await interaction.deferReply(EPHEMERAL);
        const result = await giveawayService.reroll(id, count, interaction.user.id);
        if (!result.ok) {
          await interaction.editReply({ embeds: [embedService.warning(t(result.reason === 'not_ended' ? 'giveaways.reroll.not_ended' : 'giveaways.not_found', { id }))] });
          return;
        }
        await interaction.editReply({
          embeds: [
            result.winners.length
              ? embedService.success(t('giveaways.reroll.success', { prize: giveaway.prize, winners: result.winners.map((w) => `<@${w}>`).join(', ') }))
              : embedService.warning(t('giveaways.reroll.no_candidates')),
          ],
        });
        return;
      }
      case 'cancel': {
        const id = interaction.options.getInteger('id', true);
        const giveaway = await giveawayService.get(id);
        if (!giveaway || giveaway.guildId !== guildId) return notFound(interaction, t, id);
        if (giveaway.ended) {
          await interaction.reply({ embeds: [embedService.warning(t('giveaways.cancel.already_ended'))], ...EPHEMERAL });
          return;
        }
        await interaction.deferReply(EPHEMERAL);
        await giveawayService.cancel(id, interaction.user.id);
        await interaction.editReply({ embeds: [embedService.success(t('giveaways.cancel.success', { prize: giveaway.prize }))] });
        return;
      }
      case 'list': {
        await interaction.deferReply(EPHEMERAL);
        const giveaways = await giveawayService.list(guildId);
        await paginate(interaction, { pages: buildGiveawayListPages(giveaways, t, interaction.guild.name), userId: interaction.user.id, ephemeral: true });
        return;
      }
    }
  },
});
