import { ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder, TextInputStyle, type Guild, type ModalBuilder } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { buildCustomId } from '../utils/customId';
import { embedService } from '../services/EmbedService';
import { MAX_QUESTIONS, whitelistQuestionSchema, whitelistService, type WhitelistQuestion } from '../services/WhitelistService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import { PanelError, btn, channelMention, labelled, modal, moduleButton, moduleLine, roleMention, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload } from './_modulesKit';

/**
 * Panneau `/config module:whitelist` — namespace `cfg-whitelist` (admin) :
 *  - boutons : `main`, `module`, `open` (candidatures ouvertes / fermées), `dm` (DM des décisions), `questions` (modal)
 *  - menus   : `review` (ChannelSelect), `accepted` / `pending` (RoleSelect, 0–1)
 * Les actions restent des commandes : /whitelist apply · status · review · list.
 */

export const WL_NS = 'cfg-whitelist';
export const WL_KINDS: GuildKind[] = [GuildKind.PRISON, GuildKind.SCHOOL];
export const wcid = (action: string): string => buildCustomId(WL_NS, action);

// ───── Questions : `Libellé | paragraph/short | required/optional | placeholder` ─────

export function serializeWhitelistQuestion(q: WhitelistQuestion): string {
  return [q.label, q.style, q.required ? 'required' : 'optional', q.placeholder ?? ''].join(' | ').replace(/(\s\|\s*)+$/, '');
}

export function parseWhitelistQuestionLine(line: string, slot: number): WhitelistQuestion | null {
  const raw = line.trim();
  if (!raw) return null;
  const [label = '', style = '', required = '', placeholder = ''] = raw.split('|').map((p) => p.trim());
  const candidate = {
    id: `q${slot}`,
    label,
    placeholder: placeholder ? placeholder.slice(0, 100) : undefined,
    style: /^(s|short|court|courte|ligne)/i.test(style) ? 'short' : 'paragraph',
    required: !/^(optional|optionnel|optionnelle|facultatif|false|no|non|0)$/i.test(required),
  };
  const r = whitelistQuestionSchema.safeParse(candidate);
  if (!r.success) throw new PanelError('panels_modules.whitelist.invalid_question', { slot, max: 45 });
  return r.data;
}

/** Parse les champs du modal (vides ignorés). Aucune question = questions par défaut. */
export function parseWhitelistQuestionSlots(values: (string | undefined)[]): WhitelistQuestion[] {
  const out: WhitelistQuestion[] = [];
  values.slice(0, MAX_QUESTIONS).forEach((v, i) => {
    const q = parseWhitelistQuestionLine(v ?? '', i + 1);
    if (q) out.push(q);
  });
  return out;
}

// ───── Rendu ─────

export interface WlRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  lang: string;
  notice?: PanelNotice;
}

export async function renderWhitelist(opts: WlRenderOptions): Promise<PanelPayload> {
  const { guild, config, t, lang, notice } = opts;
  const [s, counts] = await Promise.all([whitelistService.getConfig(guild.id), whitelistService.counts(guild.id)]);
  const questions = whitelistService.resolveQuestions(s, lang);
  const none = t('core.none');
  const embed = embedService
    .brand(t('panels_modules.whitelist.title', { server: guild.name }))
    .setDescription(withNotice(notice, `${t('panels_modules.whitelist.hint')}\n\n${moduleLine(config, 'whitelist', t, WL_KINDS)}`))
    .addFields(
      { name: t('whitelist.config.enabled'), value: s.enabled ? t('panels_modules.whitelist.open') : t('panels_modules.whitelist.closed'), inline: true },
      { name: t('whitelist.config.dm'), value: s.dmOnDecision ? t('core.yes') : t('core.no'), inline: true },
      { name: t('panels_modules.whitelist.field_counts'), value: `⏳ ${counts.PENDING} · ✅ ${counts.ACCEPTED} · ⛔ ${counts.REJECTED}`, inline: true },
      { name: t('whitelist.config.review_channel'), value: channelMention(s.reviewChannelId, none), inline: true },
      { name: t('whitelist.config.accepted_role'), value: roleMention(s.acceptedRoleId, none), inline: true },
      { name: t('whitelist.config.pending_role'), value: roleMention(s.pendingRoleId, none), inline: true },
      {
        name: t('whitelist.config.questions', { count: questions.length }) + (s.questions.length ? '' : ` — ${t('whitelist.config.default')}`),
        value: truncate(questions.map((q, i) => `${i + 1}. ${q.label} · ${q.style === 'short' ? t('panels_modules.whitelist.style_short') : t('panels_modules.whitelist.style_paragraph')}${q.required ? '' : ` · ${t('panels_modules.whitelist.optional')}`}`).join('\n') || none, 1024),
      },
    );

  const review = new ChannelSelectMenuBuilder().setCustomId(wcid('review')).setPlaceholder(truncate(t('panels_modules.whitelist.review_placeholder'), 150)).addChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (s.reviewChannelId) review.setDefaultChannels(s.reviewChannelId);
  const accepted = new RoleSelectMenuBuilder().setCustomId(wcid('accepted')).setPlaceholder(truncate(t('panels_modules.whitelist.accepted_placeholder'), 150)).setMinValues(0).setMaxValues(1);
  if (s.acceptedRoleId) accepted.setDefaultRoles(s.acceptedRoleId);
  const pending = new RoleSelectMenuBuilder().setCustomId(wcid('pending')).setPlaceholder(truncate(t('panels_modules.whitelist.pending_placeholder'), 150)).setMinValues(0).setMaxValues(1);
  if (s.pendingRoleId) pending.setDefaultRoles(s.pendingRoleId);

  return {
    embeds: [embed],
    components: [
      row(review),
      row(accepted),
      row(pending),
      row(
        btn(wcid('open'), s.enabled ? t('panels_modules.whitelist.btn_close') : t('panels_modules.whitelist.btn_open'), s.enabled ? ButtonStyle.Success : ButtonStyle.Danger, s.enabled ? '🟢' : '🔴'),
        btn(wcid('dm'), t('panels_modules.whitelist.btn_dm'), s.dmOnDecision ? ButtonStyle.Primary : ButtonStyle.Secondary, s.dmOnDecision ? '✉️' : '📭'),
        btn(wcid('questions'), t('panels_modules.whitelist.btn_questions'), ButtonStyle.Secondary, '❓'),
        moduleButton(wcid('module'), 'whitelist', config.modules.whitelist, t),
        btn(wcid('main'), t('panels_modules.common.refresh'), ButtonStyle.Secondary, '🔄'),
      ),
    ],
  };
}

export async function buildQuestionsModal(guildId: string, t: Translator): Promise<ModalBuilder> {
  const s = await whitelistService.getConfig(guildId);
  return modal(
    wcid('questions'),
    t('whitelist.config.questions_modal_title'),
    ...Array.from({ length: MAX_QUESTIONS }, (_, i) => {
      const q = s.questions[i];
      return labelled(
        t('whitelist.config.question_n', { n: i + 1 }),
        textInput(`q${i + 1}`, TextInputStyle.Short, { max: 200, value: q ? serializeWhitelistQuestion(q) : undefined, placeholder: t('panels_modules.whitelist.question_placeholder') }),
        i === 0 ? t('panels_modules.whitelist.questions_help') : undefined,
      );
    }),
  );
}
