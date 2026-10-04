import { MessageFlags, type AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService } from '../services/EmbedService';
import { TicketError, ticketService } from '../services/TicketService';
import { replyTicketError } from '../commands/tickets/_shared';
import { getDraft, isReminderPing, ko, loadOptions, ok, renderPanelView, renderType, setDraft } from '../commands/tickets/_configPanel';
import { ticketReminderService } from '../services/TicketReminderService';
import { guildConfigService } from '../services/GuildConfigService';

/**
 * Menus du panneau `/config tickets` (namespace `tcfg`, admin ; utilisable module désactivé) :
 *  - `tcfg:pick`            (StringSelect)  → ouvre la vue d'une raison
 *  - `tcfg:category:<id>`   (ChannelSelect) → catégorie des tickets
 *  - `tcfg:archive:<id>`    (ChannelSelect) → catégorie d'archive
 *  - `tcfg:roles:<id>`      (RoleSelect)    → rôles ayant accès (0–10, vide = staff/admin)
 *  - `tcfg:pchannel`        (ChannelSelect) → salon du panneau (brouillon)
 *  - `tcfg:ptypes`          (StringSelect)  → raisons incluses (brouillon, vide = toutes)
 *  - `tcfg:pdelete`         (StringSelect)  → supprime un panneau publié
 *  - `tcfg:translog`        (ChannelSelect) → salon des transcripts / logs tickets (log TICKET)
 *  - `tcfg:rping`           (StringSelect)  → qui mentionner lors des relances (claimer / staff / none)
 */
export default defineSelectMenu({
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

async function handle(interaction: AnySelectMenuInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const guild = interaction.guild;
  const guildId = guild.id;
  const userId = interaction.user.id;
  const loadType = async () => {
    const type = await ticketService.getType(guildId, Number(arg));
    if (!type) throw new TicketError('type_not_found');
    return type;
  };

  switch (action) {
    case 'pick': {
      if (!interaction.isStringSelectMenu()) return;
      const type = await ticketService.getType(guildId, Number(interaction.values[0]));
      if (!type) throw new TicketError('type_not_found');
      return interaction.update(renderType({ guild, type, t }));
    }
    case 'category':
    case 'archive': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      if (!channelId) return;
      const type = await loadType();
      const updated = await ticketService.updateType(guildId, type.id, action === 'category' ? { categoryId: channelId } : { archiveCategoryId: channelId });
      const notice = ok(t(action === 'category' ? 'tickets.config.category_set' : 'tickets.config.archive_set', { channel: `<#${channelId}>` }));
      return interaction.update(renderType({ guild, type: updated, t, notice }));
    }
    case 'roles': {
      if (!interaction.isRoleSelectMenu()) return;
      const type = await loadType();
      const staffRoleIds = [...interaction.values];
      const updated = await ticketService.updateType(guildId, type.id, { staffRoleIds });
      return interaction.update(renderType({ guild, type: updated, t, notice: ok(t('tickets.config.roles_set', { count: staffRoleIds.length })) }));
    }
    case 'pchannel': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      if (!channelId) return;
      const draft = setDraft(guildId, userId, { channelId });
      return interaction.update(await renderPanelView({ guild, t, draft, notice: ok(t('tickets.config.panel_channel_set', { channel: `<#${channelId}>` })) }));
    }
    case 'ptypes': {
      if (!interaction.isStringSelectMenu()) return;
      const typeIds = interaction.values.map(Number).filter((n) => Number.isInteger(n));
      const draft = setDraft(guildId, userId, { typeIds });
      const notice = typeIds.length ? ok(t('tickets.config.panel_types_set', { count: typeIds.length })) : ok(t('tickets.config.panel_types_all'));
      return interaction.update(await renderPanelView({ guild, t, draft, notice }));
    }
    case 'pdelete': {
      if (!interaction.isStringSelectMenu()) return;
      const id = Number(interaction.values[0]);
      await interaction.deferUpdate();
      let notice;
      try {
        await ticketService.deletePanel(guildId, id);
        notice = ok(t('tickets.config.panel_deleted', { id }));
      } catch (err) {
        if (!(err instanceof TicketError)) throw err;
        notice = ko(t(`tickets.errors.${err.code}`, err.vars));
      }
      await interaction.editReply(await renderPanelView({ guild, t, draft: getDraft(guildId, userId), notice }));
      return;
    }
    case 'translog': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      if (!channelId) return;
      await guildConfigService.setLogChannel(guildId, 'TICKET', channelId);
      return interaction.update(await loadOptions({ guild, t, fallback: ctx.config!, notice: ok(t('panels_core.tickets.transcripts_set', { channel: `<#${channelId}>` })) }));
    }
    case 'rping': {
      if (!interaction.isStringSelectMenu()) return;
      const reminderPing = interaction.values[0];
      if (!isReminderPing(reminderPing)) return;
      await ticketReminderService.updateSettings(guildId, { reminderPing });
      return interaction.update(await loadOptions({ guild, t, fallback: ctx.config!, notice: ok(t('panels_core.tickets.ping_set', { ping: t(`panels_core.tickets.ping.${reminderPing}`) })) }));
    }
    default:
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action }))], flags: MessageFlags.Ephemeral });
  }
}
