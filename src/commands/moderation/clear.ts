import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, GuildMember, LabelBuilder, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction } from 'discord.js';
import { defineCommand } from '../../structures';
import type { InteractionContext } from '../../structures/types';
import { moderationService, type PurgeFilter } from '../../services/ModerationService';
import { embedService } from '../../services/EmbedService';
import { buildCustomId } from '../../utils/customId';
import { hasInternalPermission } from '../../utils/permissions';
import { env } from '../../config/env';
import { EPHEMERAL, MOD_PERMS, errorKey, replyError } from './_shared';

/**
 * /clear — suppression de messages :
 *  - `messages` : jusqu'à 500 messages récents (< 14 jours) avec filtres (staff, Gérer les messages) ;
 *  - `salon`    : vide un salon en le recréant à l'identique (admin, confirmation bouton `mod:nuke:<channelId>`) ;
 *  - `serveur`  : vide TOUS les salons texte / annonces du serveur (admin, confirmation par modal `mod:nukeguild:<1|0>`
 *                 où il faut taper le nom exact du serveur).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprimer des messages (salon actuel, un salon entier ou tout le serveur)')
    .addSubcommand((s) =>
      s
        .setName('messages')
        .setDescription('Supprimer un nombre de messages dans ce salon')
        .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre de messages à supprimer (1-500)').setRequired(true).setMinValue(1).setMaxValue(500))
        .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre'))
        .addStringOption((o) =>
          o
            .setName('filtre')
            .setDescription('Filtre')
            .addChoices(
              { name: 'Tous', value: 'all' },
              { name: 'Bots uniquement', value: 'bots' },
              { name: 'Humains uniquement', value: 'humans' },
              { name: 'Messages avec liens', value: 'links' },
              { name: 'Messages avec fichiers', value: 'files' },
              { name: 'Messages avec embeds', value: 'embeds' },
            ),
        )
        .addStringOption((o) => o.setName('raison').setDescription('Raison').setMaxLength(512)),
    )
    .addSubcommand((s) =>
      s
        .setName('salon')
        .setDescription('Supprimer tous les messages d’un salon (recréé à l’identique)')
        .addChannelOption((o) => o.setName('salon').setDescription('Salon à vider (défaut : salon actuel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) =>
      s
        .setName('serveur')
        .setDescription('Supprimer TOUS les messages du serveur (salons recréés, confirmation par le nom du serveur)')
        .addBooleanOption((o) => o.setName('inclure_tickets').setDescription('Vider aussi les salons de tickets (défaut : non)')),
    ),
  module: 'moderation',
  permissions: MOD_PERMS.messages,
  cooldown: 5,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'messages') return clearMessages(interaction, ctx);
    // salon / serveur : administrateurs uniquement + le bot doit pouvoir gérer les salons
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    if (!hasInternalPermission({ member, config: ctx.config, ownerIds: env().OWNER_IDS, required: 'admin' })) {
      await interaction.reply({ embeds: [embedService.error(ctx.t('moderation.nuke_guild.admin_only'))], ...EPHEMERAL });
      return;
    }
    if (!interaction.guild.members.me?.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
      await interaction.reply({ embeds: [embedService.error(ctx.t('moderation.nuke_guild.bot_missing'))], ...EPHEMERAL });
      return;
    }
    if (sub === 'salon') return clearChannel(interaction, ctx);
    return clearGuild(interaction, ctx);
  },
});

async function clearMessages(interaction: ChatInputCommandInteraction, ctx: InteractionContext): Promise<void> {
  if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) return;
  const amount = interaction.options.getInteger('nombre', true);
  const user = interaction.options.getUser('membre');
  const filter = (interaction.options.getString('filtre') ?? 'all') as PurgeFilter;
  const reason = interaction.options.getString('raison')?.trim().slice(0, 512) || null;
  await interaction.deferReply(EPHEMERAL);
  try {
    const { deleted, sanction } = await moderationService.purge({ channel: interaction.channel, moderator: interaction.user, options: { amount, userId: user?.id ?? null, filter }, reason });
    await interaction.editReply({ embeds: [embedService.success(ctx.t('moderation.purge.done', { count: deleted, channel: `<#${interaction.channel.id}>`, number: sanction.caseNumber }))] });
  } catch (e) {
    const k = errorKey(e);
    await replyError(interaction, ctx, k.key, k.vars);
  }
}

async function clearChannel(interaction: ChatInputCommandInteraction, { t }: InteractionContext): Promise<void> {
  const target = interaction.options.getChannel('salon') ?? interaction.channel;
  if (!target || !('guild' in target) || (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement)) {
    await interaction.reply({ embeds: [embedService.error(t('core.channel_not_found'))], ...EPHEMERAL });
    return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId('mod', 'nuke', target.id)).setLabel(t('moderation.clear_channel.btn_confirm')).setStyle(ButtonStyle.Danger).setEmoji('🧨'),
    new ButtonBuilder().setCustomId(buildCustomId('mod', 'cancel')).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    embeds: [embedService.warning(t('moderation.clear_channel.confirm', { channel: `<#${target.id}>` }), t('moderation.clear_channel.title'))],
    components: [row],
    ...EPHEMERAL,
  });
}

async function clearGuild(interaction: ChatInputCommandInteraction, { t }: InteractionContext): Promise<void> {
  if (moderationService.isNukingGuild(interaction.guild!.id)) {
    await interaction.reply({ embeds: [embedService.error(t('moderation.nuke_guild.already_running'))], ...EPHEMERAL });
    return;
  }
  const includeTickets = interaction.options.getBoolean('inclure_tickets') ?? false;
  const input = new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder(interaction.guild!.name.slice(0, 100));
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId('mod', 'nukeguild', includeTickets ? '1' : '0'))
    .setTitle(t('moderation.nuke_guild.modal_title').slice(0, 45))
    .addLabelComponents(new LabelBuilder().setLabel(t('moderation.nuke_guild.modal_label').slice(0, 45)).setDescription(t('moderation.nuke_guild.modal_help').slice(0, 100)).setTextInputComponent(input));
  await interaction.showModal(modal);
}
