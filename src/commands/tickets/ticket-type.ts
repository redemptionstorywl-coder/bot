import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type AutocompleteInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { embedService } from '../../services/EmbedService';
import { TicketError, asStringArray, parseQuestions, ticketService, type TicketTypeInput, type TicketTypePatch } from '../../services/TicketService';
import { LANGUAGES } from '../../config/constants';
import { paginate, chunk } from '../../utils/pagination';
import { EPHEMERAL, buildQuestionsConfigModal, replyTicketError } from './_shared';

const KEY_REGEX = /^[a-z0-9-]{2,32}$/;

/** Autocomplete partagé : propose les types du serveur (valeur = clé). */
export async function autocompleteTypes(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const focused = interaction.options.getFocused().toLowerCase();
  const types = await ticketService.listTypes(interaction.guildId);
  const filtered = types.filter((t) => !focused || t.key.includes(focused) || t.label.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(filtered.map((t) => ({ name: `${t.emoji ?? ''} ${t.label} (${t.key})`.trim().slice(0, 100), value: t.key })));
}

/** Options communes à create / edit (label obligatoire uniquement à la création). */
function addCommonOptions(s: SlashCommandSubcommandBuilder, forEdit: boolean): SlashCommandSubcommandBuilder {
  return s
    .addStringOption((o) => o.setName('label').setDescription('Nom affiché').setRequired(!forEdit).setMaxLength(80))
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji du type').setMaxLength(64))
    .addStringOption((o) => o.setName('description').setDescription('Description courte (menu déroulant)').setMaxLength(100))
    .addChannelOption((o) => o.setName('category').setDescription('Catégorie Discord des tickets').addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption((o) => o.setName('archive-category').setDescription('Catégorie d’archive à la fermeture').addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption((o) => o.setName('staff-role').setDescription('Rôle staff à ajouter pour ce type'))
    .addIntegerOption((o) => o.setName('max-per-user').setDescription('Tickets ouverts max par membre (1-25)').setMinValue(1).setMaxValue(25))
    .addStringOption((o) => o.setName('name-format').setDescription('Format du salon : {number} {username} {type}').setMaxLength(60))
    .addStringOption((o) => o.setName('language').setDescription('Langue des messages du ticket').addChoices(...LANGUAGES.map((l) => ({ name: `${l.flag} ${l.nativeLabel}`, value: l.code }))))
    .addStringOption((o) => o.setName('welcome-message').setDescription('Message de bienvenue ({user} {server} {number} {type})').setMaxLength(2000));
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ticket-type')
    .setDescription('Gérer les types de tickets de ce serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => addCommonOptions(s.setName('create').setDescription('Créer un type de ticket').addStringOption((o) => o.setName('key').setDescription('Clé unique (ex: support)').setRequired(true).setMaxLength(32)), false))
    .addSubcommand((s) =>
      addCommonOptions(s.setName('edit').setDescription('Modifier un type de ticket').addStringOption((o) => o.setName('type').setDescription('Type').setRequired(true).setAutocomplete(true)), true)
        .addRoleOption((o) => o.setName('remove-staff-role').setDescription('Rôle staff à retirer'))
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer / désactiver'))
        .addIntegerOption((o) => o.setName('order').setDescription('Ordre d’affichage')),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('Supprimer un type de ticket').addStringOption((o) => o.setName('type').setDescription('Type').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Lister les types de tickets'))
    .addSubcommand((s) => s.setName('questions').setDescription('Configurer le formulaire (jusqu’à 5 questions)').addStringOption((o) => o.setName('type').setDescription('Type').setRequired(true).setAutocomplete(true))),
  module: 'tickets',
  permissions: { internal: 'admin', discord: [PermissionFlagsBits.Administrator] },
  cooldown: 2,
  autocomplete: autocompleteTypes,
  async execute(interaction, ctx) {
    const { t, config } = ctx;
    if (!interaction.inCachedGuild() || !config) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const o = interaction.options;

    const readPatch = (): TicketTypePatch => {
      const patch: TicketTypePatch = {};
      const label = o.getString('label');
      if (label) patch.label = label;
      const emoji = o.getString('emoji');
      if (emoji !== null) patch.emoji = emoji;
      const description = o.getString('description');
      if (description !== null) patch.description = description;
      const category = o.getChannel('category');
      if (category) patch.categoryId = category.id;
      const archive = o.getChannel('archive-category');
      if (archive) patch.archiveCategoryId = archive.id;
      const max = o.getInteger('max-per-user');
      if (max !== null) patch.maxPerUser = max;
      const nameFormat = o.getString('name-format');
      if (nameFormat) patch.nameFormat = nameFormat;
      const language = o.getString('language');
      if (language) patch.language = language;
      const welcome = o.getString('welcome-message');
      if (welcome !== null) patch.welcomeMessage = welcome;
      return patch;
    };

    try {
      switch (sub) {
        case 'create': {
          const key = o.getString('key', true).trim().toLowerCase();
          if (!KEY_REGEX.test(key)) throw new TicketError('invalid_key');
          if (await ticketService.getType(guildId, key)) throw new TicketError('key_exists', { key });
          const patch = readPatch();
          const staffRole = o.getRole('staff-role');
          const input: TicketTypeInput = { key, label: patch.label ?? key, ...patch, staffRoleIds: staffRole ? [staffRole.id] : [] };
          await interaction.deferReply(EPHEMERAL);
          const type = await ticketService.upsertType(guildId, input);
          await interaction.editReply({ embeds: [embedService.success(t('tickets.type.created', { label: type.label, key: type.key }))] });
          return;
        }
        case 'edit': {
          const type = await ticketService.getType(guildId, o.getString('type', true));
          if (!type) throw new TicketError('type_not_found');
          const patch = readPatch();
          const enabled = o.getBoolean('enabled');
          if (enabled !== null) patch.enabled = enabled;
          const order = o.getInteger('order');
          if (order !== null) patch.order = order;
          const addRole = o.getRole('staff-role');
          const removeRole = o.getRole('remove-staff-role');
          if (addRole || removeRole) {
            let roles = asStringArray(type.staffRoleIds);
            if (addRole) roles = [...new Set([...roles, addRole.id])];
            if (removeRole) roles = roles.filter((r) => r !== removeRole.id);
            patch.staffRoleIds = roles;
          }
          if (!Object.keys(patch).length) {
            await interaction.reply({ embeds: [embedService.warning(t('tickets.type.nothing_to_update'))], ...EPHEMERAL });
            return;
          }
          await interaction.deferReply(EPHEMERAL);
          const updated = await ticketService.updateType(guildId, type.id, patch);
          await interaction.editReply({ embeds: [embedService.success(t('tickets.type.updated', { label: updated.label }))] });
          return;
        }
        case 'delete': {
          const type = await ticketService.getType(guildId, o.getString('type', true));
          if (!type) throw new TicketError('type_not_found');
          await interaction.deferReply(EPHEMERAL);
          await ticketService.deleteType(guildId, type.id);
          await interaction.editReply({ embeds: [embedService.success(t('tickets.type.deleted', { label: type.label }))] });
          return;
        }
        case 'questions': {
          const type = await ticketService.getType(guildId, o.getString('type', true));
          if (!type) throw new TicketError('type_not_found');
          await interaction.showModal(buildQuestionsConfigModal(type, t));
          await interaction.followUp({ embeds: [embedService.info(t('tickets.type.questions_help'))], ...EPHEMERAL }).catch(() => null);
          return;
        }
        case 'list':
        default: {
          await interaction.deferReply(EPHEMERAL);
          const types = await ticketService.listTypes(guildId);
          if (!types.length) {
            await interaction.editReply({ embeds: [embedService.info(t('tickets.type.list_empty'))] });
            return;
          }
          const lines = types.map((ty) =>
            t('tickets.type.list_line', {
              emoji: ty.emoji ?? '🎫',
              label: ty.label,
              key: ty.key,
              state: ty.enabled ? t('tickets.type.enabled') : t('tickets.type.disabled'),
              category: ty.categoryId ? `<#${ty.categoryId}>` : t('core.none'),
              archive: ty.archiveCategoryId ? `<#${ty.archiveCategoryId}>` : t('core.none'),
              roles: asStringArray(ty.staffRoleIds).map((r) => `<@&${r}>`).join(' ') || t('core.none'),
              max: ty.maxPerUser,
              questions: parseQuestions(ty.questions).length,
            }),
          );
          const pages = chunk(lines, 6).map((group, i, all) => embedService.brand(t('tickets.type.list_title'), group.join('\n\n')).setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }));
          await paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
          return;
        }
      }
    } catch (err) {
      if (await replyTicketError(interaction, t, err)) return;
      throw err;
    }
  },
});
