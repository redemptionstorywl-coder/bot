import { MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import { ZodError } from 'zod';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService, type EmbedSpec } from '../services/EmbedService';
import { TicketError, parseEmbedSpec, ticketService, type TicketTypePatch } from '../services/TicketService';
import { replyTicketError } from '../commands/tickets/_shared';
import { REMINDER_HOURS, getField, ko, loadOptions, ok, parseReminderHours, readQuestionsModal, renderMain, renderType, uniqueKey, type PanelNotice, type PanelPayload } from '../commands/tickets/_configPanel';
import { ticketReminderService } from '../services/TicketReminderService';

/**
 * Modals du panneau `/config tickets` (namespace `tcfg`, admin ; utilisable module désactivé) :
 *  - `tcfg:new`            : nouvelle raison (label, emoji, description ; clé = slug du label)
 *  - `tcfg:info:<id>`      : label, emoji, description, format de nom, max par membre
 *  - `tcfg:questions:<id>` : 5 questions `Label | placeholder | short/paragraph | required/optional | maxLength`
 *  - `tcfg:welcome:<id>`   : message d'accueil + titre / description de l'embed d'ouverture
 *  - `tcfg:rhours`         : délai des relances automatiques (heures, 1–168)
 */
export default defineModal({
  id: 'tcfg',
  permissions: { internal: 'admin' },
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

async function respond(interaction: ModalSubmitInteraction<'cached'>, payload: PanelPayload): Promise<void> {
  if (interaction.isFromMessage()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function zodDetails(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ').slice(0, 300);
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}

async function handle(interaction: ModalSubmitInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const guild = interaction.guild;
  const guildId = guild.id;
  const field = (id: string) => getField(interaction, id);

  if (action === 'rhours') {
    const hours = parseReminderHours(field('hours'));
    const notice = hours === null
      ? ko(t('panels_core.tickets.invalid_hours', { details: field('hours') ?? '—', min: REMINDER_HOURS.min, max: REMINDER_HOURS.max }))
      : ok(t('panels_core.tickets.hours_set', { hours: (await ticketReminderService.updateSettings(guildId, { reminderHours: hours })).reminderHours }));
    return respond(interaction, await loadOptions({ guild, t, fallback: ctx.config!, notice }));
  }

  if (action === 'new') {
    const label = field('label');
    if (!label) return respond(interaction, await renderMain({ guild, t, notice: ko(t('core.invalid_input', { details: t('tickets.config.modal_label') })) }));
    const existing = await ticketService.listTypes(guildId);
    const key = uniqueKey(label, existing.map((ty) => ty.key));
    try {
      const type = await ticketService.upsertType(guildId, { key, label, emoji: field('emoji') ?? null, description: field('description') ?? null, order: existing.length, staffRoleIds: [] });
      return respond(interaction, renderType({ guild, type, t, notice: ok(t('tickets.config.created', { label: type.label, key: type.key })) }));
    } catch (err) {
      if (err instanceof TicketError) throw err;
      return respond(interaction, await renderMain({ guild, t, notice: ko(t('core.invalid_input', { details: zodDetails(err) })) }));
    }
  }

  const type = await ticketService.getType(guildId, Number(arg));
  if (!type) throw new TicketError('type_not_found');
  let patch: TicketTypePatch;
  let notice: PanelNotice;

  switch (action) {
    case 'info': {
      const label = field('label') ?? type.label;
      const maxRaw = field('maxPerUser');
      const maxPerUser = maxRaw ? Number(maxRaw) : type.maxPerUser;
      if (!Number.isInteger(maxPerUser) || maxPerUser < 1 || maxPerUser > 25) return respond(interaction, renderType({ guild, type, t, notice: ko(t('tickets.config.invalid_max')) }));
      patch = { label, emoji: field('emoji') ?? null, description: field('description') ?? null, nameFormat: field('nameFormat') ?? 'ticket-{number}', maxPerUser };
      notice = ok(t('tickets.config.updated', { label }));
      break;
    }
    case 'questions': {
      const questions = readQuestionsModal(interaction);
      patch = { questions };
      notice = ok(t('tickets.config.questions_set', { count: questions.length }));
      break;
    }
    case 'welcome': {
      const base: Record<string, unknown> = { ...(parseEmbedSpec(type.embed) ?? {}) };
      const title = field('title');
      const descr = field('description');
      if (title) base.title = title;
      else delete base.title;
      if (descr) base.description = descr;
      else delete base.description;
      let embed: EmbedSpec | null = null;
      if (Object.keys(base).length) {
        const valid = embedService.safeValidate(base);
        if (!valid.success) return respond(interaction, renderType({ guild, type, t, notice: ko(t('tickets.errors.invalid_embed', { details: valid.error.slice(0, 300) })) }));
        embed = valid.data;
      }
      patch = { welcomeMessage: field('welcomeMessage') ?? null, embed };
      notice = ok(t('tickets.config.welcome_set'));
      break;
    }
    default:
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action }))], flags: MessageFlags.Ephemeral });
      return;
  }

  try {
    const updated = await ticketService.updateType(guildId, type.id, patch);
    await respond(interaction, renderType({ guild, type: updated, t, notice }));
  } catch (err) {
    if (err instanceof TicketError) throw err;
    await respond(interaction, renderType({ guild, type, t, notice: ko(t('core.invalid_input', { details: zodDetails(err) })) }));
  }
}
