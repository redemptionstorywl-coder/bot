import { defineButton } from '../structures';
import { buildChannelName, detectLanguageRoles, memberDisplayName, resolveRule, tempVoiceService } from '../services/TempVoiceService';
import { attempt, ko, ok, show, toggleModule, unknownAction, warn, type PanelNotice } from '../panels/_modulesKit';
import { buildLimitModal, editModal, fallbackModal, moveRule, renderVocal, type VocalView } from '../panels/_vocal';

/**
 * Boutons du panneau `/config module:vocal` (namespace `cfg-vocal`, admin) :
 * `view:<main|rules>`, `limit` (modal), `test`, `detect`, `owner`, `transfer`, `module`,
 * `up:<i>`, `down:<i>`, `edit:<i>` (modal), `del:<i>`, `fallback` (modal).
 */
export default defineButton({
  id: 'cfg-vocal',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t } = ctx;
    let config = ctx.config;
    const guild = interaction.guild;
    const [action = '', arg = ''] = args;
    const index = Number.parseInt(arg, 10);
    let view: VocalView = 'main';
    let selected: number | undefined;
    let notice: PanelNotice | undefined;

    switch (action) {
      case 'view':
        view = arg === 'rules' ? 'rules' : 'main';
        break;
      case 'limit':
        return interaction.showModal(buildLimitModal(await tempVoiceService.getConfig(guild.id), t));
      case 'fallback':
        return interaction.showModal(fallbackModal(await tempVoiceService.getConfig(guild.id), t));
      case 'edit': {
        const settings = await tempVoiceService.getConfig(guild.id);
        if (!settings.rules[index]) {
          view = 'rules';
          notice = ko(t('vocal.panel.rule_not_found'));
          break;
        }
        return interaction.showModal(editModal(index, settings, t));
      }
      case 'test': {
        const settings = await tempVoiceService.getConfig(guild.id);
        const r = resolveRule(interaction.member.roles.cache.keys(), settings.rules, settings.fallback);
        const name = buildChannelName(r.rule, memberDisplayName(interaction.member));
        notice = ok(r.roleId ? t('vocal.panel.test_result', { name, n: r.index + 1, role: `<@&${r.roleId}>` }) : t('vocal.panel.test_fallback', { name }));
        break;
      }
      case 'detect': {
        view = 'rules';
        const settings = await tempVoiceService.getConfig(guild.id);
        const found = detectLanguageRoles([...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed).map((r) => ({ id: r.id, name: r.name })), settings.rules);
        if (!found.length) {
          notice = warn(t('vocal.panel.detected_none'));
          break;
        }
        notice = await attempt(t, async () => {
          await tempVoiceService.updateConfig(guild.id, { rules: [...settings.rules, ...found] });
          return t('vocal.panel.detected', { count: found.length, roles: found.map((f) => `<@&${f.roleId}>`).join(' ') });
        });
        break;
      }
      case 'owner': {
        const settings = await tempVoiceService.getConfig(guild.id);
        const updated = await tempVoiceService.updateConfig(guild.id, { ownerPermissions: !settings.ownerPermissions });
        notice = ok(t(updated.ownerPermissions ? 'vocal.panel.owner_on' : 'vocal.panel.owner_off'));
        break;
      }
      case 'transfer': {
        const settings = await tempVoiceService.getConfig(guild.id);
        const updated = await tempVoiceService.updateConfig(guild.id, { transferOwnership: !settings.transferOwnership });
        notice = ok(t(updated.transferOwnership ? 'vocal.panel.transfer_on' : 'vocal.panel.transfer_off'));
        break;
      }
      case 'module': {
        const r = await toggleModule(config, 'vocal', t);
        config = r.config;
        notice = r.notice;
        break;
      }
      case 'up':
      case 'down': {
        view = 'rules';
        const settings = await tempVoiceService.getConfig(guild.id);
        if (!settings.rules[index]) return unknownAction(interaction, t, arg);
        const delta = action === 'up' ? -1 : 1;
        await tempVoiceService.updateConfig(guild.id, { rules: moveRule(settings.rules, index, delta) });
        selected = Math.max(0, Math.min(settings.rules.length - 1, index + delta));
        notice = ok(t('vocal.panel.rule_moved', { n: selected + 1 }));
        break;
      }
      case 'del': {
        view = 'rules';
        const settings = await tempVoiceService.getConfig(guild.id);
        const rule = settings.rules[index];
        if (!rule) return unknownAction(interaction, t, arg);
        await tempVoiceService.updateConfig(guild.id, { rules: settings.rules.filter((_, i) => i !== index) });
        notice = ok(t('vocal.panel.rule_removed', { role: `<@&${rule.roleId}>` }));
        break;
      }
      default:
        return unknownAction(interaction, t, action);
    }
    return show(interaction, await renderVocal({ guild, config, t, member: interaction.member, view, selected, notice }));
  },
});
