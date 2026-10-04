import { defineButton } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { show, unknownAction } from '../panels/_coreKit';
import { buildFooterModal, buildHexModal, isGeneralView, renderGeneral } from '../panels/_general';

/**
 * Boutons du panneau `/config general` (namespace `cfg-general`, admin) :
 *  - `cfg-general:view:<main|modules|color>` → change de vue
 *  - `cfg-general:hex`                       → modal « code hexadécimal »
 *  - `cfg-general:footer`                    → modal « footer des embeds »
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
      default:
        return unknownAction(interaction, t, action);
    }
  },
});
