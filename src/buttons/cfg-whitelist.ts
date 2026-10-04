import { defineButton } from '../structures';
import { whitelistService } from '../services/WhitelistService';
import { ok, show, toggleModule, unknownAction, type PanelNotice } from '../panels/_modulesKit';
import { buildQuestionsModal, renderWhitelist } from '../panels/_whitelist';

/** Boutons du panneau `/config module:whitelist` (namespace `cfg-whitelist`, admin) : `main`, `module`, `open`, `dm`, `questions` (modal). */
export default defineButton({
  id: 'cfg-whitelist',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t, lang } = ctx;
    let config = ctx.config;
    const guild = interaction.guild;
    const [action = ''] = args;
    let notice: PanelNotice | undefined;

    switch (action) {
      case 'main':
        break;
      case 'module': {
        const r = await toggleModule(config, 'whitelist', t);
        config = r.config;
        notice = r.notice;
        break;
      }
      case 'open': {
        const s = await whitelistService.getConfig(guild.id);
        const updated = await whitelistService.updateConfig(guild.id, { enabled: !s.enabled });
        notice = ok(updated.enabled ? t('panels_modules.whitelist.opened') : t('panels_modules.whitelist.closed_notice'));
        break;
      }
      case 'dm': {
        const s = await whitelistService.getConfig(guild.id);
        const updated = await whitelistService.updateConfig(guild.id, { dmOnDecision: !s.dmOnDecision });
        notice = ok(t(updated.dmOnDecision ? 'panels_modules.whitelist.dm_on' : 'panels_modules.whitelist.dm_off'));
        break;
      }
      case 'questions':
        return interaction.showModal(await buildQuestionsModal(guild.id, t));
      default:
        return unknownAction(interaction, t, action);
    }
    return show(interaction, await renderWhitelist({ guild, config, t, lang, notice }));
  },
});
