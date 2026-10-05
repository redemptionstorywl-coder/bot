import type { ButtonInteraction } from 'discord.js';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { battleRoyaleService } from '../services/BattleRoyaleService';
import { leaderboardService } from '../services/LeaderboardService';
import { attempt, ko, show, toggleModule, unknownAction } from '../panels/_modulesKit';
import { buildGenerateModal, buildLinkModal, buildNewSeasonModal, buildStatModal, buildTiersModal, buildXpModal, renderBattlePass, renderDisplay, renderMain } from '../panels/_battleroyale';

/**
 * Boutons du panneau `/config module:battleroyale` (namespace `cfg-battleroyale`, admin) :
 * `main`, `module`, `bp`, `display`, `lb-refresh`, modals `season-new` / `stat` / `xp` / `link` / `tiers` / `gen`.
 */
export default defineButton({
  id: 'cfg-battleroyale',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = ''] = args;
    await handle(interaction, action, ctx);
  },
});

async function handle(interaction: ButtonInteraction<'cached'>, action: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  let config = ctx.config!;
  const guild = interaction.guild;

  switch (action) {
    case 'main':
      return show(interaction, await renderMain({ guild, config, t }));
    case 'module': {
      const r = await toggleModule(config, 'battleRoyale', t);
      config = r.config;
      return show(interaction, await renderMain({ guild, config, t, notice: r.notice }));
    }
    case 'bp':
      return show(interaction, await renderBattlePass({ guild, config, t }));
    case 'display':
      return show(interaction, await renderDisplay({ guild, config, t }));
    case 'lb-refresh': {
      await interaction.deferUpdate();
      const notice = await attempt(t, async () => {
        await leaderboardService.refreshNow(guild.id);
        return t('panels_modules.battleroyale.lb_refreshed');
      });
      return show(interaction, await renderDisplay({ guild, config, t, notice }));
    }
    case 'season-new':
      return interaction.showModal(buildNewSeasonModal(t));
    case 'stat':
      return interaction.showModal(buildStatModal(t));
    case 'xp':
      return interaction.showModal(buildXpModal(t));
    case 'link':
      return interaction.showModal(buildLinkModal(t));
    case 'gen':
      return interaction.showModal(buildGenerateModal(t));
    case 'tiers': {
      const pass = await battleRoyaleService.getActiveBattlePass(guild.id);
      if (!pass) return show(interaction, await renderMain({ guild, config, t, notice: ko(t('battleroyale.errors.no_season')) }));
      return interaction.showModal(buildTiersModal(pass, t));
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
