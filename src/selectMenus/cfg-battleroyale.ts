import { defineSelectMenu } from '../structures';
import { battleRoyaleService } from '../services/BattleRoyaleService';
import { attempt, show, unknownAction } from '../panels/_modulesKit';
import { renderMain } from '../panels/_battleroyale';

/** Menu `cfg-battleroyale:season` (StringSelect) : change la saison active. */
export default defineSelectMenu({
  id: 'cfg-battleroyale',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t } = ctx;
    const [action = ''] = args;
    if (action !== 'season' || !interaction.isStringSelectMenu()) return unknownAction(interaction, t, action);
    const season = Number(interaction.values[0]);
    const notice = await attempt(t, async () => {
      const pass = await battleRoyaleService.setSeason(interaction.guildId, season, interaction.user.id);
      return t('battleroyale.admin.season_set', { season: pass.season, name: pass.name });
    });
    return show(interaction, await renderMain({ guild: interaction.guild, config: ctx.config, t, notice }));
  },
});
