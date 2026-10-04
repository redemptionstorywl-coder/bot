import { PermissionFlagsBits } from 'discord.js';
import { defineButton } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { DEFAULT_WARN_THRESHOLDS, moderationService } from '../services/ModerationService';
import { antiNukeService } from '../services/AntiNukeService';
import { honeypotService } from '../services/HoneypotService';
import { childLogger } from '../utils/logger';
import { errorDetails, ko, ok, show, stateLabel, toggleModule, unknownAction, type PanelNotice } from '../panels/_coreKit';
import {
  NUKE_TOGGLES,
  TAB_MODULE,
  buildAntiRaidSettingsModal,
  buildDomainsModal,
  buildHoneypotWindowModal,
  buildNukeThresholdsModal,
  buildThresholdModal,
  isModTab,
  isNukeToggle,
  loadModerationPanel,
  renderHoneypotRemoveConfirm,
  renderLockdownConfirm,
  type ModTab,
} from '../panels/_moderation';

const log = childLogger('CfgMod');

/**
 * Boutons du panneau `/config moderation` (namespace `cfg-mod`, admin) :
 *  - `cfg-mod:tab:<tab>` · `cfg-mod:module:<tab>` (module lié à l'onglet)
 *  - Sanctions : `cfg-mod:thadd` (modal) · `cfg-mod:threset` · `cfg-mod:dm`
 *  - Anti-raid : `cfg-mod:arset` (modal réglages) · `cfg-mod:ardom` (modal domaines)
 *  - Anti-nuke : `cfg-mod:nk:<enabled|botadd|lockdown|restore|team|dm>` · `cfg-mod:nkth` (modal seuils)
 *  - Lockdown  : `cfg-mod:lock:<on|off>` (confirmation) → `cfg-mod:lockok:<on|off>`
 *  - Piège     : `cfg-mod:hpcreate` (crée / republie) · `cfg-mod:hptoggle` · `cfg-mod:hpwin` (modal) · `cfg-mod:hpremove` (confirmation) → `cfg-mod:hpremoveok`
 */
export default defineButton({
  id: 'cfg-mod',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const { t, lang } = ctx;
    const guild = interaction.guild;
    if (!guild || !ctx.config) return;
    const [action = '', arg] = args;
    let tab: ModTab = 'sanctions';
    let notice: PanelNotice | undefined;
    const cfg = await moderationService.getConfig(guild.id);

    try {
      switch (action) {
        case 'tab':
          tab = isModTab(arg) ? arg : 'sanctions';
          break;
        case 'module': {
          tab = isModTab(arg) ? arg : 'sanctions';
          const module = TAB_MODULE[tab];
          if (!module) break;
          const config = (await guildConfigService.get(guild.id)) ?? ctx.config;
          notice = await toggleModule(guild.id, module, config.modules[module], t);
          break;
        }
        // ── Sanctions ──
        case 'thadd':
          return interaction.showModal(buildThresholdModal(t));
        case 'threset':
          await moderationService.updateConfig(guild.id, { warnThresholds: DEFAULT_WARN_THRESHOLDS });
          notice = ok(t('panels_core.moderation.th_reset'));
          break;
        case 'dm': {
          const dmOnSanction = !cfg.dmOnSanction;
          await moderationService.updateConfig(guild.id, { dmOnSanction });
          notice = ok(t('moderation.config.dm_set', { state: stateLabel(dmOnSanction, t) }));
          break;
        }
        // ── Anti-raid ──
        case 'arset':
          return interaction.showModal(buildAntiRaidSettingsModal(cfg.antiRaid, t, lang));
        case 'ardom':
          return interaction.showModal(buildDomainsModal(cfg.antiRaid, t));
        // ── Anti-nuke ──
        case 'nk': {
          tab = 'antinuke';
          if (!isNukeToggle(arg)) return unknownAction(interaction, t, arg ?? '');
          const nuke = cfg.antiRaid.antiNuke;
          const field = NUKE_TOGGLES[arg];
          const value = !nuke[field];
          await antiNukeService.updateConfig(guild.id, { ...nuke, [field]: value });
          notice = ok(t('panels_core.moderation.nuke_option_set', { option: t(`panels_core.moderation.nuke_options.${arg}`), state: stateLabel(value, t) }));
          break;
        }
        case 'nkth':
          return interaction.showModal(buildNukeThresholdsModal(cfg.antiRaid.antiNuke, t));
        // ── Lockdown ──
        case 'lock':
          return show(interaction, renderLockdownConfirm({ t, enable: arg === 'on' }));
        case 'lockok': {
          tab = 'lockdown';
          const enable = arg === 'on';
          await interaction.deferUpdate();
          try {
            const result = await moderationService.setLockdown(guild.id, enable, interaction.user.id, null);
            notice = !result.changed
              ? ko(t(enable ? 'moderation.lockdown.already_on' : 'moderation.lockdown.already_off'))
              : ok(t(enable ? 'moderation.lockdown.enabled' : 'moderation.lockdown.disabled', { channels: result.channels, failed: result.failed }));
          } catch (err) {
            log.warn({ err, guild: guild.id }, 'Lockdown depuis le panneau impossible');
            notice = ko(t('panels_core.moderation.lock_failed', { details: errorDetails(err) }));
          }
          break;
        }
        // ── Salon piège ──
        case 'hpcreate': {
          tab = 'honeypot';
          const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            notice = ko(t('panels_core.logs.no_manage_channels'));
            break;
          }
          await interaction.deferUpdate();
          try {
            const result = await honeypotService.setup(guild);
            notice = ok(t(result.created ? 'panels_core.moderation.hp_created' : 'panels_core.moderation.hp_republished', { channel: `<#${result.channelId}>` }));
          } catch (err) {
            log.warn({ err, guild: guild.id }, 'Salon piège : configuration impossible');
            notice = ko(t('panels_core.moderation.hp_failed', { details: errorDetails(err) }));
          }
          break;
        }
        case 'hptoggle': {
          tab = 'honeypot';
          const hp = await honeypotService.getConfig(guild.id);
          if (!hp) {
            notice = ko(t('panels_core.moderation.hp_not_configured'));
            break;
          }
          await honeypotService.setEnabled(guild.id, !hp.enabled);
          notice = ok(t('panels_core.moderation.hp_enabled_set', { state: stateLabel(!hp.enabled, t) }));
          break;
        }
        case 'hpwin': {
          const hp = await honeypotService.getConfig(guild.id);
          return interaction.showModal(buildHoneypotWindowModal(hp?.deleteWindowMinutes ?? null, t));
        }
        case 'hpremove': {
          const hp = await honeypotService.getConfig(guild.id);
          return show(interaction, renderHoneypotRemoveConfirm({ t, channelId: hp?.channelId ?? null }));
        }
        case 'hpremoveok':
          tab = 'honeypot';
          await honeypotService.remove(guild, false);
          notice = ok(t('panels_core.moderation.hp_removed'));
          break;
        default:
          return unknownAction(interaction, t, action);
      }
    } catch (err) {
      notice = ko(t('core.invalid_input', { details: errorDetails(err) }));
    }
    if (action === 'threset' || action === 'dm') tab = 'sanctions';
    await show(interaction, await loadModerationPanel({ guild, t, lang, tab, notice }));
  },
});
