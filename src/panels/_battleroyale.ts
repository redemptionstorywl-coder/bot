import { ButtonStyle, StringSelectMenuBuilder, TextInputStyle, UserSelectMenuBuilder, type Guild, type ModalBuilder } from 'discord.js';
import { GuildKind, type BattlePass } from '@prisma/client';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { embedService } from '../services/EmbedService';
import { PROFILE_FIELDS, STAT_FIELDS, battleRoyaleService, defaultTiers, parseTiers, type BattlePassTier, type ProfileField, type StatField } from '../services/BattleRoyaleService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import { PanelError, btn, fieldLines, labelled, modal, moduleButton, moduleLine, option, parseIntField, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload, type Row } from './_modulesKit';

/**
 * Panneau `/config module:battleroyale` — namespace `cfg-battleroyale` (admin) :
 *  - vue principale : `main`, `module`, `season` (StringSelect : saison active), `season-new` / `stat` / `xp` / `link` (modals)
 *  - Battle Pass    : `bp`, `tiers` (modal multi-lignes `palier | xp | gratuit | premium`), `gen` (modal : génération des paliers)
 * Les commandes joueurs restent : /profile, /leaderboard, /battlepass, /br-link.
 */

export const BR_NS = 'cfg-battleroyale';
export const BR_KINDS: GuildKind[] = [GuildKind.BATTLE_ROYALE];
export const bcid = (action: string, ...args: (string | number)[]): string => buildCustomId(BR_NS, action, ...args);

export const MAX_TIERS = 100;
export const TIERS_INPUT_MAX = 4000;
export const STAT_CHOICES = [...STAT_FIELDS, ...PROFILE_FIELDS] as const;
export type StatChoice = StatField | ProfileField;
export const isStatChoice = (v: string | undefined): v is StatChoice => (STAT_CHOICES as readonly string[]).includes(v ?? '');

// ───── Fonctions pures ─────

const NONE_REWARD = /^(-|—|none|aucun|aucune)?$/i;

/** `palier | xp | récompense gratuite | récompense premium` (une ligne par palier, `-` = aucune récompense). */
export function serializeTiers(tiers: BattlePassTier[]): string {
  return [...tiers]
    .sort((a, b) => a.tier - b.tier)
    .map((tier) => [tier.tier, tier.xpRequired, tier.freeReward || '-', tier.premiumReward || '-'].join(' | '))
    .join('\n');
}

/**
 * Parse la saisie multi-lignes des paliers. Lignes vides et commentaires (`#`) ignorés.
 * Lance PanelError (ligne fautive) si un palier est invalide, dupliqué, ou si l'XP décroît d'un palier à l'autre.
 */
export function parseTierLines(text: string): BattlePassTier[] {
  const out: BattlePassTier[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [tierRaw = '', xpRaw = '', free = '', premium = '', ...rest] = line.split('|').map((p) => p.trim());
    const tier = Number(tierRaw);
    const xp = Number(xpRaw.replace(/[\s_]/g, ''));
    if (rest.length || !/^\d+$/.test(tierRaw) || tier < 1 || !/^\d+$/.test(xpRaw.replace(/[\s_]/g, '')) || free.length > 200 || premium.length > 200) {
      throw new PanelError('panels_modules.battleroyale.tier_invalid', { line: i + 1, content: truncate(line, 80) });
    }
    if (out.some((x) => x.tier === tier)) throw new PanelError('panels_modules.battleroyale.tier_duplicate', { line: i + 1, tier });
    out.push({ tier, xpRequired: xp, freeReward: NONE_REWARD.test(free) ? null : free, premiumReward: NONE_REWARD.test(premium) ? null : premium });
  });
  if (out.length > MAX_TIERS) throw new PanelError('panels_modules.battleroyale.too_many_tiers', { max: MAX_TIERS });
  out.sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.xpRequired < out[i - 1]!.xpRequired) throw new PanelError('panels_modules.battleroyale.tier_xp_order', { tier: out[i]!.tier });
  }
  return out;
}

/** Génère `count` paliers de `xpPerTier` XP en conservant les récompenses des paliers existants de même numéro. */
export function generateTiers(count: number, xpPerTier: number, existing: BattlePassTier[] = []): BattlePassTier[] {
  return defaultTiers(count, xpPerTier).map((tier) => {
    const prev = existing.find((e) => e.tier === tier.tier);
    return { ...tier, freeReward: prev?.freeReward ?? null, premiumReward: prev?.premiumReward ?? null };
  });
}

/** Date `AAAA-MM-JJ` (ou `JJ/MM/AAAA`) → minuit UTC ; vide → `fallback`. */
export function parseDateInput(raw: string | undefined, fallback: Date, label: string): Date {
  const v = (raw ?? '').trim();
  if (!v) return fallback;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const fr = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const [y, m, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : fr ? [Number(fr[3]), Number(fr[2]), Number(fr[1])] : [NaN, NaN, NaN];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new PanelError('panels_modules.battleroyale.invalid_date', { field: label, value: v });
  return date;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Valeur d'une stat : booléen pour `battlePassPremium`, entier ≥ 0 sinon. */
export function parseStatValue(field: StatChoice, raw: string | undefined, label: string): number | boolean {
  const v = (raw ?? '').trim().toLowerCase();
  if (field === 'battlePassPremium') {
    if (['true', '1', 'yes', 'oui', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'non', 'off'].includes(v)) return false;
    throw new PanelError('panels_modules.common.invalid_number', { field: label, value: raw ?? '' });
  }
  return parseIntField(raw, label, { min: 0, max: 1_000_000_000 })!;
}

// ───── Rendu ─────

export interface BrRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  notice?: PanelNotice;
}

function seasonLine(s: BattlePass): string {
  return `${s.active ? '🟢' : '⚪'} **${s.season}** · ${s.name} · ${discordTimestamp(s.startsAt, 'd')} → ${discordTimestamp(s.endsAt, 'd')}`;
}

export async function renderMain(opts: BrRenderOptions): Promise<PanelPayload> {
  const { guild, config, t, notice } = opts;
  const seasons = await battleRoyaleService.listSeasons(guild.id);
  const active = seasons.find((s) => s.active) ?? null;
  const embed = embedService.brand(t('panels_modules.battleroyale.title', { server: guild.name })).setDescription(withNotice(notice, `${t('panels_modules.battleroyale.hint')}\n\n${moduleLine(config, 'battleRoyale', t, BR_KINDS)}`));
  embed.addFields(
    {
      name: t('panels_modules.battleroyale.field_current'),
      value: active
        ? t('panels_modules.battleroyale.current_value', { season: active.season, name: active.name, start: discordTimestamp(active.startsAt, 'D'), end: discordTimestamp(active.endsAt, 'D'), ends: discordTimestamp(active.endsAt, 'R'), tiers: parseTiers(active.tiers).length })
        : t('panels_modules.battleroyale.no_season'),
    },
    { name: t('panels_modules.battleroyale.field_seasons', { count: seasons.length }), value: fieldLines(seasons.slice(0, 15).map(seasonLine), t('core.none')) },
  );
  const components: Row[] = [];
  if (seasons.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(bcid('season'))
          .setPlaceholder(truncate(t('panels_modules.battleroyale.season_placeholder'), 150))
          .addOptions(seasons.slice(0, 25).map((s) => option(`${t('panels_modules.battleroyale.season_label', { season: s.season })} · ${s.name}`, String(s.season), { description: `${isoDate(s.startsAt)} → ${isoDate(s.endsAt)}`, emoji: s.active ? '🟢' : '⚪', default: s.active }))),
      ),
    );
  }
  components.push(
    row(
      btn(bcid('season-new'), t('panels_modules.battleroyale.btn_new_season'), ButtonStyle.Success, '🆕'),
      btn(bcid('bp'), t('panels_modules.battleroyale.btn_battlepass'), ButtonStyle.Primary, '🎟️', !active),
      btn(bcid('stat'), t('panels_modules.battleroyale.btn_stats'), ButtonStyle.Secondary, '🛠️'),
      btn(bcid('xp'), t('panels_modules.battleroyale.btn_xp'), ButtonStyle.Secondary, '✨'),
      btn(bcid('link'), t('panels_modules.battleroyale.btn_link'), ButtonStyle.Secondary, '🔗'),
    ),
    row(moduleButton(bcid('module'), 'battleRoyale', config.modules.battleRoyale, t), btn(bcid('main'), t('panels_modules.common.refresh'), ButtonStyle.Secondary, '🔄')),
  );
  return { embeds: [embed], components };
}

export async function renderBattlePass(opts: BrRenderOptions): Promise<PanelPayload> {
  const { guild, t, notice } = opts;
  const pass = await battleRoyaleService.getActiveBattlePass(guild.id);
  if (!pass) return renderMain({ ...opts, notice: notice ?? { type: 'error', text: t('battleroyale.errors.no_season') } });
  const tiers = parseTiers(pass.tiers);
  const none = t('core.none');
  const embed = embedService
    .brand(t('battleroyale.battlepass.title', { season: pass.season, name: pass.name }))
    .setDescription(withNotice(notice, t('panels_modules.battleroyale.bp_hint')))
    .addFields({
      name: t('panels_modules.battleroyale.field_tiers', { count: tiers.length }),
      value: fieldLines(
        tiers.map((tier) => `**${tier.tier}** · ${tier.xpRequired} XP · 🆓 ${tier.freeReward ?? none} · ⭐ ${tier.premiumReward ?? none}`),
        none,
      ),
    });
  return {
    embeds: [embed],
    components: [
      row(
        btn(bcid('tiers'), t('panels_modules.battleroyale.btn_edit_tiers'), ButtonStyle.Primary, '✏️'),
        btn(bcid('gen'), t('panels_modules.battleroyale.btn_generate'), ButtonStyle.Secondary, '📦'),
        btn(bcid('main'), t('core.back'), ButtonStyle.Secondary, '↩️'),
      ),
    ],
  };
}

// ───── Modals ─────

export function buildNewSeasonModal(t: Translator, now = new Date()): ModalBuilder {
  return modal(
    bcid('season-new'),
    t('panels_modules.battleroyale.modal_season_title'),
    labelled(t('panels_modules.battleroyale.modal_season_name'), textInput('name', TextInputStyle.Short, { required: true, max: 100 })),
    labelled(t('panels_modules.battleroyale.modal_season_start'), textInput('start', TextInputStyle.Short, { max: 10, value: isoDate(now), placeholder: 'AAAA-MM-JJ' }), t('panels_modules.battleroyale.modal_date_help')),
    labelled(t('panels_modules.battleroyale.modal_season_end'), textInput('end', TextInputStyle.Short, { max: 10, value: isoDate(new Date(now.getTime() + 90 * 86400_000)), placeholder: 'AAAA-MM-JJ' })),
    labelled(t('panels_modules.battleroyale.modal_tier_count'), textInput('count', TextInputStyle.Short, { max: 3, value: '30' })),
    labelled(t('panels_modules.battleroyale.modal_xp_per_tier'), textInput('xp', TextInputStyle.Short, { max: 9, value: '1000' })),
  );
}

export function buildTiersModal(pass: BattlePass, t: Translator): ModalBuilder {
  const serialized = serializeTiers(parseTiers(pass.tiers));
  const fits = serialized.length <= TIERS_INPUT_MAX;
  return modal(
    bcid('tiers'),
    t('panels_modules.battleroyale.modal_tiers_title', { season: pass.season }),
    labelled(
      t('panels_modules.battleroyale.modal_tiers'),
      textInput('tiers', TextInputStyle.Paragraph, { required: true, max: TIERS_INPUT_MAX, value: fits ? serialized : undefined, placeholder: '1 | 1000 | 500 crédits | Skin exclusif' }),
      t(fits ? 'panels_modules.battleroyale.modal_tiers_help' : 'panels_modules.battleroyale.modal_tiers_too_long'),
    ),
  );
}

export function buildGenerateModal(t: Translator): ModalBuilder {
  return modal(
    bcid('gen'),
    t('panels_modules.battleroyale.modal_generate_title'),
    labelled(t('panels_modules.battleroyale.modal_tier_count'), textInput('count', TextInputStyle.Short, { required: true, max: 3, value: '30' })),
    labelled(t('panels_modules.battleroyale.modal_xp_per_tier'), textInput('xp', TextInputStyle.Short, { required: true, max: 9, value: '1000' }), t('panels_modules.battleroyale.modal_generate_help')),
  );
}

const memberSelect = () => new UserSelectMenuBuilder().setCustomId('member').setMinValues(1).setMaxValues(1).setRequired(true);

export function buildStatModal(t: Translator): ModalBuilder {
  return modal(
    bcid('stat'),
    t('panels_modules.battleroyale.modal_stat_title'),
    labelled(t('panels_modules.battleroyale.modal_member'), memberSelect()),
    labelled(
      t('panels_modules.battleroyale.modal_stat_field'),
      new StringSelectMenuBuilder()
        .setCustomId('field')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true)
        .addOptions(STAT_CHOICES.map((f) => option(t(`panels_modules.battleroyale.stat_${f}`), f, { description: f }))),
    ),
    labelled(t('panels_modules.battleroyale.modal_stat_value'), textInput('value', TextInputStyle.Short, { required: true, max: 12 }), t('panels_modules.battleroyale.modal_stat_value_help')),
    labelled(t('panels_modules.battleroyale.modal_stat_season'), textInput('season', TextInputStyle.Short, { max: 4 }), t('panels_modules.battleroyale.modal_stat_season_help')),
  );
}

export function buildXpModal(t: Translator): ModalBuilder {
  return modal(
    bcid('xp'),
    t('panels_modules.battleroyale.modal_xp_title'),
    labelled(t('panels_modules.battleroyale.modal_member'), memberSelect()),
    labelled(t('panels_modules.battleroyale.modal_xp_amount'), textInput('amount', TextInputStyle.Short, { required: true, max: 10, placeholder: '500' }), t('panels_modules.battleroyale.modal_xp_help')),
  );
}

export function buildLinkModal(t: Translator): ModalBuilder {
  return modal(
    bcid('link'),
    t('panels_modules.battleroyale.modal_link_title'),
    labelled(t('panels_modules.battleroyale.modal_member'), memberSelect()),
    labelled(t('panels_modules.fivem.modal_license'), textInput('license', TextInputStyle.Short, { required: true, max: 128, placeholder: 'license:0123abcd…' }), t('panels_modules.fivem.modal_license_help')),
  );
}
