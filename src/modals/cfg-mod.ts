import { defineModal } from '../structures';
import { moderationService } from '../services/ModerationService';
import { antiRaidService } from '../services/AntiRaidService';
import { antiNukeService } from '../services/AntiNukeService';
import { honeypotService } from '../services/HoneypotService';
import { errorDetails, ko, modalText, modalValues, ok, respond, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { HONEYPOT_WINDOW, MAX_THRESHOLDS, addThreshold, loadModerationPanel, parseAntiRaidSettings, parseDomains, parseNukeThresholds, parseWarnThreshold, parseWindowMinutes, type ModTab } from '../panels/_moderation';

/**
 * Modals du panneau `/config moderation` (namespace `cfg-mod`, admin) :
 *  - `cfg-mod:thadd` : `count`, `action` (menu), `duration` → seuil d'avertissements
 *  - `cfg-mod:arset` : `spam`, `mentions`, `age`, `joins`, `timeout` → réglages anti-raid (vide = inchangé)
 *  - `cfg-mod:ardom` : `domains` → liste blanche de domaines (anti-lien)
 *  - `cfg-mod:nkth`  : `thresholds` → lignes « action | max | secondes » (anti-nuke)
 *  - `cfg-mod:hpwin` : `minutes` → fenêtre de suppression du salon piège (5–1440)
 */
export default defineModal({
  id: 'cfg-mod',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    const { t, lang } = ctx;
    const guild = interaction.guild;
    if (!guild || !ctx.config) return;
    const [action = ''] = args;
    const cfg = await moderationService.getConfig(guild.id);
    let tab: ModTab = 'sanctions';
    let notice: PanelNotice;

    try {
      switch (action) {
        case 'thadd': {
          const parsed = parseWarnThreshold({ count: modalText(interaction, 'count'), action: modalValues(interaction, 'action')[0], duration: modalText(interaction, 'duration') });
          if (!parsed.ok) {
            notice = ko(t('panels_core.moderation.invalid_threshold', { field: t(`panels_core.moderation.th_fields.${parsed.field ?? 'count'}`), details: parsed.error }));
            break;
          }
          const next = addThreshold(cfg.warnThresholds, parsed.value);
          if (!next.ok) {
            notice = ko(t('panels_core.moderation.th_full', { max: MAX_THRESHOLDS }));
            break;
          }
          await moderationService.updateConfig(guild.id, { warnThresholds: next.value });
          notice = ok(t('moderation.config.threshold_added', { count: parsed.value.count, action: t(`moderation.actions.${parsed.value.action}`) }));
          break;
        }
        case 'arset': {
          tab = 'antiraid';
          const parsed = parseAntiRaidSettings(
            { spam: modalText(interaction, 'spam'), mentions: modalText(interaction, 'mentions'), age: modalText(interaction, 'age'), joins: modalText(interaction, 'joins'), timeout: modalText(interaction, 'timeout') },
            cfg.antiRaid,
          );
          if (!parsed.ok) {
            notice = ko(t('panels_core.moderation.invalid_setting', { field: t(`panels_core.moderation.setting_fields.${parsed.field ?? 'spam'}`), details: parsed.error }));
            break;
          }
          await antiRaidService.updateConfig(guild.id, parsed.value);
          antiRaidService.invalidate(guild.id);
          notice = ok(t('panels_core.moderation.settings_set'));
          break;
        }
        case 'ardom': {
          tab = 'antiraid';
          const parsed = parseDomains(modalText(interaction, 'domains'));
          if (!parsed.ok) {
            notice = ko(t('panels_core.moderation.invalid_domain', { details: parsed.error }));
            break;
          }
          await antiRaidService.updateConfig(guild.id, { antiLink: { ...cfg.antiRaid.antiLink, whitelistDomains: parsed.value } });
          antiRaidService.invalidate(guild.id);
          notice = ok(t('panels_core.moderation.domains_set', { count: parsed.value.length }));
          break;
        }
        case 'nkth': {
          tab = 'antinuke';
          const nuke = cfg.antiRaid.antiNuke;
          const parsed = parseNukeThresholds(modalText(interaction, 'thresholds'), nuke.thresholds);
          if (!parsed.ok) {
            notice = ko(t('panels_core.moderation.invalid_nuke_threshold', { details: parsed.error }));
            break;
          }
          await antiNukeService.updateConfig(guild.id, { ...nuke, thresholds: parsed.value });
          notice = ok(t('panels_core.moderation.nuke_thresholds_set'));
          break;
        }
        case 'hpwin': {
          tab = 'honeypot';
          const parsed = parseWindowMinutes(modalText(interaction, 'minutes'));
          if (!parsed.ok) {
            notice = ko(t('panels_core.moderation.hp_invalid_window', { details: parsed.error, min: HONEYPOT_WINDOW.min, max: HONEYPOT_WINDOW.max }));
            break;
          }
          if (!(await honeypotService.getConfig(guild.id))) {
            notice = ko(t('panels_core.moderation.hp_not_configured'));
            break;
          }
          if (interaction.isFromMessage()) await interaction.deferUpdate();
          await honeypotService.setup(guild, { windowMinutes: parsed.value });
          notice = ok(t('panels_core.moderation.hp_window_set', { minutes: parsed.value }));
          break;
        }
        default:
          return unknownAction(interaction, t, action);
      }
    } catch (err) {
      notice = ko(t('core.invalid_input', { details: errorDetails(err) }));
    }
    await respond(interaction, await loadModerationPanel({ guild, t, lang, tab, notice }));
  },
});
