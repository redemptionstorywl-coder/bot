import { ActionRowBuilder, ChannelType, GuildMember, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { GuildKind, SchoolRole } from '@prisma/client';
import { defineCommand } from '../../structures';
import { schoolService, SchoolError, sortHouses } from '../../services/SchoolService';
import { embedService } from '../../services/EmbedService';
import { env } from '../../config/env';
import { hasInternalPermission } from '../../utils/permissions';
import { buildCustomId } from '../../utils/customId';
import { rankLabel } from '../../services/BattleRoyaleService';

const ROLE_CHOICES = Object.values(SchoolRole).map((r) => ({ name: r, value: r }));

/**
 * /school — profils, candidatures, annonces, points / classement des maisons, clubs (rejoindre / quitter).
 * La configuration (salons, rôles, classes, maisons, clubs) est dans `/config module:school`.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('school')
    .setDescription('School RP')
    .addSubcommand((s) => s.setName('register').setDescription('Créer votre profil (prénom, nom, classe, maison)'))
    .addSubcommand((s) => s.setName('profile').setDescription('Voir un profil').addUserOption((o) => o.setName('user').setDescription('Membre (vide = vous)')))
    .addSubcommand((s) => s.setName('apply').setDescription('Candidater à un rôle').addStringOption((o) => o.setName('role').setDescription('Rôle visé').setRequired(true).addChoices(...ROLE_CHOICES)))
    .addSubcommand((s) =>
      s
        .setName('announce')
        .setDescription('[Staff] Publier une annonce scolaire')
        .addStringOption((o) => o.setName('title').setDescription('Titre').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('content').setDescription('Contenu').setRequired(true).setMaxLength(2000))
        .addChannelOption((o) => o.setName('channel').setDescription('Salon (vide = salon d’annonces configuré)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName('image').setDescription('URL d’image').setMaxLength(500)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('house')
        .setDescription('Maisons')
        .addSubcommand((s) =>
          s
            .setName('points-add')
            .setDescription('[Staff] Ajouter des points')
            .addStringOption((o) => o.setName('name').setDescription('Maison').setRequired(true).setAutocomplete(true))
            .addIntegerOption((o) => o.setName('points').setDescription('Points').setRequired(true).setMinValue(1))
            .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(200))
            .addUserOption((o) => o.setName('user').setDescription('Membre à créditer aussi')),
        )
        .addSubcommand((s) =>
          s
            .setName('points-remove')
            .setDescription('[Staff] Retirer des points')
            .addStringOption((o) => o.setName('name').setDescription('Maison').setRequired(true).setAutocomplete(true))
            .addIntegerOption((o) => o.setName('points').setDescription('Points').setRequired(true).setMinValue(1))
            .addStringOption((o) => o.setName('reason').setDescription('Raison').setMaxLength(200))
            .addUserOption((o) => o.setName('user').setDescription('Membre à débiter aussi')),
        )
        .addSubcommand((s) => s.setName('leaderboard').setDescription('Classement des maisons')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('club')
        .setDescription('Clubs')
        .addSubcommand((s) => s.setName('list').setDescription('Lister les clubs'))
        .addSubcommand((s) => s.setName('join').setDescription('Rejoindre un club').addStringOption((o) => o.setName('name').setDescription('Club').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('leave').setDescription('Quitter un club').addStringOption((o) => o.setName('name').setDescription('Club').setRequired(true).setAutocomplete(true))),
    ),
  module: 'school',
  guildKinds: [GuildKind.SCHOOL],
  cooldown: 3,
  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const group = interaction.options.getSubcommandGroup(false);
    const q = interaction.options.getFocused().toLowerCase();
    let names: string[] = [];
    if (group === 'house') names = (await schoolService.listHouses(interaction.guildId)).map((h) => h.name);
    else if (group === 'club') names = (await schoolService.listClubs(interaction.guildId)).map((c) => c.name);
    await interaction.respond(names.filter((n) => n.toLowerCase().includes(q)).slice(0, 25).map((n) => ({ name: n, value: n })));
  },
  async execute(interaction, { t, config }) {
    if (!interaction.guild || !config) return;
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const can = (required: 'staff') => hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required });
    const deny = (level: string) => interaction.reply({ embeds: [embedService.error(t('core.insufficient_level', { level }))], ...ephemeral });
    const nameOf = (o: string) => interaction.options.getString(o, true).trim();

    try {
      // ───── Sans groupe ─────
      if (!group) {
        if (sub === 'register') {
          const existing = await schoolService.getProfile(guildId, interaction.user.id);
          if (existing) throw new SchoolError('profile_exists');
          const modal = new ModalBuilder()
            .setCustomId(buildCustomId('school', 'register'))
            .setTitle(t('school.register.modal_title').slice(0, 45))
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('firstName').setLabel(t('school.register.first_name').slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('lastName').setLabel(t('school.register.last_name').slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('bio').setLabel(t('school.register.bio').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
            );
          await interaction.showModal(modal);
          return;
        }
        if (sub === 'profile') {
          const user = interaction.options.getUser('user') ?? interaction.user;
          const p = await schoolService.getProfile(guildId, user.id);
          if (!p) return interaction.reply({ embeds: [embedService.info(t('school.profile.none', { user: `<@${user.id}>` }))], ...ephemeral });
          const embed = embedService
            .brand(`${p.firstName} ${p.lastName}`)
            .setThumbnail(user.displayAvatarURL({ size: 256 }))
            .addFields(
              { name: t('school.profile.role'), value: t(`school.roles.${p.role.toLowerCase()}`), inline: true },
              { name: t('school.profile.class'), value: p.class?.name ?? t('core.none'), inline: true },
              { name: t('school.profile.house'), value: p.house ? `${p.house.emoji ?? ''} ${p.house.name}`.trim() : t('core.none'), inline: true },
              { name: t('school.profile.points'), value: String(p.points), inline: true },
              { name: t('school.profile.clubs'), value: p.clubs.map((m) => m.club.name).join(', ') || t('core.none'), inline: true },
            );
          if (p.bio) embed.setDescription(p.bio);
          await interaction.reply({ embeds: [embed], flags: user.id === interaction.user.id ? undefined : MessageFlags.Ephemeral });
          return;
        }
        if (sub === 'apply') {
          const role = interaction.options.getString('role', true) as SchoolRole;
          const modal = new ModalBuilder()
            .setCustomId(buildCustomId('school', 'apply', role))
            .setTitle(t('school.apply.modal_title', { role: t(`school.roles.${role.toLowerCase()}`) }).slice(0, 45))
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('identity').setLabel(t('school.apply.q_identity').slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('motivation').setLabel(t('school.apply.q_motivation').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('experience').setLabel(t('school.apply.q_experience').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('availability').setLabel(t('school.apply.q_availability').slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)),
            );
          await interaction.showModal(modal);
          return;
        }
        if (sub === 'announce') {
          if (!can('staff')) return deny('staff');
          const settings = await schoolService.getConfig(guildId);
          const channelId = interaction.options.getChannel('channel')?.id ?? settings.announceChannelId;
          if (!channelId) return interaction.reply({ embeds: [embedService.error(t('school.announce.no_channel'))], ...ephemeral });
          await interaction.deferReply(ephemeral);
          const id = await schoolService.announce({ guildId, channelId, title: nameOf('title'), content: nameOf('content'), authorId: interaction.user.id, imageUrl: interaction.options.getString('image') });
          await interaction.editReply({ embeds: [id ? embedService.success(t('school.announce.done', { channel: `<#${channelId}>` })) : embedService.error(t('core.channel_not_found'))] });
          return;
        }
      }

      // ───── Maisons ─────
      if (group === 'house') {
        if (sub === 'leaderboard') {
          const houses = sortHouses(await schoolService.listHouses(guildId));
          if (!houses.length) return interaction.reply({ embeds: [embedService.info(t('school.house.empty'))], ...ephemeral });
          const lines = houses.map((h, i) => `${rankLabel(i)} ${h.emoji ?? ''} **${h.name}** — **${h.points}** ${t('school.house.points')} · ${h._count.members} ${t('school.house.members')}${h.roleId ? ` · <@&${h.roleId}>` : ''}`);
          return interaction.reply({ embeds: [embedService.brand(t('school.house.leaderboard_title'), lines.join('\n'))] });
        }
        if (!can('staff')) return deny('staff');
        if (sub === 'points-add' || sub === 'points-remove') {
          const h = await schoolService.findHouseByName(guildId, nameOf('name'));
          if (!h) throw new SchoolError('house_not_found');
          const points = interaction.options.getInteger('points', true) * (sub === 'points-add' ? 1 : -1);
          const updated = await schoolService.addHousePoints(guildId, h.id, points, interaction.user.id, interaction.options.getString('reason'), interaction.options.getUser('user')?.id);
          return interaction.reply({ embeds: [embedService.success(t('school.house.points_updated', { name: `${updated.emoji ?? ''} ${updated.name}`.trim(), delta: `${points > 0 ? '+' : ''}${points}`, points: updated.points }))] });
        }
      }

      // ───── Clubs ─────
      if (group === 'club') {
        if (sub === 'list') {
          const clubs = await schoolService.listClubs(guildId);
          if (!clubs.length) return interaction.reply({ embeds: [embedService.info(t('school.club.empty'))], ...ephemeral });
          return interaction.reply({ embeds: [embedService.brand(t('school.club.list_title'), clubs.map((c) => `🎭 **${c.name}** · ${c._count.members}${c.maxMembers ? `/${c.maxMembers}` : ''} ${t('school.house.members')}${c.leaderId ? ` · <@${c.leaderId}>` : ''}${c.description ? `\n> ${c.description.slice(0, 120)}` : ''}`).join('\n'))], ...ephemeral });
        }
        if (sub === 'join' || sub === 'leave') {
          const c = await schoolService.findClubByName(guildId, nameOf('name'));
          if (!c) throw new SchoolError('club_not_found');
          await interaction.deferReply(ephemeral);
          if (sub === 'join') await schoolService.joinClub(guildId, interaction.user.id, c.id);
          else await schoolService.leaveClub(guildId, interaction.user.id, c.id);
          await interaction.editReply({ embeds: [embedService.success(t(sub === 'join' ? 'school.club.joined' : 'school.club.left', { name: c.name }))] });
          return;
        }
      }
    } catch (err) {
      if (err instanceof SchoolError) {
        const embeds = [embedService.error(t(`school.errors.${err.code}`))];
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
        else await interaction.reply({ embeds, ...ephemeral });
        return;
      }
      throw err;
    }
  },
});
