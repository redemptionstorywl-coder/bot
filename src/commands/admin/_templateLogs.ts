import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type MessageActionRowComponentBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { GuildKind, LogCategory } from '@prisma/client';
import type { InteractionContext } from '../../structures/types';
import { BRAND } from '../../config/constants';
import { prisma } from '../../database/client';
import { buildCustomId } from '../../utils/customId';
import { TTLCache } from '../../utils/cache';
import { childLogger } from '../../utils/logger';
import { embedService } from '../../services/EmbedService';
import { guildConfigService } from '../../services/GuildConfigService';
import { loggingService } from '../../services/LoggingService';
import { LogHubError, defaultSourceLabel, isPreselectedSource, logHubService, sourceEmoji, type SourceCandidate } from '../../services/LogHubService';
import { logTemplateService, type TemplateResult } from '../../services/LogTemplateService';
import { translationService } from '../../services/TranslationService';
import type { TemplateGameInput, TemplatePlan, TemplateSourceInput } from '../../services/logs/template';

/**
 * Interface Discord de `/template logs` (namespace `tpl`, boutons + menus, rattachés à la commande `template`, admin) :
 *  - `tpl:sources`            (menu, multiple) → serveurs Discord à relier (seuls ceux où l'utilisateur est admin / propriétaire)
 *  - `tpl:game:<id>`          (bouton)         → logs en jeu d'un serveur FiveM : non → oui → oui + chat
 *  - `tpl:create`             (bouton)         → relie, crée / répare la structure (progression), publie le sommaire
 *  - `tpl:remove` / `tpl:unlink` (menu) / `tpl:unlinkok:<s|g>:<id>` → retirer une source ou un serveur de jeu
 *  - `tpl:back` · `tpl:cancel`
 */

const log = childLogger('TemplateLogs');

export const TPL = 'tpl';
export const tid = (...parts: string[]): string => buildCustomId(TPL, ...parts);

type Ctx = Pick<InteractionContext, 't' | 'lang' | 'client'>;
type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
export type TemplatePayload = { embeds: EmbedBuilder[]; components: Row[] };
export type GameState = 'off' | 'on' | 'chat';

export interface TemplateGameServer {
  id: number;
  name: string;
  guildId: string;
  /** Déjà relié au hub (ne peut être retiré que par « Retirer ») */
  linked: boolean;
}

export interface TemplateSession {
  hubGuildId: string;
  userId: string;
  candidates: SourceCandidate[];
  selected: string[];
  gameServers: TemplateGameServer[];
  games: Record<string, GameState>;
}

/** Sessions (clé `${hubGuildId}:${userId}`), 30 min. */
export const templateSessions = new TTLCache<TemplateSession>(30 * 60_000, 500);
export const sessionKey = (guildId: string, userId: string): string => `${guildId}:${userId}`;

const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const row = (...c: MessageActionRowComponentBuilder[]): Row => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

/** Serveur sélectionnable : droit vérifié, pas un hub, libre ou déjà relié à CE hub. */
export const selectable = (c: SourceCandidate, hubGuildId: string): boolean => c.permission.allowed && !c.isHub && (!c.linkedHubId || c.linkedHubId === hubGuildId);

/** Prochain état d'un bouton de jeu (un jeu déjà relié ne s'éteint pas ici : « Retirer »). */
export function nextGameState(state: GameState, linked: boolean): GameState {
  if (state === 'off') return 'on';
  if (state === 'on') return 'chat';
  return linked ? 'on' : 'off';
}

/** Charge une session : serveurs éligibles, sélection par défaut (sources reliées, sinon « Battle Royale » / « Studio »), jeux. */
export async function loadSession(ctx: Ctx, guild: Guild, userId: string): Promise<TemplateSession> {
  const hub = await logHubService.getHub(guild.id);
  const candidates = await logHubService.eligibleSources(ctx.client, guild.id, userId);
  const allowed = candidates.filter((c) => selectable(c, guild.id));
  const linked = allowed.filter((c) => c.linkedHubId === guild.id).map((c) => c.guildId);
  const selected = hub && linked.length ? linked : [...new Set([...linked, ...allowed.filter((c) => isPreselectedSource(c.name)).map((c) => c.guildId)])];
  const servers = allowed.length ? ((await prisma.fiveMServer.findMany({ where: { guildId: { in: allowed.map((c) => c.guildId) } }, orderBy: { id: 'asc' } })) ?? []) : [];
  const linkedGames = hub ? await logHubService.listGames(guild.id) : [];
  const games: Record<string, GameState> = {};
  const gameServers: TemplateGameServer[] = servers.map((s) => {
    const link = linkedGames.find((g) => g.fivemServerId === s.id);
    games[String(s.id)] = link ? (link.chat ? 'chat' : 'on') : !hub && selected.includes(s.guildId) ? 'on' : 'off';
    return { id: s.id, name: s.name, guildId: s.guildId, linked: !!link };
  });
  const session: TemplateSession = { hubGuildId: guild.id, userId, candidates, selected, gameServers, games };
  templateSessions.set(sessionKey(guild.id, userId), session);
  return session;
}

/** Entrées du plan pour la sélection de la session (sources pas encore reliées : nom et emoji par défaut). */
export async function sessionInputs(session: TemplateSession): Promise<{ sources: TemplateSourceInput[]; games: (TemplateGameInput & { sourceGuildId: string })[] }> {
  const links = await logHubService.listSources(session.hubGuildId);
  const sources: TemplateSourceInput[] = [];
  // Sources déjà reliées toujours incluses (les décocher ne les délie pas : « Retirer une source »)
  const ids = [...new Set([...links.map((l) => l.sourceGuildId), ...session.selected])];
  for (const id of ids) {
    const candidate = session.candidates.find((c) => c.guildId === id);
    const link = links.find((l) => l.sourceGuildId === id);
    if (!candidate && !link) continue;
    const cfg = await guildConfigService.get(id);
    const name = candidate?.name ?? cfg?.name ?? id;
    sources.push({
      guildId: id,
      label: link?.label ?? defaultSourceLabel(name),
      emoji: link?.emoji ?? sourceEmoji(cfg?.kind ?? candidate?.kind ?? GuildKind.GENERIC, name),
      kind: cfg?.kind ?? candidate?.kind ?? GuildKind.GENERIC,
      modules: cfg?.modules ?? {},
      hasFiveM: session.gameServers.some((g) => g.guildId === id),
    });
  }
  const included = new Set(sources.map((s) => s.guildId));
  const games = session.gameServers
    .filter((g) => included.has(g.guildId) && session.games[String(g.id)] !== 'off')
    .map((g) => ({ serverId: g.id, name: g.name, chat: session.games[String(g.id)] === 'chat', sourceGuildId: g.guildId }));
  // Jeux déjà reliés d'une source dont l'utilisateur n'est pas administrateur : conservés tels quels
  for (const g of await logHubService.listGames(session.hubGuildId)) {
    if (g.server && !games.some((x) => x.serverId === g.fivemServerId)) games.push({ serverId: g.fivemServerId, name: g.server.name, chat: g.chat, sourceGuildId: g.server.guildId });
  }
  return { sources, games };
}

/** Lignes d'aperçu par catégorie : `**Catégorie** (n à créer) — salon, salon…`, dans un budget de caractères. */
export function previewLines(plan: TemplatePlan, t: Ctx['t'], budget = 3000): string[] {
  const lines: string[] = [];
  let used = 0;
  const cats = plan.items.filter((i) => i.kind === 'category');
  for (let i = 0; i < cats.length; i++) {
    const cat = cats[i]!;
    const children = plan.items.filter((c) => c.kind === 'text' && c.sourceKey === cat.sourceKey && c.parent === cat.route);
    const toCreate = children.filter((c) => c.status === 'create').length + (cat.status === 'create' ? 1 : 0);
    const status = toCreate ? t('loghub.template.to_create', { count: toCreate }) : t('loghub.template.complete');
    const line = `**${cat.name}** · ${status}\n${children.map((c) => (c.status === 'create' ? `**${c.name}**` : c.name)).join(' ')}`;
    if (used + line.length > budget) {
      lines.push(t('loghub.template.more_sections', { count: cats.length - i }));
      break;
    }
    lines.push(line);
    used += line.length + 2;
  }
  return lines;
}

function gameButton(server: TemplateGameServer, state: GameState): ButtonBuilder {
  const style = state === 'off' ? ButtonStyle.Secondary : state === 'chat' ? ButtonStyle.Primary : ButtonStyle.Success;
  return new ButtonBuilder()
    .setCustomId(tid('game', String(server.id)))
    .setLabel(cut(server.name, 60))
    .setEmoji(state === 'off' ? '⬜' : state === 'chat' ? '💬' : '🎮')
    .setStyle(style);
}

/** Vue principale : sélection, jeux, aperçu, boutons. */
export async function renderMain(ctx: Ctx, guild: Guild, session: TemplateSession, notice?: string): Promise<TemplatePayload> {
  const { t } = ctx;
  const hub = await logHubService.getHub(guild.id);
  const inputs = await sessionInputs(session);
  const { plan } = await logTemplateService.state(guild, inputs);
  const linkedSources = session.candidates.filter((c) => c.linkedHubId === guild.id);
  const embed = new EmbedBuilder()
    .setColor(BRAND.colors.primary)
    .setTitle(t('loghub.template.title'))
    .setDescription(cut([notice, t(hub ? 'loghub.template.hint_existing' : 'loghub.template.hint'), t('loghub.template.security')].filter(Boolean).join('\n\n'), 4096));
  if (hub) {
    embed.addFields({
      name: t('loghub.template.state_title'),
      value: cut(t('loghub.template.state', { sources: linkedSources.length, games: session.gameServers.filter((g) => g.linked).length, missing: plan.toCreate }), 1024),
    });
  }
  const sourceLines = inputs.sources.map((s) => `${s.emoji} **${s.label}**${linkedSources.some((c) => c.guildId === s.guildId) ? ` · ${t('loghub.template.linked')}` : ''}`);
  embed.addFields({ name: t('loghub.template.sources_title'), value: cut(sourceLines.join('\n') || t('loghub.template.no_source'), 1024) });
  const visibleGames = session.gameServers.filter((g) => session.selected.includes(g.guildId));
  if (visibleGames.length) {
    const lines = visibleGames.map((g) => `${session.games[String(g.id)] === 'off' ? '⬜' : session.games[String(g.id)] === 'chat' ? '💬' : '🎮'} **${g.name}** · ${t(`loghub.template.game_${session.games[String(g.id)] ?? 'off'}`)}`);
    embed.addFields({ name: t('loghub.template.games_title'), value: cut(`${lines.join('\n')}\n${t('loghub.template.games_hint')}`, 1024) });
  }
  // Serveurs non sélectionnables où l'utilisateur est membre (les autres serveurs du bot ne sont jamais listés).
  const unavailable = session.candidates.filter((c) => !selectable(c, guild.id) && (c.permission.allowed || c.permission.reason === 'not_admin')).slice(0, 10);
  if (unavailable.length) {
    const reason = (c: SourceCandidate) => (!c.permission.allowed ? t('loghub.template.reason_not_admin') : c.isHub ? t('loghub.template.reason_hub') : t('loghub.template.reason_other_hub', { hub: c.linkedHubName ?? c.linkedHubId ?? '?' }));
    embed.addFields({ name: t('loghub.template.unavailable_title'), value: cut(unavailable.map((c) => `• ${c.name} — ${reason(c)}`).join('\n'), 1024) });
  }
  const preview = previewLines(plan, t, 2800);
  let chunk = '';
  let fields = 0;
  for (const line of preview) {
    if (chunk.length + line.length + 2 > 1024 && chunk) {
      embed.addFields({ name: fields === 0 ? t('loghub.template.preview_title', { create: plan.toCreate, reuse: plan.reused }) : '​', value: chunk });
      fields++;
      chunk = '';
    }
    chunk += `${chunk ? '\n' : ''}${cut(line, 1024)}`;
  }
  if (chunk) embed.addFields({ name: fields === 0 ? t('loghub.template.preview_title', { create: plan.toCreate, reuse: plan.reused }) : '​', value: chunk });
  if (plan.guildLimitExceeded) embed.addFields({ name: '⚠️', value: t('loghub.template.guild_limit', { count: plan.channelsAfter }) });
  if (plan.skipped) embed.addFields({ name: '⚠️', value: t('loghub.template.category_full', { count: plan.skipped }) });

  const components: Row[] = [];
  const allowed = session.candidates.filter((c) => selectable(c, guild.id)).slice(0, 25);
  if (allowed.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(tid('sources'))
      .setPlaceholder(t('loghub.template.sources_placeholder'))
      .setMinValues(0)
      .setMaxValues(allowed.length)
      .addOptions(
        allowed.map((c) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(cut(c.name, 100))
            .setValue(c.guildId)
            .setDescription(cut(c.linkedHubId === guild.id ? t('loghub.template.option_linked') : t('loghub.template.option_free'), 100))
            .setDefault(session.selected.includes(c.guildId)),
        ),
      );
    components.push(row(select));
  }
  const buttons = visibleGames.slice(0, 10).map((g) => gameButton(g, session.games[String(g.id)] ?? 'off'));
  for (let i = 0; i < buttons.length; i += 5) components.push(row(...buttons.slice(i, i + 5)));
  const actions = [
    new ButtonBuilder().setCustomId(tid('create')).setLabel(t(hub ? 'loghub.template.btn_repair' : 'loghub.template.btn_create')).setStyle(ButtonStyle.Success).setEmoji('🏗️').setDisabled(!session.selected.length || plan.guildLimitExceeded),
  ];
  if (hub && (linkedSources.length || session.gameServers.some((g) => g.linked))) actions.push(new ButtonBuilder().setCustomId(tid('remove')).setLabel(t('loghub.template.btn_remove')).setStyle(ButtonStyle.Danger).setEmoji('➖'));
  actions.push(new ButtonBuilder().setCustomId(tid('cancel')).setLabel(t('core.cancel')).setStyle(ButtonStyle.Secondary));
  components.push(row(...actions));
  return { embeds: [embed], components };
}

/** Vue « Retirer une source » : menu des sources et jeux reliés. */
export async function renderRemove(ctx: Ctx, guild: Guild): Promise<TemplatePayload> {
  const { t } = ctx;
  const sources = await logHubService.listSources(guild.id);
  const games = await logHubService.listGames(guild.id);
  const embed = new EmbedBuilder().setColor(BRAND.colors.warning).setTitle(t('loghub.template.remove_title')).setDescription(t('loghub.template.remove_hint'));
  const options = [
    ...sources.map((s) => new StringSelectMenuOptionBuilder().setLabel(cut(`${s.emoji} ${s.label}`, 100)).setValue(`s:${s.sourceGuildId}`).setDescription(cut(t('loghub.template.remove_source_option'), 100))),
    ...games.map((g) => new StringSelectMenuOptionBuilder().setLabel(cut(`🎮 ${g.server?.name ?? g.fivemServerId}`, 100)).setValue(`g:${g.fivemServerId}`).setDescription(cut(t('loghub.template.remove_game_option'), 100))),
  ].slice(0, 25);
  const components: Row[] = [];
  if (options.length) components.push(row(new StringSelectMenuBuilder().setCustomId(tid('unlink')).setPlaceholder(t('loghub.template.remove_placeholder')).addOptions(options)));
  components.push(row(new ButtonBuilder().setCustomId(tid('back')).setLabel(t('core.back')).setStyle(ButtonStyle.Secondary).setEmoji('↩️')));
  return { embeds: [embed], components };
}

/** Confirmation du retrait. */
export async function renderRemoveConfirm(ctx: Ctx, guild: Guild, kind: 's' | 'g', id: string): Promise<TemplatePayload> {
  const { t } = ctx;
  let name = id;
  if (kind === 's') name = (await logHubService.listSources(guild.id)).find((s) => s.sourceGuildId === id)?.label ?? id;
  else name = (await logHubService.listGames(guild.id)).find((g) => String(g.fivemServerId) === id)?.server?.name ?? id;
  const embed = embedService.warning(t(kind === 's' ? 'loghub.template.remove_confirm_source' : 'loghub.template.remove_confirm_game', { name }), t('loghub.template.remove_title'));
  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder().setCustomId(tid('unlinkok', kind, id)).setLabel(t('loghub.template.btn_remove_confirm')).setStyle(ButtonStyle.Danger).setEmoji('➖'),
        new ButtonBuilder().setCustomId(tid('back')).setLabel(t('core.back')).setStyle(ButtonStyle.Secondary).setEmoji('↩️'),
      ),
    ],
  };
}

/** Barre de progression texte. */
export function progressBar(done: number, total: number, width = 16): string {
  const ratio = total ? Math.min(1, done / total) : 1;
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(ratio * 100)} %`;
}

/** Message d'erreur lisible d'un lien refusé. */
export function hubErrorText(t: Ctx['t'], err: unknown): string {
  if (err instanceof LogHubError) return t(`loghub.errors.${err.code}`, err.vars);
  return t('core.error');
}

/** Relie la sélection, applique la structure (progression dans le message), publie le sommaire. */
export async function runCreate(interaction: ButtonInteraction, ctx: Ctx, guild: Guild, session: TemplateSession): Promise<void> {
  const { t } = ctx;
  if (logTemplateService.isRunning(guild.id)) {
    await interaction.editReply(await renderMain(ctx, guild, session, `⏳ ${t('loghub.template.running')}`));
    return;
  }
  const errors: string[] = [];
  const newlyLinked: string[] = [];
  try {
    await logHubService.ensureHub(ctx.client, guild.id, interaction.user.id);
  } catch (err) {
    await interaction.editReply(await renderMain(ctx, guild, session, `❌ ${hubErrorText(t, err)}`));
    return;
  }
  const linked = new Set((await logHubService.listSources(guild.id)).map((s) => s.sourceGuildId));
  for (const id of session.selected) {
    if (linked.has(id)) continue;
    try {
      // Vérification de sécurité refaite ici (membre relu sur la source) : la session ne fait jamais foi.
      await logHubService.linkSource(ctx.client, guild.id, id, interaction.user.id);
      linked.add(id);
      newlyLinked.push(id);
    } catch (err) {
      errors.push(hubErrorText(t, err));
    }
  }
  for (const g of session.gameServers) {
    const state = session.games[String(g.id)] ?? 'off';
    if (state === 'off' || !linked.has(g.guildId)) continue;
    try {
      await logHubService.linkGame(guild.id, g.id, interaction.user.id, state === 'chat');
    } catch (err) {
      errors.push(hubErrorText(t, err));
    }
  }
  let lastEdit = 0;
  const result: TemplateResult = await logTemplateService.apply(ctx.client, guild, {
    onProgress: async (p) => {
      if (Date.now() - lastEdit < 1500 && p.done < p.total) return;
      lastEdit = Date.now();
      const embed = new EmbedBuilder()
        .setColor(BRAND.colors.primary)
        .setTitle(t('loghub.template.progress_title'))
        .setDescription(`${progressBar(p.done, p.total)}\n${t('loghub.template.progress', { done: p.done, total: p.total })}${p.current ? `\n${t('loghub.template.progress_current', { name: p.current })}` : ''}`);
      await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
    },
  });
  await auditHub(ctx, guild, interaction.user.id, newlyLinked, result);
  await interaction.editReply(renderResult(ctx, result, errors));
}

/** Journal : `hub.link` dans chaque source nouvellement reliée (transparence pour ses admins), `hub.template` dans le hub. */
async function auditHub(ctx: Ctx, guild: Guild, userId: string, newlyLinked: string[], result: TemplateResult): Promise<void> {
  for (const id of newlyLinked) {
    const cfg = await guildConfigService.get(id);
    const t = translationService.bind(cfg?.defaultLanguage ?? 'fr', id);
    await loggingService.log({
      guildId: id,
      category: LogCategory.SYSTEM,
      action: 'hub.link',
      title: t('loghub.audit.link_title'),
      description: t('loghub.audit.link', { hub: guild.name, hubId: guild.id, user: `<@${userId}>` }),
      actorId: userId,
      color: BRAND.colors.warning,
      data: { hubGuildId: guild.id },
    });
  }
  await loggingService.log({
    guildId: guild.id,
    category: LogCategory.SYSTEM,
    action: 'hub.template',
    title: ctx.t('loghub.audit.template_title'),
    description: ctx.t('loghub.audit.template', { created: result.created, reused: result.reused, failed: result.failed.length }),
    actorId: userId,
    color: BRAND.colors.primary,
    data: { created: result.created, reused: result.reused, failed: result.failed.length },
  });
}

/** Résultat final. */
export function renderResult(ctx: Ctx, result: TemplateResult, errors: string[]): TemplatePayload {
  const { t } = ctx;
  const ok = result.ok && !errors.length;
  const lines: string[] = [];
  if (result.error) lines.push(`❌ ${t(`loghub.template.result_errors.${result.error}`, { count: result.plan.channelsAfter })}`);
  else lines.push(t('loghub.template.result', { created: result.created, reused: result.reused }));
  if (result.summaryChannelId) lines.push(t('loghub.template.result_summary', { channel: `<#${result.summaryChannelId}>` }));
  if (result.skipped) lines.push(`⚠️ ${t('loghub.template.category_full', { count: result.skipped })}`);
  for (const f of result.failed.slice(0, 5)) lines.push(`❌ ${t('loghub.template.result_failed', { name: f.name, error: f.error })}`);
  for (const e of errors.slice(0, 5)) lines.push(`❌ ${e}`);
  if (!result.error) lines.push('', t('loghub.template.result_next'));
  const embed = new EmbedBuilder()
    .setColor(ok ? BRAND.colors.primary : BRAND.colors.warning)
    .setTitle(t(ok ? 'loghub.template.result_title' : 'loghub.template.result_title_partial'))
    .setDescription(cut(lines.join('\n'), 4096));
  return { embeds: [embed], components: [row(new ButtonBuilder().setCustomId(tid('back')).setLabel(t('loghub.template.btn_state')).setStyle(ButtonStyle.Secondary).setEmoji('🗂️'))] };
}

/** Retrait confirmé (depuis le hub). */
export async function runUnlink(ctx: Ctx, guild: Guild, userId: string, kind: 's' | 'g', id: string): Promise<string> {
  const { t } = ctx;
  if (kind === 's') {
    const ok = await logHubService.unlinkSource(guild.id, id);
    if (ok) {
      await loggingService.log({ guildId: guild.id, category: LogCategory.SYSTEM, action: 'hub.unlink', title: t('loghub.audit.unlink_title'), description: t('loghub.audit.unlink', { server: ctx.client.guilds.cache.get(id)?.name ?? id, user: `<@${userId}>` }), actorId: userId, color: BRAND.colors.warning, data: { sourceGuildId: id } });
      await logTemplateService.publishSummary(ctx.client, guild).catch((err) => log.debug({ err }, 'Sommaire non mis à jour'));
    }
    return ok ? `✅ ${t('loghub.template.removed_source')}` : `❌ ${t('loghub.errors.not_found')}`;
  }
  const ok = await logHubService.unlinkGame(guild.id, Number(id));
  if (ok) await logTemplateService.publishSummary(ctx.client, guild).catch((err) => log.debug({ err }, 'Sommaire non mis à jour'));
  return ok ? `✅ ${t('loghub.template.removed_game')}` : `❌ ${t('loghub.errors.not_found')}`;
}

/** Session courante (rechargée si expirée). */
export async function currentSession(ctx: Ctx, guild: Guild, userId: string): Promise<TemplateSession> {
  return templateSessions.get(sessionKey(guild.id, userId)) ?? (await loadSession(ctx, guild, userId));
}

/** Point d'entrée de la commande. */
export async function openTemplateLogs(interaction: ChatInputCommandInteraction, ctx: Ctx, guild: Guild): Promise<void> {
  const source = await logHubService.getSourceLink(guild.id);
  if (source) {
    const hubName = ctx.client.guilds.cache.get(source.hubGuildId)?.name ?? source.hubGuildId;
    await interaction.editReply({ embeds: [embedService.error(ctx.t('loghub.errors.is_source_here', { hub: hubName }))] });
    return;
  }
  const session = await loadSession(ctx, guild, interaction.user.id);
  await interaction.editReply(await renderMain(ctx, guild, session));
}

/** Menu de sélection des sources (seules les valeurs sélectionnables sont retenues). */
export async function selectSources(interaction: StringSelectMenuInteraction, ctx: Ctx, guild: Guild): Promise<void> {
  const session = await currentSession(ctx, guild, interaction.user.id);
  const allowed = new Set(session.candidates.filter((c) => selectable(c, guild.id)).map((c) => c.guildId));
  const before = new Set(session.selected);
  session.selected = interaction.values.filter((v) => allowed.has(v));
  // Serveur nouvellement coché : ses serveurs de jeu sont proposés activés (🎮), désactivables d'un clic
  for (const g of session.gameServers) if (!g.linked && !before.has(g.guildId) && session.selected.includes(g.guildId)) session.games[String(g.id)] = 'on';
  templateSessions.set(sessionKey(guild.id, interaction.user.id), session);
  await interaction.update(await renderMain(ctx, guild, session));
}
