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

export function buildQuestionModal(type: TicketType, questions: TicketQuestion[], t: Translator): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId('ticket', 'open', type.id))
    .setTitle(t('tickets.open.modal_title', { emoji: type.emoji ?? '🎫', type: type.label }).slice(0, 45));
  for (const q of questions.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(`q_${q.id}`)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required);
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    if (q.maxLength) input.setMaxLength(Math.min(4000, Math.max(1, q.maxLength)));
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return modal;
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
export async function createTicketAndReply(interaction: RepliableInteraction, type: TicketType, answers: FormAnswer[], ctx: InteractionContext): Promise<void> {
  const { t, config, lang } = ctx;
  if (!interaction.guild) return;
  const member = await fetchMember(interaction);
  if (!member) {
    await interaction.editReply({ embeds: [embedService.error(t('core.member_not_found'))] });
    return;
  }
  try {
    const { channel } = await ticketService.openTicket({ guild: interaction.guild, member, type, answers, lang, config });
    await interaction.editReply({ content: '', embeds: [embedService.success(t('tickets.open.created', { channel: `<#${channel.id}>` }))], components: [] });
  } catch (err) {
    if (await replyTicketError(interaction, t, err)) return;
    throw err;
  }
}

/** Démarre l'ouverture : formulaire si le type a des questions, sinon création directe. */
export async function startOpenFlow(interaction: ButtonInteraction | StringSelectMenuInteraction, type: TicketType, ctx: InteractionContext): Promise<void> {
  const { t } = ctx;
  if (!interaction.guild) return;
  if (!type.enabled) throw new TicketError('type_disabled');
  // Vérification anticipée de maxPerUser pour ne pas afficher un formulaire inutile
  await ticketService.assertCanOpen(interaction.guild.id, interaction.user.id, type);
  const questions = parseQuestions(type.questions);
  if (questions.length) {
    await interaction.showModal(buildQuestionModal(type, questions, t));
    return;
  }
  await interaction.deferReply(EPHEMERAL);
  await createTicketAndReply(interaction, type, [], ctx);
}
