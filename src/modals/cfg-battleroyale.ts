import type { ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { battleRoyaleService, parseTiers } from '../services/BattleRoyaleService';
import { fivemSyncService } from '../services/FiveMSyncService';
import { PanelError, attempt, deferModal, modalText, modalValues, parseIntField, respond, unknownAction } from '../panels/_modulesKit';
import { isValidLicense } from '../panels/_fivem';
import { MAX_TIERS, generateTiers, isStatChoice, parseDateInput, parseStatValue, parseTierLines, renderBattlePass, renderMain } from '../panels/_battleroyale';
import { discordTimestamp } from '../utils/time';

/**
 * Modals du panneau `/config module:battleroyale` (namespace `cfg-battleroyale`, admin) :
 *  - `season-new` : nom, début, fin, nombre de paliers, XP par palier
 *  - `tiers`      : paliers `palier | xp | gratuit | premium` (saison active)
 *  - `gen`        : génération des paliers (nombre × XP), récompenses conservées
 *  - `stat`       : membre + stat + valeur (+ saison)
 *  - `xp`         : membre + XP (négatif pour retirer)
 *  - `link`       : membre + licence FiveM
 */
export default defineModal({
  id: 'cfg-battleroyale',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = ''] = args;
    await handle(interaction, action, ctx);
  },
});

async function handle(interaction: ModalSubmitInteraction<'cached'>, action: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const config = ctx.config!;
  const guild = interaction.guild;
  const opts = { guild, config, t };
  const field = (id: string) => modalText(interaction, id);
  const member = () => {
    const id = modalValues(interaction, 'member')[0];
    if (!id) throw new PanelError('core.member_not_found');
    if (interaction.fields.resolved?.users?.get(id)?.bot) throw new PanelError('panels_modules.battleroyale.no_bots');
    return id;
  };

  switch (action) {
    case 'season-new': {
      await deferModal(interaction);
      const notice = await attempt(t, async () => {
        const name = field('name');
        if (!name) throw new PanelError('panels_modules.common.required_field', { field: t('panels_modules.battleroyale.modal_season_name') });
        const startsAt = parseDateInput(field('start'), new Date(), t('panels_modules.battleroyale.modal_season_start'));
        const endsAt = parseDateInput(field('end'), new Date(startsAt.getTime() + 90 * 86400_000), t('panels_modules.battleroyale.modal_season_end'));
        if (endsAt.getTime() <= startsAt.getTime()) throw new PanelError('panels_modules.battleroyale.end_before_start');
        const count = parseIntField(field('count') ?? '30', t('panels_modules.battleroyale.modal_tier_count'), { min: 1, max: MAX_TIERS })!;
        const xp = parseIntField(field('xp') ?? '1000', t('panels_modules.battleroyale.modal_xp_per_tier'), { min: 1, max: 10_000_000 })!;
        const pass = await battleRoyaleService.newSeason(guild.id, { name, startsAt, endsAt, tiers: generateTiers(count, xp), actorId: interaction.user.id });
        return t('battleroyale.admin.season_new', { season: pass.season, name: pass.name, ends: discordTimestamp(pass.endsAt, 'D') });
      });
      return respond(interaction, await renderMain({ ...opts, notice }));
    }
    case 'tiers':
    case 'gen': {
      await deferModal(interaction);
      const notice = await attempt(t, async () => {
        const pass = await battleRoyaleService.getActiveBattlePass(guild.id);
        if (!pass) throw new PanelError('battleroyale.errors.no_season');
        const tiers =
          action === 'tiers'
            ? parseTierLines(field('tiers') ?? '')
            : generateTiers(
                parseIntField(field('count'), t('panels_modules.battleroyale.modal_tier_count'), { min: 1, max: MAX_TIERS })!,
                parseIntField(field('xp'), t('panels_modules.battleroyale.modal_xp_per_tier'), { min: 1, max: 10_000_000 })!,
                parseTiers(pass.tiers),
              );
        if (!tiers.length) throw new PanelError('panels_modules.battleroyale.no_tiers');
        await battleRoyaleService.updateTiers(guild.id, pass.season, tiers, interaction.user.id);
        return t('panels_modules.battleroyale.tiers_saved', { count: tiers.length, season: pass.season });
      });
      return respond(interaction, await renderBattlePass({ ...opts, notice }));
    }
    case 'stat': {
      const notice = await attempt(t, async () => {
        const userId = member();
        const statField = modalValues(interaction, 'field')[0];
        if (!isStatChoice(statField)) throw new PanelError('battleroyale.errors.invalid_field');
        const value = parseStatValue(statField, field('value'), t('panels_modules.battleroyale.modal_stat_value'));
        const season = parseIntField(field('season'), t('panels_modules.battleroyale.modal_stat_season'), { min: 1, max: 9999, allowEmpty: true }) ?? undefined;
        await battleRoyaleService.adminSetStat(guild.id, userId, statField, value, season, interaction.user.id);
        return t('battleroyale.admin.stat_set', { user: `<@${userId}>`, field: statField, value: String(value) });
      });
      return respond(interaction, await renderMain({ ...opts, notice }));
    }
    case 'xp': {
      const notice = await attempt(t, async () => {
        const userId = member();
        const amount = parseIntField(field('amount'), t('panels_modules.battleroyale.modal_xp_amount'), { min: -10_000_000, max: 10_000_000 })!;
        const profile = await battleRoyaleService.addXp(guild.id, userId, amount, interaction.user.id);
        return t('battleroyale.admin.xp_added', { user: `<@${userId}>`, amount, xp: profile.xp, level: profile.level });
      });
      return respond(interaction, await renderMain({ ...opts, notice }));
    }
    case 'link': {
      const notice = await attempt(t, async () => {
        const userId = member();
        const license = (field('license') ?? '').trim();
        if (!isValidLicense(license)) throw new PanelError('fivem.link.invalid');
        await fivemSyncService.linkManually(guild.id, userId, license, interaction.user.id);
        return t('fivem.link.done', { user: `<@${userId}>`, license });
      });
      return respond(interaction, await renderMain({ ...opts, notice }));
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
