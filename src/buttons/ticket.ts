import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction } from 'discord.js';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService } from '../services/EmbedService';
import { DELETE_COUNTDOWN_SECONDS, TicketError, canCloseTicket, canManageTicket, canViewTicket, ticketService } from '../services/TicketService';
import { buildCustomId } from '../utils/customId';
import { ticketReminderService } from '../services/TicketReminderService';
import { sleep } from '../utils/time';
import { EPHEMERAL, loadTicketContext, replyTicketError, startOpenFlow } from '../commands/tickets/_shared';

type Handler = (interaction: ButtonInteraction<'cached'>, arg: string, ctx: InteractionContext) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  /** Bouton « Ouvrir un ticket » d'un panneau */
  async panel(interaction, arg, ctx) {
    const { t } = ctx;
    const panel = await ticketService.getPanel(Number(arg));
    if (!panel || panel.guildId !== interaction.guildId) throw new TicketError('panel_not_found');
    const types = await ticketService.getPanelTypes(panel);
    if (!types.length) throw new TicketError('no_types');
    if (types.length === 1) return startOpenFlow(interaction, types[0]!, ctx);
    await interaction.reply({ content: t('tickets.panel.pick_prompt'), components: [ticketService.buildTypePicker(panel.id, types, t)], ...EPHEMERAL });
  },

  async close(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canCloseTicket(ticket, actor)) throw new TicketError(ticket.status === 'OPEN' || ticket.status === 'CLAIMED' ? 'no_permission' : 'already_closed');
    const modal = new ModalBuilder()
      .setCustomId(buildCustomId('ticket', 'close-modal', ticket.id))
      .setTitle(t('tickets.modal.close_title', { number: ticket.number }).slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel(t('tickets.modal.close_reason').slice(0, 45)).setPlaceholder(t('tickets.modal.close_reason_placeholder').slice(0, 100)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
        ),
      );
    await interaction.showModal(modal);
  },

  async reopen(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canViewTicket(ticket, actor)) throw new TicketError('no_permission');
    await interaction.deferReply(EPHEMERAL);
    const updated = await ticketService.reopenTicket({ ticketId: ticket.id, byId: interaction.user.id });
    await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.reopened_confirm', { number: updated.number }))] });
  },

  async claim(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
    await interaction.deferReply(EPHEMERAL);
    const updated = await ticketService.claimTicket({ ticketId: ticket.id, staffId: interaction.user.id, message: interaction.message });
    await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.claimed_confirm', { number: updated.number }))] });
  },

  /** Ticket permanent : coupe / réactive les relances automatiques (staff uniquement). */
  async mute(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
    await interaction.deferReply(EPHEMERAL);
    const muted = !ticket.remindersMuted;
    await ticketReminderService.setMuted(ticket.id, muted);
    const channel = interaction.channel?.isTextBased() && interaction.channel.type === ChannelType.GuildText ? interaction.channel : null;
    await ticketService.refreshControlMessage({ ...ticket, remindersMuted: muted }, channel).catch(() => null);
    if (channel) await channel.send({ content: t(muted ? 'ticket_reminders.muted_notice' : 'ticket_reminders.unmuted_notice', { user: `<@${interaction.user.id}>` }), allowedMentions: { parse: [] } }).catch(() => null);
    await interaction.editReply({ embeds: [embedService.success(t(muted ? 'ticket_reminders.muted_confirm' : 'ticket_reminders.unmuted_confirm'))] });
  },

  async add(interaction, arg, ctx) {
    return memberModal(interaction, arg, ctx, 'add');
  },

  async remove(interaction, arg, ctx) {
    return memberModal(interaction, arg, ctx, 'remove');
  },

  async transcript(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canViewTicket(ticket, actor)) throw new TicketError('no_permission');
    await interaction.deferReply(EPHEMERAL);
    const result = await ticketService.generateTranscript(ticket.id, { closedById: ticket.closedById, closedAt: ticket.closedAt ?? new Date() });
    const channel = interaction.channel?.type === ChannelType.GuildText ? interaction.channel : null;
    await ticketService.sendTranscript(ticket, result, { channel, dm: false });
    await interaction.editReply({ embeds: [embedService.success(t('tickets.actions.transcript_sent'))] });
  },

  async transfer(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
    const types = (await ticketService.listTypes(ticket.guildId, { enabledOnly: true })).filter((ty) => ty.id !== ticket.typeId);
    if (!types.length) throw new TicketError('no_types');
    const picker = ticketService.buildTypePicker(0, types, t);
    picker.components[0]!.setCustomId(buildCustomId('ticket', 'transfer-select', ticket.id)).setPlaceholder(t('tickets.actions.transfer_select'));
    await interaction.reply({ content: t('tickets.actions.transfer_prompt'), components: [picker], ...EPHEMERAL });
  },

  async delete(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId('ticket', 'delete-confirm', ticket.id)).setLabel(t('tickets.buttons.confirm_delete')).setEmoji('🗑️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(buildCustomId('ticket', 'delete-cancel', ticket.id)).setLabel(t('tickets.buttons.cancel')).setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [embedService.warning(t('tickets.actions.delete_confirm', { number: ticket.number }))], components: [row], ...EPHEMERAL });
  },

  async 'delete-confirm'(interaction, arg, ctx) {
    const { t } = ctx;
    const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
    if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
    await interaction.update({ embeds: [embedService.info(t('tickets.actions.deleting', { seconds: DELETE_COUNTDOWN_SECONDS }))], components: [] });
    if (interaction.channel?.isSendable()) await interaction.channel.send({ content: t('tickets.actions.deleting', { seconds: DELETE_COUNTDOWN_SECONDS }) }).catch(() => null);
    await sleep(DELETE_COUNTDOWN_SECONDS * 1000);
    await ticketService.deleteTicket({ ticketId: ticket.id, byId: interaction.user.id });
  },

  async 'delete-cancel'(interaction, _arg, ctx) {
    await interaction.update({ embeds: [embedService.info(ctx.t('tickets.actions.delete_cancelled'))], components: [] });
  },
};

async function memberModal(interaction: ButtonInteraction<'cached'>, arg: string, ctx: InteractionContext, mode: 'add' | 'remove'): Promise<void> {
  const { t } = ctx;
  const { ticket, actor } = await loadTicketContext(interaction, arg, ctx);
  if (!canManageTicket(ticket, actor)) throw new TicketError('staff_only');
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId('ticket', `${mode}-modal`, ticket.id))
    .setTitle(t(mode === 'add' ? 'tickets.modal.add_title' : 'tickets.modal.remove_title').slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('user').setLabel(t('tickets.modal.user_field').slice(0, 45)).setPlaceholder(t('tickets.modal.user_placeholder').slice(0, 100)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40),
      ),
    );
  await interaction.showModal(modal);
}

export default defineButton({
  id: 'ticket',
  module: 'tickets',
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild()) return;
    const [action = '', arg = ''] = args;
    const handler = handlers[action];
    if (!handler) return;
    try {
      await handler(interaction, arg, ctx);
    } catch (err) {
      if (await replyTicketError(interaction, ctx.t, err)) return;
      throw err;
    }
  },
});
