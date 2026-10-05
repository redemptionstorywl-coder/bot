import { defineButton } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { autoTranslateService } from '../services/AutoTranslateService';
import { show, unknownAction } from '../panels/_coreKit';
import { buildFooterModal, buildHexModal, isGeneralView, renderGeneral } from '../panels/_general';

/**
 * Boutons du panneau `/config general` (namespace `cfg-general`, admin) :
 *  - `cfg-general:view:<main|modules|color>` → change de vue
 *  - `cfg-general:hex`                       → modal « code hexadécimal »
 *  - `cfg-general:footer`                    → modal « footer des embeds »
 *  - `cfg-general:autotr`                    → traduction automatique en anglais on/off
 *  - `cfg-general:trlayout`                  → mise en page de la version anglaise (embed séparé ↔ texte après « 🇬🇧 »)
 */
export default defineButton({
  id: 'cfg-general',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guild || !ctx.config) return;
    const [action = '', arg] = args;
    const config = (await guildConfigService.get(interaction.guild.id)) ?? ctx.config;
    switch (action) {
      case 'view':
        return show(interaction, renderGeneral({ guild: interaction.guild, config, t, view: isGeneralView(arg) ? arg : 'main' }));
      case 'hex':
        return interaction.showModal(buildHexModal(config, t));
      case 'footer':
        return interaction.showModal(buildFooterModal(config, t));
      case 'autotr':
      case 'trlayout': {
        const current = config.autoTranslate;
        const next = action === 'autotr' ? { enabled: !current.enabled } : { layout: current.layout === 'embed' ? ('content' as const) : ('embed' as const) };
        const saved = await autoTranslateService.updateSettings(interaction.guild.id, next);
        const fresh = (await guildConfigService.get(interaction.guild.id)) ?? config;
        const text =
          action === 'autotr'
            ? t('panels_core.general.translate_set', { state: saved.enabled ? t('core.enabled') : t('core.disabled') })
            : t('panels_core.general.translate_layout_set', { layout: t(`panels_core.general.translate_layout_${saved.layout}`) });
        return show(interaction, renderGeneral({ guild: interaction.guild, config: fresh, t, notice: { type: 'success', text } }));
      }
      default:
        return unknownAction(interaction, t, action);
    }
  },
});
