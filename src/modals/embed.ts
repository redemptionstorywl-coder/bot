import { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import type { Translator } from '../services/TranslationService';
import { embedService, type ButtonSpec, type EmbedSpec } from '../services/EmbedService';
import { EmbedTemplateError, embedTemplateService } from '../services/EmbedTemplateService';
import { embedBuilderSessions, optionalText, renderBuilder, renderContextFromInteraction, MAX_BUTTONS, MAX_EMBED_FIELDS, type BuilderSession } from '../services/EmbedBuilderSession';
import { buildCustomId } from '../utils/customId';
import { BRAND } from '../config/constants';

export type EmbedModalKind = 'title' | 'color' | 'images' | 'footer' | 'field' | 'content' | 'link' | 'template' | 'import';

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

const BRAND_COLOR_NAMES = Object.keys(BRAND.colors);

/** Construit le modal d'édition demandé, pré-rempli avec l'état de la session. */
export function buildEmbedModal(kind: EmbedModalKind, session: BuilderSession, t: Translator): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(buildCustomId('embed', kind, session.id)).setTitle(t(`embeds.modal.${kind}.title`).slice(0, 45));
  const s = session.spec;
  switch (kind) {
    case 'title':
      modal.addLabelComponents(
        label(t, 'embeds.modal.title.field_title', text('title', TextInputStyle.Short, { value: s.title, max: 256 })),
        label(t, 'embeds.modal.title.field_url', text('url', TextInputStyle.Short, { value: s.url, placeholder: 'https://…', max: 2048 })),
        label(t, 'embeds.modal.title.field_description', text('description', TextInputStyle.Paragraph, { value: s.description, max: 4000, placeholder: t('embeds.modal.title.description_placeholder') })),
      );
      break;
    case 'color':
      modal.addLabelComponents(label(t, 'embeds.modal.color.field_hex', text('color', TextInputStyle.Short, { value: s.color, placeholder: `#7C3AED · ${BRAND_COLOR_NAMES.join(', ')}`, max: 20 })));
      break;
    case 'images':
      modal.addLabelComponents(
        label(t, 'embeds.modal.images.field_image', text('image', TextInputStyle.Short, { value: s.image, placeholder: 'https://…', max: 2048 })),
        label(t, 'embeds.modal.images.field_thumbnail', text('thumbnail', TextInputStyle.Short, { value: s.thumbnail, placeholder: 'https://…', max: 2048 })),
      );
      break;
    case 'footer':
      modal.addLabelComponents(
        label(t, 'embeds.modal.footer.field_footer', text('footerText', TextInputStyle.Short, { value: s.footer?.text, max: 2048 })),
        label(t, 'embeds.modal.footer.field_footer_icon', text('footerIcon', TextInputStyle.Short, { value: s.footer?.iconUrl, placeholder: 'https://…', max: 2048 })),
        label(t, 'embeds.modal.footer.field_author', text('authorName', TextInputStyle.Short, { value: s.author?.name, max: 256 })),
        label(t, 'embeds.modal.footer.field_author_icon', text('authorIcon', TextInputStyle.Short, { value: s.author?.iconUrl, placeholder: 'https://…', max: 2048 })),
        label(t, 'embeds.modal.footer.field_author_url', text('authorUrl', TextInputStyle.Short, { value: s.author?.url, placeholder: 'https://…', max: 2048 })),
      );
      break;
    case 'field':
      modal.addLabelComponents(
        label(t, 'embeds.modal.field.field_name', text('name', TextInputStyle.Short, { required: true, max: 256 })),
        label(t, 'embeds.modal.field.field_value', text('value', TextInputStyle.Paragraph, { required: true, max: 1024 })),
        label(t, 'embeds.modal.field.field_inline', text('inline', TextInputStyle.Short, { placeholder: t('embeds.modal.field.inline_placeholder'), max: 5 })),
      );
      break;
    case 'content':
      modal.addLabelComponents(label(t, 'embeds.modal.content.field_content', text('content', TextInputStyle.Paragraph, { value: session.content, max: 2000, placeholder: t('embeds.modal.content.placeholder') })));
      break;
    case 'link':
      modal.addLabelComponents(
        label(t, 'embeds.modal.link.field_label', text('label', TextInputStyle.Short, { required: true, max: 80 })),
        label(t, 'embeds.modal.link.field_url', text('url', TextInputStyle.Short, { required: true, placeholder: 'https://…', max: 2048 })),
        label(t, 'embeds.modal.link.field_emoji', text('emoji', TextInputStyle.Short, { max: 64 })),
      );
      break;
    case 'template':
      modal.addLabelComponents(
        label(t, 'embeds.modal.template.field_name', text('name', TextInputStyle.Short, { required: true, value: s.title, max: 100 })),
        label(t, 'embeds.modal.template.field_description', text('description', TextInputStyle.Short, { max: 190 })),
      );
      break;
    case 'import':
      modal.addLabelComponents(label(t, 'embeds.modal.import.field_json', text('json', TextInputStyle.Paragraph, { required: true, max: 4000, placeholder: '{ "title": "…", "description": "…" }' })));
      break;
  }
  return modal;
}

function parseInline(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return !!v && ['oui', 'yes', 'true', '1', 'o', 'y'].includes(v);
}

/** Valide un spec candidat et l'applique à la session, ou renvoie une erreur lisible. */
function applySpec(session: BuilderSession, candidate: EmbedSpec, t: Translator): boolean {
  const r = embedService.safeValidate(candidate);
  if (!r.success) {
    session.notice = { type: 'error', text: t('embeds.errors.invalid_spec', { details: r.error.slice(0, 800) }) };
    return false;
  }
  session.spec = r.data;
  return true;
}

async function respond(interaction: ModalSubmitInteraction, session: BuilderSession, ctx: InteractionContext): Promise<void> {
  embedBuilderSessions.save(session);
  const payload = renderBuilder(session, renderContextFromInteraction(interaction, ctx));
  if (interaction.isFromMessage()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

export default defineModal({
  id: 'embed',
  module: 'embeds',
  permissions: { internal: 'staff' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guildId || !ctx.config) return;
    const [kind = '', sid = ''] = args;
    const session = embedBuilderSessions.get(interaction.guildId, interaction.user.id, sid);
    if (!session) {
      await interaction.reply({ embeds: [embedService.warning(t('embeds.errors.session_expired'))], flags: MessageFlags.Ephemeral });
      return;
    }
    const f = (id: string) => optionalText(interaction.fields.getTextInputValue(id));
    const spec: EmbedSpec = { ...session.spec };

    switch (kind as EmbedModalKind) {
      case 'title':
        applySpec(session, { ...spec, title: f('title'), url: f('url'), description: f('description') }, t);
        break;
      case 'color': {
        const raw = f('color');
        let color: string | undefined;
        if (raw) {
          const named = (BRAND.colors as Record<string, number>)[raw.toLowerCase()];
          color = named !== undefined ? `#${named.toString(16).padStart(6, '0').toUpperCase()}` : raw.startsWith('#') ? raw : `#${raw}`;
        }
        applySpec(session, { ...spec, color }, t);
        break;
      }
      case 'images':
        applySpec(session, { ...spec, image: f('image'), thumbnail: f('thumbnail') }, t);
        break;
      case 'footer': {
        const footerText = f('footerText');
        const authorName = f('authorName');
        applySpec(
          session,
          {
            ...spec,
            footer: footerText ? { text: footerText, iconUrl: f('footerIcon') } : undefined,
            author: authorName ? { name: authorName, iconUrl: f('authorIcon'), url: f('authorUrl') } : undefined,
          },
          t,
        );
        break;
      }
      case 'field': {
        const fields = [...(spec.fields ?? [])];
        if (fields.length >= MAX_EMBED_FIELDS) {
          session.notice = { type: 'error', text: t('embeds.errors.fields_limit', { max: MAX_EMBED_FIELDS }) };
          break;
        }
        fields.push({ name: f('name') ?? '', value: f('value') ?? '', inline: parseInline(f('inline')) });
        if (applySpec(session, { ...spec, fields }, t)) session.notice = { type: 'success', text: t('embeds.builder.field_added') };
        break;
      }
      case 'content':
        session.content = f('content');
        break;
      case 'link': {
        if (session.buttons.length >= MAX_BUTTONS) {
          session.notice = { type: 'error', text: t('embeds.errors.buttons_limit', { max: MAX_BUTTONS }) };
          break;
        }
        const candidate = { label: f('label') ?? '', style: 'link', url: f('url'), emoji: f('emoji') };
        try {
          const [btn] = embedTemplateService.validateButtons([candidate]);
          session.buttons.push(btn as ButtonSpec);
          session.notice = { type: 'success', text: t('embeds.builder.button_added') };
        } catch (err) {
          session.notice = { type: 'error', text: err instanceof EmbedTemplateError ? t(`embeds.errors.${err.code}`, { details: err.details ?? '' }) : t('core.error') };
        }
        break;
      }
      case 'template': {
        const name = f('name') ?? '';
        try {
          const { created } = await embedTemplateService.upsertByName(interaction.guildId, { name, description: f('description') ?? null, spec: session.spec, buttons: session.buttons }, interaction.user.id);
          session.notice = { type: 'success', text: t(created ? 'embeds.builder.template_saved' : 'embeds.builder.template_updated', { name }) };
        } catch (err) {
          session.notice = { type: 'error', text: err instanceof EmbedTemplateError ? t(`embeds.errors.${err.code}`, { details: err.details ?? '' }) : t('core.error') };
        }
        break;
      }
      case 'import': {
        const parsed = embedTemplateService.parseImport(f('json') ?? '');
        if (!parsed.success) {
          session.notice = { type: 'error', text: t('embeds.errors.invalid_json', { details: parsed.error.slice(0, 900) }) };
          break;
        }
        session.spec = parsed.data.embeds?.[0] ?? {};
        if (parsed.data.content !== undefined) session.content = parsed.data.content;
        if (parsed.data.buttons) session.buttons = parsed.data.buttons;
        session.notice = { type: 'success', text: t('embeds.builder.imported') };
        break;
      }
      default:
        return;
    }
    await respond(interaction, session, ctx);
  },
});
