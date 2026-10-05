import type { AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { battleRoyaleService } from '../services/BattleRoyaleService';
import { leaderboardService, type DisplaySettingsPatch } from '../services/LeaderboardService';
import { attempt, show, unknownAction } from '../panels/_modulesKit';
import { renderDisplay, renderMain } from '../panels/_battleroyale';

/**
 * Menus du panneau `/config module:battleroyale` (namespace `cfg-battleroyale`, admin) :
 *  - `season` (StringSelect)          → saison active
 *  - `lb-channel` (ChannelSelect 0–1) → salon du classement en direct (vide = désactivé)
 *  - `lb-size` (StringSelect)         → 10 ou 15 joueurs par classement
 *  - `stat-channel` (ChannelSelect)   → salon dédié à /stat (vide = partout)
 */
export default defineSelectMenu({
  id: 'cfg-battleroyale',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = ''] = args;
    await handle(interaction, action, ctx);
  },
});

async function handle(interaction: AnySelectMenuInteraction<'cached'>, action: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const config = ctx.config!;
  const guild = interaction.guild;
  switch (action) {
    case 'season': {
      if (!interaction.isStringSelectMenu()) return unknownAction(interaction, t, action);
      const season = Number(interaction.values[0]);
      const notice = await attempt(t, async () => {
        const pass = await battleRoyaleService.setSeason(guild.id, season, interaction.user.id);
        return t('battleroyale.admin.season_set', { season: pass.season, name: pass.name });
      });
      return show(interaction, await renderMain({ guild, config, t, notice }));
    }
    case 'lb-channel':
    case 'lb-size':
    case 'stat-channel': {
      const value = interaction.values[0] ?? null;
      const patch: DisplaySettingsPatch = action === 'lb-channel' ? { leaderboardChannelId: value } : action === 'stat-channel' ? { statChannelId: value } : { leaderboardSize: Number(value) };
      await interaction.deferUpdate();
      const notice = await attempt(t, async () => {
        await leaderboardService.updateSettings(guild.id, patch, interaction.user.id);
        return t('panels_modules.battleroyale.display_updated');
      });
      return show(interaction, await renderDisplay({ guild, config, t, notice }));
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
