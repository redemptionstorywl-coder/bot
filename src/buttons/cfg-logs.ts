import { PermissionFlagsBits } from 'discord.js';
import { defineButton } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { childLogger } from '../utils/logger';
import { errorDetails, ko, ok, show, toggleModule, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { LOG_CATEGORIES, categoryLabel, createPrivateLogChannel, isLogCategory, renderLogs, setAllLogChannels, type LogsView } from '../panels/_logs';
import type { LogCategory } from '@prisma/client';

const log = childLogger('CfgLogs');

/**
 * Boutons du panneau `/config logs` (namespace `cfg-logs`, admin) :
 *  - `cfg-logs:view:<main|all>` → change de vue
 *  - `cfg-logs:off:<CAT>`       → retire le salon de la catégorie
 *  - `cfg-logs:alloff`          → retire tous les salons
 *  - `cfg-logs:create`          → crée `📜・logs` (privé admins / staff) et y envoie toutes les catégories
 *  - `cfg-logs:module`          → active / désactive le module logs
 */
export default defineButton({
  id: 'cfg-logs',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    const guild = interaction.guild;
    if (!guild || !ctx.config) return;
    const [action = '', arg] = args;
    let view: LogsView = 'main';
    let picked: LogCategory | undefined;
    let notice: PanelNotice | undefined;

    switch (action) {
      case 'view':
        view = arg === 'all' ? 'all' : 'main';
        break;
      case 'off': {
        if (!isLogCategory(arg)) return unknownAction(interaction, t, arg ?? '');
        picked = arg;
        await guildConfigService.setLogChannel(guild.id, arg, null);
        notice = ok(t('panels_core.logs.disabled', { category: categoryLabel(arg, t) }));
        break;
      }
      case 'alloff':
        await interaction.deferUpdate();
        await setAllLogChannels(guild.id, null);
        notice = ok(t('panels_core.logs.all_off'));
        break;
      case 'create': {
        const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
        if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          notice = ko(t('panels_core.logs.no_manage_channels'));
          break;
        }
        await interaction.deferUpdate();
        try {
          const channel = await createPrivateLogChannel(guild, ctx.config, t);
          notice = ok(t('panels_core.logs.created', { channel: `<#${channel.id}>`, count: LOG_CATEGORIES.length }));
        } catch (err) {
          log.warn({ err, guild: guild.id }, 'Création du salon de logs impossible');
          notice = ko(t('panels_core.logs.create_failed', { details: errorDetails(err) }));
        }
        break;
      }
      case 'module':
        notice = await toggleModule(guild.id, 'logs', ctx.config.modules.logs, t);
        break;
      default:
        return unknownAction(interaction, t, action);
    }

    const config = (await guildConfigService.get(guild.id)) ?? ctx.config;
    await show(interaction, renderLogs({ guild, config, t, view, picked, notice }));
  },
});
