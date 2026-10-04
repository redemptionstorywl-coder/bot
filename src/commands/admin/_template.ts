import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type EmbedBuilder } from 'discord.js';
import { BRAND } from '../../config/constants';
import { embedService } from '../../services/EmbedService';
import type { PlanStep, ReportStep, StepMessage, StructureItem, TemplateReport } from '../../services/TemplateService';
import type { ServerTemplate } from '../../templates';
import type { Translator } from '../../services/TranslationService';
import { buildCustomId } from '../../utils/customId';
import { chunk } from '../../utils/pagination';

const STATUS_ICON: Record<PlanStep['status'] | ReportStep['status'], string> = { ready: '✅', done: '✅', skipped: '⚠️', failed: '❌' };
const STEPS_PER_PAGE = 8;

export function templateName(t: Translator, tpl: ServerTemplate): string {
  return t(`admin.template.templates.${tpl.key}.name`);
}

function stepLabel(t: Translator, msg: StepMessage): string {
  return t(`admin.template.steps.${msg.key}`, msg.vars);
}

function stepReason(t: Translator, msg: StepMessage | undefined): string {
  return msg ? t(`admin.template.reasons.${msg.key}`, msg.vars) : '';
}

function targetsLine(step: Pick<PlanStep, 'targets'>): string {
  return step.targets
    .slice(0, 8)
    .map((x) => (x.kind === 'role' ? `<@&${x.id}>` : x.pending ? `🆕 #${x.name}` : `<#${x.id}>`))
    .join(' ');
}

/** Compte des salons / catégories à créer et existants d'une étape `structure`. */
export function structureCounts(items: StructureItem[] | undefined): { created: number; reused: number } {
  return { created: items?.filter((i) => i.status === 'create').length ?? 0, reused: items?.filter((i) => i.status === 'reuse').length ?? 0 };
}

/** Détail de l'étape `structure` : résumé, puis une ligne par catégorie (🆕 à créer / ♻️ existant). */
function structureLines(t: Translator, items: StructureItem[], done: boolean): string[] {
  const { created, reused } = structureCounts(items);
  const lines = [t(done ? 'admin.template.structure_report' : 'admin.template.structure_summary', { created, reused }), t('admin.template.structure_legend')];
  const categories = [...new Set(items.map((i) => i.category))];
  for (const category of categories) {
    const header = items.find((i) => i.kind === 'category' && i.category === category)!;
    const channels = items.filter((i) => i.kind === 'channel' && i.category === category);
    // Après application, les salons créés ont un ID : on les mentionne mais ils restent marqués 🆕.
    const label = (i: StructureItem, bold = false) => (done && i.id ? `<#${i.id}>` : bold ? `**${i.name}**` : i.name);
    const render = (i: StructureItem) => `${i.status === 'create' ? '🆕' : '♻️'} ${label(i)}`;
    const prefix = `${header.status === 'create' ? '🆕' : '♻️'} ${label(header, true)}`;
    lines.push(channels.length ? `${prefix} — ${channels.map(render).join(' · ')}` : prefix);
  }
  return lines;
}

function stepField(t: Translator, step: PlanStep | ReportStep): { name: string; value: string } {
  const lines: string[] = [];
  if (step.status === 'skipped' || step.status === 'failed') lines.push(stepReason(t, step.reason));
  if (step.items) lines.push(...structureLines(t, step.items, step.status === 'done'));
  else {
    if (step.detail) lines.push(step.detail);
    const targets = targetsLine(step);
    if (targets && !step.detail?.includes('<#') && !step.detail?.includes('<@&') && !step.detail?.includes('🆕')) lines.push(targets);
  }
  return { name: `${STATUS_ICON[step.status]} ${stepLabel(t, step.label)}`, value: lines.filter(Boolean).join('\n').slice(0, 1024) || '—' };
}

/** Pages d'un plan (dry run) ou d'un rapport : une étape par champ, 8 étapes par page. */
export function renderStepPages(t: Translator, opts: { title: string; description: string; steps: (PlanStep | ReportStep)[]; footer?: string; color?: number; recommended?: TemplateReport['recommended'] }): EmbedBuilder[] {
  const pages = chunk(opts.steps, STEPS_PER_PAGE);
  if (!pages.length) pages.push([]);
  return pages.map((steps, i) => {
    const embed = embedService.brand(opts.title, opts.description).setColor(opts.color ?? BRAND.colors.primary);
    embed.addFields(steps.map((s) => stepField(t, s)));
    if (i === pages.length - 1 && opts.recommended?.length) {
      const value = opts.recommended.map((r) => `${t(`admin.template.recommended_${r.key}`)} : ${r.channel ? `<#${r.channel.id}>` : '—'}`).join('\n');
      embed.addFields({ name: t('admin.template.recommended'), value: `${value}\n${t('admin.template.recommended_hint')}` });
    }
    const footer = [opts.footer, pages.length > 1 ? t('admin.template.page_footer', { page: i + 1, pages: pages.length }) : null].filter(Boolean).join(' • ');
    embed.setFooter({ text: footer || BRAND.footer });
    return embed;
  });
}

export function renderPlanPages(t: Translator, tpl: ServerTemplate, steps: PlanStep[], opts: { dryRun: boolean }): EmbedBuilder[] {
  const ready = steps.filter((s) => s.status === 'ready').length;
  const skipped = steps.length - ready;
  return renderStepPages(t, {
    title: t('admin.template.plan_title', { emoji: tpl.emoji, name: templateName(t, tpl) }),
    description: t('admin.template.plan_description', { ready, skipped }),
    steps,
    footer: opts.dryRun ? t('admin.template.dry_run_footer') : undefined,
  });
}

export function renderReportPages(t: Translator, report: TemplateReport): EmbedBuilder[] {
  const count = (status: ReportStep['status']) => report.steps.filter((s) => s.status === status).length;
  const failed = count('failed');
  return renderStepPages(t, {
    title: t('admin.template.report_title', { emoji: report.template.emoji, name: templateName(t, report.template) }),
    description: t('admin.template.report_description', { done: count('done'), skipped: count('skipped'), failed }),
    steps: report.steps,
    color: failed ? BRAND.colors.warning : BRAND.colors.primary,
    recommended: report.recommended,
  });
}

export function confirmRow(t: Translator, templateKey: string, userId: string, createMissing = true): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId('tpl', 'apply', templateKey, userId, createMissing ? '1' : '0')).setLabel(t('admin.template.confirm_button')).setEmoji('🧩').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId('tpl', 'cancel', templateKey, userId)).setLabel(t('admin.template.cancel_button')).setStyle(ButtonStyle.Secondary),
  );
}

/** Résumé compact du plan (une ligne par étape, nombre de salons à créer) pour l'écran de confirmation. */
export function renderPlanSummary(t: Translator, tpl: ServerTemplate, steps: PlanStep[]): EmbedBuilder {
  const ready = steps.filter((s) => s.status === 'ready').length;
  const structure = steps.find((s) => s.id === 'structure');
  const lines = steps.map((s) => {
    const suffix = s.status === 'skipped' ? ` — ${stepReason(t, s.reason)}` : s.id === 'structure' ? ` — ${t('admin.template.structure_summary', structureCounts(s.items))}` : '';
    return `${STATUS_ICON[s.status]} ${stepLabel(t, s.label)}${suffix}`;
  });
  const intro = [t('admin.template.plan_description', { ready, skipped: steps.length - ready }), structure ? t('admin.template.confirm_structure', structureCounts(structure.items)) : t('admin.template.confirm_no_structure')];
  return embedService
    .brand(t('admin.template.plan_title', { emoji: tpl.emoji, name: templateName(t, tpl) }), `${intro.join('\n')}\n\n${lines.join('\n')}`.slice(0, 4096))
    .setFooter({ text: BRAND.footer });
}
