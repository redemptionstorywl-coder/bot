import { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import type { Translator } from '../services/TranslationService';
import { embedService } from '../services/EmbedService';
import { announcementTranslationSchema, resolveTranslation } from '../services/AnnouncementService';
import { embedBuilderSessions, optionalText, renderBuilder, renderContextFromInteraction, type BuilderSession } from '../services/EmbedBuilderSession';
import { buildCustomId } from '../utils/customId';
import { parseDateInput } from '../utils/time';
import { getLanguage } from '../config/constants';

function text(id: string, style: TextInputStyle, opts: { value?: string; placeholder?: string; required?: boolean; max?: number } = {}): TextInputBuilder {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(opts.required ?? false);
  if (opts.max) input.setMaxLength(opts.max);
  if (opts.placeholder) input.setPlaceholder(opts.placeholder.slice(0, 100));
  if (opts.value) input.setValue(opts.value.slice(0, opts.max ?? 4000));
  return input;
}

function label(t: Translator, key: string, input: TextInputBuilder, vars?: Record<string, string>): LabelBuilder {
  return new LabelBuilder().setLabel(t(key, vars).slice(0, 45)).setTextInputComponent(input);
}

/** Modal de traduction (titre / description / contenu) pour une langue, pré-rempli. */
export function buildTranslationModal(session: BuilderSession, lang: string, t: Translator): ModalBuilder {
  const ann = session.announcement!;
  const existing = ann.translations[lang];
  const def = getLanguage(lang);
  const source = { spec: session.spec, content: session.content, translations: {}, sourceLanguage: ann.sourceLanguage };
  const fallback = resolveTranslation(source, ann.sourceLanguage);
  return new ModalBuilder()
    .setCustomId(buildCustomId('announce', 'tr', session.id, lang))
    .setTitle(t('announcements.modal.translation.title', { language: `${def?.flag ?? ''} ${def?.nativeLabel ?? lang}`.trim() }).slice(0, 45))
    .addLabelComponents(
      label(t, 'announcements.modal.translation.field_title', text('title', TextInputStyle.Short, { value: existing?.title, placeholder: fallback.spec.title, max: 256 })),
      label(t, 'announcements.modal.translation.field_description', text('description', TextInputStyle.Paragraph, { value: existing?.description, placeholder: fallback.spec.description, max: 4000 })),
      label(t, 'announcements.modal.translation.field_content', text('content', TextInputStyle.Paragraph, { value: existing?.content, placeholder: fallback.content, max: 2000 })),
    );
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

/** Modals des annonces : `announce:tr:<sid>:<lang>` et `announce:date:<sid>`. */
export default defineModal({
  id: 'announce',
  module: 'announcements',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guildId || !ctx.config) return;
    const [kind = '', sid = '', extra = ''] = args;
    const session = embedBuilderSessions.get(interaction.guildId, interaction.user.id, sid);
    if (!session?.announcement) {
      await interaction.reply({ embeds: [embedService.warning(t('embeds.errors.session_expired'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const ann = session.announcement;
    const f = (id: string) => optionalText(interaction.fields.getTextInputValue(id));

    switch (kind) {
      case 'tr': {
        const lang = extra;
        if (!ctx.config.enabledLanguages.includes(lang)) {
          session.notice = { type: 'error', text: t('core.invalid_input', { details: lang }) };
          break;
        }
        const candidate = { title: f('title'), description: f('description'), content: f('content') };
        if (!candidate.title && !candidate.description && !candidate.content) {
          delete ann.translations[lang];
          session.notice = { type: 'info', text: t('announcements.builder.translation_removed', { language: lang }) };
        } else {
          const r = announcementTranslationSchema.safeParse(candidate);
          if (!r.success) {
            session.notice = { type: 'error', text: t('embeds.errors.invalid_spec', { details: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n') }) };
            break;
          }
          // Saisie manuelle : le marqueur « auto » est retiré pour que la traduction ne soit plus régénérée.
          const { auto: _auto, sourceHash: _hash, ...existingPatch } = ann.translations[lang] ?? {};
          ann.translations[lang] = { ...existingPatch, ...r.data };
          session.notice = { type: 'success', text: t('announcements.builder.translation_saved', { language: lang }) };
        }
        break;
      }
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
