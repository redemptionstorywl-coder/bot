import { defineSelectMenu } from '../structures';
import { ANTI_NUKE_PUNISHMENTS, moderationService, type AntiNukePunishment } from '../services/ModerationService';
import { antiRaidService } from '../services/AntiRaidService';
import { antiNukeService } from '../services/AntiNukeService';
import { honeypotService } from '../services/HoneypotService';
import { childLogger } from '../utils/logger';
import { canManageRole } from '../utils/permissions';
import { errorDetails, ko, ok, show, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { PROTECTIONS, loadModerationPanel, protectionsPatch, type ModTab } from '../panels/_moderation';

/**
 * Menus du panneau `/config moderation` (namespace `cfg-mod`, admin) :
 *  - Sanctions : `cfg-mod:muterole` (RoleSelect 0–1) · `cfg-mod:thdel` (StringSelect : seuil à supprimer)
 *  - Anti-raid : `cfg-mod:arprot` (protections actives) · `cfg-mod:arroles` (rôles exemptés) · `cfg-mod:archans` (salons exemptés)
 *  - Anti-nuke : `cfg-mod:nkpun` (punition) · `cfg-mod:nkwl` (UserSelect : utilisateurs de confiance)
 *  - Piège     : `cfg-mod:hpchan` (ChannelSelect : utiliser un salon existant comme salon piège)
 */
const log = childLogger('CfgMod');

export default defineSelectMenu({
  id: 'cfg-mod',
  permissions: { internal: 'admin' },
  cooldown: 1,
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
        case 'muterole': {
          if (!interaction.isRoleSelectMenu()) return;
          const roleId = interaction.values[0] ?? null;
          if (roleId && !canManageRole(guild.members.me, roleId)) {
            notice = ko(t('core.role_hierarchy'));
            break;
          }
          await moderationService.updateConfig(guild.id, { muteRoleId: roleId });
          notice = ok(roleId ? t('moderation.config.mute_role_set', { role: `<@&${roleId}>` }) : t('moderation.config.mute_role_removed'));
          break;
        }
        case 'thdel': {
          if (!interaction.isStringSelectMenu()) return;
          const count = Number(interaction.values[0]);
          if (!cfg.warnThresholds.some((th) => th.count === count)) {
            notice = ko(t('moderation.config.threshold_not_found', { count: interaction.values[0] ?? '' }));
            break;
          }
          await moderationService.updateConfig(guild.id, { warnThresholds: cfg.warnThresholds.filter((th) => th.count !== count) });
          notice = ok(t('moderation.config.threshold_removed', { count }));
          break;
        }
        case 'arprot': {
          tab = 'antiraid';
          if (!interaction.isStringSelectMenu()) return;
          const values = interaction.values.filter((v) => (PROTECTIONS as readonly string[]).includes(v));
          await antiRaidService.updateConfig(guild.id, protectionsPatch(values, cfg.antiRaid));
          antiRaidService.invalidate(guild.id);
          notice = ok(t('panels_core.moderation.protections_set', { count: values.length }));
          break;
        }
        case 'arroles': {
          tab = 'antiraid';
          if (!interaction.isRoleSelectMenu()) return;
          const exemptRoleIds = [...interaction.values];
          await antiRaidService.updateConfig(guild.id, { exemptRoleIds });
          antiRaidService.invalidate(guild.id);
          notice = ok(t('panels_core.moderation.exempt_roles_set', { count: exemptRoleIds.length }));
          break;
        }
        case 'archans': {
          tab = 'antiraid';
          if (!interaction.isChannelSelectMenu()) return;
          const exemptChannelIds = [...interaction.values];
          await antiRaidService.updateConfig(guild.id, { exemptChannelIds });
          antiRaidService.invalidate(guild.id);
          notice = ok(t('panels_core.moderation.exempt_channels_set', { count: exemptChannelIds.length }));
          break;
        }
        case 'nkpun': {
          tab = 'antinuke';
          if (!interaction.isStringSelectMenu()) return;
          const punishment = interaction.values[0] as AntiNukePunishment;
          if (!ANTI_NUKE_PUNISHMENTS.includes(punishment)) return unknownAction(interaction, t, punishment ?? '');
          await antiNukeService.updateConfig(guild.id, { ...cfg.antiRaid.antiNuke, punishment });
          notice = ok(t('panels_core.moderation.punishment_set', { punishment: t(`moderation.antinuke.punishments.${punishment}`) }));
          break;
        }
        case 'nkwl': {
          tab = 'antinuke';
          if (!interaction.isUserSelectMenu()) return;
          const whitelistUserIds = [...interaction.values];
          await antiNukeService.updateConfig(guild.id, { ...cfg.antiRaid.antiNuke, whitelistUserIds });
          notice = ok(t('panels_core.moderation.whitelist_set', { count: whitelistUserIds.length }));
          break;
        }
        case 'hpchan': {
          tab = 'honeypot';
          if (!interaction.isChannelSelectMenu()) return;
          const channelId = interaction.values[0];
          if (!channelId) return;
          await interaction.deferUpdate();
          try {
            const result = await honeypotService.setup(guild, { channelId });
            notice = ok(t('panels_core.moderation.hp_channel_set', { channel: `<#${result.channelId}>` }));
          } catch (err) {
            log.warn({ err, guild: guild.id }, 'Salon piège : configuration impossible');
            notice = ko(t('panels_core.moderation.hp_failed', { details: errorDetails(err) }));
          }
          break;
        }
        default:
          return unknownAction(interaction, t, action);
      }
    } catch (err) {
      notice = ko(t('core.invalid_input', { details: errorDetails(err) }));
    }
    await show(interaction, await loadModerationPanel({ guild, t, lang, tab, notice }));
  },
});
