import { ChannelType, MessageFlags, type ButtonInteraction } from 'discord.js';
import { PanelStyle } from '@prisma/client';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService } from '../services/EmbedService';
import { TicketError, ticketService } from '../services/TicketService';
import { guildConfigService } from '../services/GuildConfigService';
import { ticketReminderService } from '../services/TicketReminderService';
import { autoTranslateService } from '../services/AutoTranslateService';
import { replyTicketError } from '../commands/tickets/_shared';
import {
  buildInfoModal,
  buildReminderHoursModal,
  buildNewTypeModal,
  buildQuestionsModal,
  buildWelcomeModal,
  clearDraft,
  getDraft,
  ko,
  ok,
  renderDeleteConfirm,
  renderMain,
  loadOptions,
  renderPanelView,
  renderType,
  setDraft,
  type PanelNotice,
  type PanelPayload,
} from '../commands/tickets/_configPanel';

/**
 * Boutons du panneau `/config tickets` (namespace `tcfg`, admin ; utilisable module désactivé) :
 *  - vue principale : `tcfg:main`, `tcfg:new` (modal), `tcfg:defaults`, `tcfg:panelview`
 *  - vue d'une raison : `tcfg:type:<id>`, `tcfg:info:<id>` / `questions` / `welcome` (modals), `tcfg:toggle:<id>`,
 *    `tcfg:archivenone:<id>`, `tcfg:delete:<id>` → `tcfg:delete-confirm:<id>`
 *  - vue panneau : `tcfg:pstyle:<buttons|select>`, `tcfg:pen` (version anglaise), `tcfg:publish`
 *  - vue options : `tcfg:options`, `tcfg:translog-off` (retire le salon des transcripts), `tcfg:closed-off` (retire la catégorie
 *    « Tickets fermés »), `tcfg:module` (active / désactive le module),
 *    `tcfg:rtoggle` (relances automatiques on/off), `tcfg:rhours` (modal délai des relances)
 */
export default defineButton({
  id: 'tcfg',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', arg = ''] = args;
    try {
      await handle(interaction, action, arg, ctx);
    } catch (err) {
      if (await replyTicketError(interaction, ctx.t, err)) return;
      throw err;
    }
  },
});

async function show(interaction: ButtonInteraction<'cached'>, payload: PanelPayload): Promise<void> {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

async function loadType(interaction: ButtonInteraction<'cached'>, arg: string) {
  const type = await ticketService.getType(interaction.guildId, Number(arg));
  if (!type) throw new TicketError('type_not_found');
  return type;
}

async function handle(interaction: ButtonInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t, config } = ctx;
  const guild = interaction.guild;
  const guildId = guild.id;
  const userId = interaction.user.id;
  const main = (notice?: PanelNotice) => renderMain({ guild, t, notice });
  const typeView = async (id: number, notice?: PanelNotice) => renderType({ guild, type: (await loadType(interaction, String(id)))!, t, notice });
  const panelView = (notice?: PanelNotice) => renderPanelView({ guild, t, draft: getDraft(guildId, userId), notice });
  const optionsView = (notice?: PanelNotice) => loadOptions({ guild, t, fallback: config!, notice });
  const stateText = (enabled: boolean) => (enabled ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`);

  switch (action) {
    // ── Vue principale ──
    case 'main':
      return show(interaction, await main());
    case 'new':
      return interaction.showModal(buildNewTypeModal(t));
    case 'defaults': {
      const created = await ticketService.ensureDefaultTypes(guildId, config!.defaultLanguage);
      return show(interaction, await main(created ? ok(t('tickets.config.defaults_created', { count: created })) : ko(t('tickets.config.defaults_exist'))));
    }
    case 'panelview':
      return show(interaction, await panelView());
    case 'options':
      return show(interaction, await optionsView());
    case 'translog-off': {
      await guildConfigService.setLogChannel(guildId, 'TICKET', null);
      return show(interaction, await optionsView(ok(t('panels_core.tickets.transcripts_off'))));
    }
    case 'closed-off': {
      await ticketReminderService.updateSettings(guildId, { closedCategoryId: null });
      return show(interaction, await optionsView(ok(t('panels_core.tickets.closed_cleared'))));
    }
    case 'module': {
      const enabled = !config!.modules.tickets;
      await guildConfigService.setModule(guildId, 'tickets', enabled);
      return show(interaction, await optionsView(ok(t('panels_core.common.module_set', { module: t('panels_core.modules.tickets'), state: stateText(enabled) }))));
    }
    case 'rtoggle': {
      const current = await ticketReminderService.getSettings(guildId);
      const updated = await ticketReminderService.updateSettings(guildId, { remindersEnabled: !current.remindersEnabled });
      return show(interaction, await optionsView(ok(t('panels_core.tickets.reminders_set', { state: stateText(updated.remindersEnabled) }))));
    }
    case 'rhours':
      return interaction.showModal(buildReminderHoursModal((await ticketReminderService.getSettings(guildId)).reminderHours, t));

    // ── Vue d'une raison ──
    case 'type':
      return show(interaction, await typeView(Number(arg)));
    case 'info':
      return interaction.showModal(buildInfoModal(await loadType(interaction, arg), t));
    case 'questions':
      return interaction.showModal(buildQuestionsModal(await loadType(interaction, arg), t));
    case 'welcome':
      return interaction.showModal(buildWelcomeModal(await loadType(interaction, arg), t));
    case 'toggle': {
      const type = await loadType(interaction, arg);
      const updated = await ticketService.updateType(guildId, type.id, { enabled: !type.enabled });
      return show(interaction, renderType({ guild, type: updated, t, notice: ok(t('tickets.config.enabled_set', { label: updated.label, state: updated.enabled ? t('core.enabled') : t('core.disabled') })) }));
    }
    case 'archivenone': {
      const type = await loadType(interaction, arg);
      const updated = await ticketService.updateType(guildId, type.id, { archiveCategoryId: null });
      return show(interaction, renderType({ guild, type: updated, t, notice: ok(t('tickets.config.archive_cleared', { label: updated.label })) }));
    }
    case 'delete':
      return show(interaction, renderDeleteConfirm({ type: await loadType(interaction, arg), t }));
    case 'delete-confirm': {
      const type = await loadType(interaction, arg);
      await ticketService.deleteType(guildId, type.id);
      return show(interaction, await main(ok(t('tickets.config.deleted', { label: type.label }))));
    }

    // ── Vue panneau ──
    case 'pstyle': {
      const style = arg === 'select' ? PanelStyle.SELECT : PanelStyle.BUTTONS;
      setDraft(guildId, userId, { style });
      return show(interaction, await panelView(ok(t('tickets.config.panel_style_set', { style: style === PanelStyle.SELECT ? t('tickets.config.style_select') : t('tickets.config.style_buttons') }))));
    }
    case 'pen': {
      const current = getDraft(guildId, userId);
      const english = !(current.english ?? (await autoTranslateService.getSettings(guildId)).enabled);
      setDraft(guildId, userId, { english });
      return show(interaction, await panelView(ok(english ? t('embeds.builder.english_on') : t('embeds.builder.english_off'))));
    }
    case 'publish': {
      const draft = getDraft(guildId, userId);
      if (!draft.channelId) return show(interaction, await panelView(ko(t('tickets.config.panel_no_channel_error'))));
      const channel = await guild.channels.fetch(draft.channelId).catch(() => null);
      if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) throw new TicketError('channel_missing');
      const types = await ticketService.listTypes(guildId, { enabledOnly: true });
      if (!types.length) throw new TicketError('no_types');
      const typeIds = draft.typeIds.filter((id) => types.some((ty) => ty.id === id));
      await interaction.deferUpdate();
      const panel = await ticketService.createPanel({ guild, channel, style: draft.style, typeIds, lang: config!.defaultLanguage, brandColor: config!.brandColor, english: draft.english ?? null });
      clearDraft(guildId, userId);
      return show(interaction, await renderPanelView({ guild, t, draft: getDraft(guildId, userId), notice: ok(t('tickets.config.panel_published', { channel: `<#${channel.id}>`, id: panel.id, count: typeIds.length || types.length })) }));
    }
    default:
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action }))], flags: MessageFlags.Ephemeral });
  }
}
