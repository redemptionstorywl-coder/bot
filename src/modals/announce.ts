import { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import type { Translator } from '../services/TranslationService';
import { embedService } from '../services/EmbedService';
import { embedBuilderSessions, optionalText, renderBuilder, renderContextFromInteraction, type BuilderSession } from '../services/EmbedBuilderSession';
import { buildCustomId } from '../utils/customId';
import { parseDateInput } from '../utils/time';

function text(id: string, style: TextInputStyle, opts: { value?: string; placeholder?: string; required?: boolean; max?: number } = {}): TextInputBuilder {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(opts.required ?? false);
  if (opts.max) input.setMaxLength(opts.max);
  if (opts.placeholder) input.setPlaceholder(opts.placeholder.slice(0, 100));
  if (opts.value) input.setValue(opts.value.slice(0, opts.max ?? 4000));
  return input;
}

function label(t: Translator, key: string, input: TextInputBuilder): LabelBuilder {
  return new LabelBuilder().setLabel(t(key).slice(0, 45)).setTextInputComponent(input);
}

/** Modal de date de publication. */
export function buildDateModal(session: BuilderSession, t: Translator): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildCustomId('announce', 'date', session.id))
    .setTitle(t('announcements.modal.date.title').slice(0, 45))
    .addLabelComponents(label(t, 'announcements.modal.date.field_date', text('date', TextInputStyle.Short, { required: true, placeholder: t('announcements.modal.date.placeholder'), max: 40 })));
}

async function respond(interaction: ModalSubmitInteraction, session: BuilderSession, ctx: InteractionContext): Promise<void> {
  embedBuilderSessions.save(session);
  const payload = renderBuilder(session, renderContextFromInteraction(interaction, ctx));
  if (interaction.isFromMessage()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Modal des annonces : `announce:date:<sid>` (date de publication programmée). */
export default defineModal({
  id: 'announce',
  module: 'announcements',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guildId || !ctx.config) return;
    const [kind = '', sid = ''] = args;
    const session = embedBuilderSessions.get(interaction.guildId, interaction.user.id, sid);
    if (!session?.announcement) {
      await interaction.reply({ embeds: [embedService.warning(t('embeds.errors.session_expired'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const ann = session.announcement;
    const f = (id: string) => optionalText(interaction.fields.getTextInputValue(id));

    switch (kind) {
      case 'date': {
        const date = parseDateInput(f('date') ?? '');
        if (!date) {
          session.notice = { type: 'error', text: t('announcements.errors.invalid_date') };
          break;
        }
        if (date.getTime() <= Date.now()) {
          session.notice = { type: 'error', text: t('announcements.errors.past_date') };
          break;
        }
        ann.scheduledAt = date;
        session.notice = { type: 'success', text: t('announcements.builder.date_set') };
        break;
      }
      default:
        return;
    }
    session.view = 'main';
    await respond(interaction, session, ctx);
  },
});
