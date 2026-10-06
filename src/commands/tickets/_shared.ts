import {
  ActionRowBuilder,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { TicketType } from '@prisma/client';
import { embedService } from '../../services/EmbedService';
import { TicketError, parseQuestions, ticketService, type FormAnswer, type TicketActor, type TicketFull, type TicketQuestion } from '../../services/TicketService';
import type { Translator } from '../../services/TranslationService';
import type { InteractionContext } from '../../structures/types';
import { buildCustomId } from '../../utils/customId';
import { TICKET_MESSAGE_MAX, TICKET_TITLE_MAX, planOpenModal } from '../../services/tickets/title';

/** Helpers partagés par les commandes / boutons / menus / modals du module tickets (fichier ignoré par le loader). */

export const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Répond à une TicketError de façon éphémère. Retourne false si l'erreur n'est pas une TicketError. */
export async function replyTicketError(interaction: RepliableInteraction, t: Translator, err: unknown): Promise<boolean> {
  if (!(err instanceof TicketError)) return false;
  const embeds = [embedService.error(t(`tickets.errors.${err.code}`, err.vars))];
  if (interaction.deferred && !interaction.replied) await interaction.editReply({ content: '', embeds, components: [] }).catch(() => null);
  else if (interaction.replied) await interaction.followUp({ embeds, ...EPHEMERAL }).catch(() => null);
  else await interaction.reply({ embeds, ...EPHEMERAL }).catch(() => null);
  return true;
}

/** Autocomplete partagé : propose les types du serveur (valeur = clé). */
export async function autocompleteTypes(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const focused = interaction.options.getFocused().toLowerCase();
  const types = await ticketService.listTypes(interaction.guildId);
  const filtered = types.filter((t) => !focused || t.key.includes(focused) || t.label.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(filtered.map((t) => ({ name: `${t.emoji ?? ''} ${t.label} (${t.key})`.trim().slice(0, 100), value: t.key })));
}

/** Extrait un ID utilisateur depuis un ID brut ou une mention. */
export function parseUserId(input: string): string | null {
  const m = input.trim().match(/^(?:<@!?)?(\d{15,22})>?$/);
  return m ? m[1]! : null;
}

export async function fetchMember(interaction: Interaction): Promise<GuildMember | null> {
  if (interaction.member instanceof GuildMember) return interaction.member;
  if (!interaction.guild) return null;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

/** Charge un ticket par ID (dans le serveur courant) et calcule l'acteur. */
export async function loadTicketContext(interaction: Interaction, ticketId: string, ctx: InteractionContext): Promise<{ ticket: TicketFull; actor: TicketActor; member: GuildMember | null }> {
  const id = Number(ticketId);
  const ticket = Number.isInteger(id) ? await ticketService.getTicket(id) : null;
  if (!ticket || ticket.guildId !== interaction.guildId) throw new TicketError('not_found');
  const member = await fetchMember(interaction);
  return { ticket, actor: ticketService.actor(member, ctx.config, ticket.type), member };
}

/** Ticket du salon courant (commande /ticket). */
export async function loadChannelTicket(interaction: Interaction, ctx: InteractionContext): Promise<{ ticket: TicketFull; actor: TicketActor; member: GuildMember | null }> {
  if (!interaction.channelId) throw new TicketError('not_ticket_channel');
  const ticket = await ticketService.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.guildId !== interaction.guildId) throw new TicketError('not_ticket_channel');
  const member = await fetchMember(interaction);
  return { ticket, actor: ticketService.actor(member, ctx.config, ticket.type), member };
}

// ───── Formulaire d'ouverture ─────

/**
 * Formulaire d'ouverture (5 champs max) : « Titre du ticket » (obligatoire, en premier), puis les questions de la raison,
 * puis « Message » (facultatif) s'il reste une place — cf. `planOpenModal`.
 */
export function buildOpenModal(type: TicketType, questions: TicketQuestion[], t: Translator): ModalBuilder {
  const plan = planOpenModal(questions);
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId('ticket', 'open', type.id))
    .setTitle(t('tickets.open.modal_title', { emoji: type.emoji ?? '🎫', type: type.label }).slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel(t('tickets.open.modal_title_label').slice(0, 45))
        .setPlaceholder(t('tickets.open.modal_title_placeholder').slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(TICKET_TITLE_MAX),
    ),
  );
  for (const q of plan.questions) {
    const input = new TextInputBuilder()
      .setCustomId(`q_${q.id}`)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required);
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    if (q.maxLength) input.setMaxLength(Math.min(4000, Math.max(1, q.maxLength)));
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  if (plan.message) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel(t('tickets.open.modal_message_label').slice(0, 45))
          .setPlaceholder(t('tickets.open.modal_message_placeholder').slice(0, 100))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(TICKET_MESSAGE_MAX),
      ),
    );
  }
  return modal;
}

/** Titre (obligatoire) et message facultatif du formulaire d'ouverture. */
export function readOpenFields(interaction: ModalSubmitInteraction): { title: string | null; message: string | null } {
  const read = (id: string): string | null => {
    try {
      return interaction.fields.getTextInputValue(id).trim() || null;
    } catch {
      return null;
    }
  };
  return { title: read('title')?.slice(0, TICKET_TITLE_MAX) ?? null, message: read('message')?.slice(0, TICKET_MESSAGE_MAX) ?? null };
}

export function readAnswers(interaction: ModalSubmitInteraction, questions: TicketQuestion[]): FormAnswer[] {
  return questions.map((q) => {
    let answer = '';
    try {
      answer = interaction.fields.getTextInputValue(`q_${q.id}`);
    } catch {
      answer = '';
    }
    return { question: q.label, answer: answer.trim() };
  });
}

/** Crée le ticket et répond (l'interaction doit déjà être différée en éphémère). */
export async function createTicketAndReply(interaction: RepliableInteraction, type: TicketType, answers: FormAnswer[], ctx: InteractionContext, fields: { title: string | null; message: string | null } = { title: null, message: null }): Promise<void> {
  const { t, config, lang } = ctx;
  if (!interaction.guild) return;
  const member = await fetchMember(interaction);
  if (!member) {
    await interaction.editReply({ embeds: [embedService.error(t('core.member_not_found'))] });
    return;
  }
  try {
    const { channel } = await ticketService.openTicket({ guild: interaction.guild, member, type, answers, lang, config, title: fields.title, message: fields.message });
    await interaction.editReply({ content: '', embeds: [embedService.success(t('tickets.open.created', { channel: `<#${channel.id}>` }))], components: [] });
  } catch (err) {
    if (await replyTicketError(interaction, t, err)) return;
    throw err;
  }
}

/** Démarre l'ouverture : le formulaire (titre + questions de la raison + message facultatif) est toujours affiché. */
export async function startOpenFlow(interaction: ButtonInteraction | StringSelectMenuInteraction, type: TicketType, ctx: InteractionContext): Promise<void> {
  if (!interaction.guild) return;
  if (!type.enabled) throw new TicketError('type_disabled');
  // Vérification anticipée de maxPerUser pour ne pas afficher un formulaire inutile
  await ticketService.assertCanOpen(interaction.guild.id, interaction.user.id, type);
  await interaction.showModal(buildOpenModal(type, parseQuestions(type.questions), ctx.t));
}
