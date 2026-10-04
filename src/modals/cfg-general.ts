import { defineModal } from '../structures';
import { guildConfigService } from '../services/GuildConfigService';
import { ko, modalText, ok, respond, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { parseFooter, parseHexColor, renderGeneral, type GeneralView } from '../panels/_general';

/**
 * Modals du panneau `/config general` (namespace `cfg-general`, admin) :
 *  - `cfg-general:hex`    : champ `hex` (#RRGGBB)
 *  - `cfg-general:footer` : champs `text` (vide = défaut) et `icon` (URL http(s))
 */
export default defineModal({
  id: 'cfg-general',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    const { t } = ctx;
    if (!interaction.guild || !ctx.config) return;
    const guildId = interaction.guild.id;
    const [action = ''] = args;
    let notice: PanelNotice;
    let view: GeneralView = 'main';

    switch (action) {
      case 'hex': {
        view = 'color';
        const raw = modalText(interaction, 'hex');
        const hex = parseHexColor(raw);
        if (!hex) {
          notice = ko(t('panels_core.general.invalid_color', { details: raw ?? '' }));
          break;
        }
        await guildConfigService.updateSettings(guildId, { brandColor: hex });
        notice = ok(t('panels_core.general.color_set', { color: hex }));
        break;
      }
      case 'footer': {
        const parsed = parseFooter(modalText(interaction, 'text'), modalText(interaction, 'icon'));
        if (!parsed.ok) {
          notice = ko(t('panels_core.general.invalid_url', { details: parsed.error }));
          break;
        }
        await guildConfigService.updateSettings(guildId, { footerText: parsed.footerText, footerIconUrl: parsed.footerIconUrl });
        notice = ok(t(parsed.footerText || parsed.footerIconUrl ? 'panels_core.general.footer_set' : 'panels_core.general.footer_cleared'));
        break;
      }
      default:
        return unknownAction(interaction, t, action);
    }

    const config = (await guildConfigService.get(guildId)) ?? ctx.config;
    await respond(interaction, renderGeneral({ guild: interaction.guild, config, t, view, notice }));
  },
});
