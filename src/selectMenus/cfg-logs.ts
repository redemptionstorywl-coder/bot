import { defineSelectMenu } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { ok, show, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { LOG_CATEGORIES, categoryLabel, isLogCategory, renderLogs, setAllLogChannels, type LogsView } from '../panels/_logs';
import type { LogCategory } from '@prisma/client';

/**
 * Menus du panneau `/config logs` (namespace `cfg-logs`, admin) :
 *  - `cfg-logs:pick`       (StringSelect)  → choisit la catégorie à configurer
 *  - `cfg-logs:set:<CAT>`  (ChannelSelect) → salon de la catégorie
 *  - `cfg-logs:allset`     (ChannelSelect) → un seul salon pour toutes les catégories
 */
export default defineSelectMenu({
  id: 'cfg-logs',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    const guild = interaction.guild;
    if (!guild || !ctx.config) return;
    const [action = '', arg] = args;
    const view: LogsView = 'main';
    let picked: LogCategory | undefined;
    let notice: PanelNotice | undefined;

    switch (action) {
      case 'pick': {
        if (!interaction.isStringSelectMenu()) return;
        const value = interaction.values[0];
        if (!isLogCategory(value)) return unknownAction(interaction, t, value ?? '');
        picked = value;
        break;
      }
      case 'set': {
        if (!interaction.isChannelSelectMenu() || !isLogCategory(arg)) return unknownAction(interaction, t, arg ?? action);
        const channelId = interaction.values[0];
        if (!channelId) return;
        picked = arg;
        await guildConfigService.setLogChannel(guild.id, arg, channelId);
        notice = ok(t('panels_core.logs.set', { category: categoryLabel(arg, t), channel: `<#${channelId}>` }));
        break;
      }
      case 'allset': {
        if (!interaction.isChannelSelectMenu()) return;
        const channelId = interaction.values[0];
        if (!channelId) return;
        await interaction.deferUpdate();
        await setAllLogChannels(guild.id, channelId);
        notice = ok(t('panels_core.logs.all_set', { count: LOG_CATEGORIES.length, channel: `<#${channelId}>` }));
        break;
      }
      default:
        return unknownAction(interaction, t, action);
    }

    const config = (await guildConfigService.get(guild.id)) ?? ctx.config;
    await show(interaction, renderLogs({ guild, config, t, view, picked, notice }));
  },
});
