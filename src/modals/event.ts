import { MessageFlags } from 'discord.js';
import { EventStatus } from '@prisma/client';
import { defineModal } from '../structures';
import { eventService } from '../services/EventService';
import { embedService } from '../services/EmbedService';
import { parseDateInput } from '../utils/time';
import type { Translator } from '../services/TranslationService';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

interface ParsedFields {
  name: string;
  description: string;
  startsAt: Date;
  location: string | null;
  maxParticipants: number | null;
}

/** Lit et valide les champs de la modal. Retourne une clé d'erreur traduisible en cas d'échec. */
function parseFields(get: (id: string) => string, t: Translator, allowPast = false): { ok: true; data: ParsedFields } | { ok: false; error: string } {
  const name = get('name').trim();
  const description = get('description').trim();
  const dateRaw = get('date').trim();
  const location = get('location').trim();
  const maxRaw = get('max').trim();

  const startsAt = parseDateInput(dateRaw);
  if (!startsAt) return { ok: false, error: t('events.create.invalid_date', { value: dateRaw }) };
  if (!allowPast && startsAt.getTime() <= Date.now()) return { ok: false, error: t('events.create.past_date') };

  let maxParticipants: number | null = null;
  if (maxRaw) {
    const n = Number(maxRaw);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: t('events.create.invalid_max') };
    maxParticipants = n;
  }
  return { ok: true, data: { name, description, startsAt, location: location || null, maxParticipants } };
}

/**
 * Modals `event:create` (options stockées côté service lors de /event create) et `event:edit:<id>`.
 */
export default defineModal({
  id: 'event',
  module: 'events',
  async execute(interaction, args, { t, config }) {
    const [action, rawId] = args;
    if (!interaction.guildId || !config) return;
    const read = (id: string) => interaction.fields.getTextInputValue(id);

    if (action === 'create') {
      const parsed = parseFields(read, t);
      if (!parsed.ok) {
        await interaction.reply({ embeds: [embedService.error(parsed.error)], ...EPHEMERAL });
        return;
      }
      const opts = eventService.takeOptions(interaction.user.id);
      if (!opts || opts.guildId !== interaction.guildId) {
        await interaction.reply({ embeds: [embedService.error(t('events.create.expired'))], ...EPHEMERAL });
        return;
      }
      await interaction.deferReply(EPHEMERAL);
      const event = await eventService.create(
        interaction.guildId,
        { ...parsed.data, channelId: opts.channelId, imageUrl: opts.imageUrl ?? null, mentionRoleId: opts.mentionRoleId ?? null, language: opts.language ?? null },
        interaction.user.id,
      );
      await interaction.editReply({ embeds: [embedService.success(t('events.create.success', { name: event.name, channel: event.channelId, id: event.id }))] });
      return;
    }

    if (action === 'edit') {
      const id = Number(rawId);
      const existing = Number.isInteger(id) ? await eventService.get(id) : null;
      if (!existing || existing.guildId !== interaction.guildId) {
        await interaction.reply({ embeds: [embedService.error(t('events.not_found', { id: rawId ?? '?' }))], ...EPHEMERAL });
        return;
      }
      if (existing.status === EventStatus.ENDED || existing.status === EventStatus.CANCELLED) {
        await interaction.reply({ embeds: [embedService.warning(t('events.edit.not_editable'))], ...EPHEMERAL });
        return;
      }
      // Un événement en cours peut conserver une date de début déjà passée.
      const parsed = parseFields(read, t, existing.status === EventStatus.ONGOING);
      if (!parsed.ok) {
        await interaction.reply({ embeds: [embedService.error(parsed.error)], ...EPHEMERAL });
        return;
      }
      await interaction.deferReply(EPHEMERAL);
      const event = await eventService.update(id, parsed.data, interaction.user.id);
      await interaction.editReply({ embeds: [embedService.success(t('events.edit.success', { name: event?.name ?? existing.name }))] });
    }
  },
});
