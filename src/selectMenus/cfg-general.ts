import { GuildKind } from '@prisma/client';
import { defineSelectMenu } from '../structures';
import { EMBED_COLOR_PALETTE, LANGUAGES } from '../config/constants';
import { guildConfigService } from '../services/GuildConfigService';
import { translationService } from '../services/TranslationService';
import { ko, ok, show, unknownAction, type PanelNotice } from '../panels/_coreKit';
import { MAX_PANEL_ROLES, modulesFromSelection, renderGeneral, type GeneralView } from '../panels/_general';

/**
 * Menus du panneau `/config general` (namespace `cfg-general`, admin) :
 *  - `cfg-general:kind`    (StringSelect) → type de serveur (active les modules par défaut du type)
 *  - `cfg-general:lang`    (StringSelect) → langue du bot
 *  - `cfg-general:admins`  (RoleSelect)   → rôles admin du bot (0–25)
 *  - `cfg-general:staff`   (RoleSelect)   → rôles staff (0–25)
 *  - `cfg-general:modules` (StringSelect) → modules activés (les autres sont désactivés)
 *  - `cfg-general:palette` (StringSelect) → couleur de marque depuis la palette
 */
export default defineSelectMenu({
  id: 'cfg-general',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.guild || !ctx.config) return;
    const guildId = interaction.guild.id;
    const [action = ''] = args;
    let t = ctx.t;
    let notice: PanelNotice;
    let view: GeneralView = 'main';

    switch (action) {
      case 'kind': {
        if (!interaction.isStringSelectMenu()) return;
        const kind = interaction.values[0] as GuildKind;
        if (!Object.values(GuildKind).includes(kind)) return unknownAction(interaction, t, kind);
        await guildConfigService.setKind(guildId, kind);
        notice = ok(t('panels_core.general.kind_set', { kind: t(`panels_core.kinds.${kind}`) }));
        break;
      }
      case 'lang': {
        if (!interaction.isStringSelectMenu()) return;
        const language = LANGUAGES.find((l) => l.code === interaction.values[0]);
        if (!language) return unknownAction(interaction, t, interaction.values[0] ?? '');
        await guildConfigService.updateSettings(guildId, { defaultLanguage: language.code });
        t = translationService.bind(language.code);
        notice = ok(t('panels_core.general.language_set', { language: `${language.flag} ${language.nativeLabel}` }));
        break;
      }
      case 'admins':
      case 'staff': {
        if (!interaction.isRoleSelectMenu()) return;
        const ids = [...interaction.values].slice(0, MAX_PANEL_ROLES);
        await guildConfigService.updateSettings(guildId, action === 'admins' ? { adminRoleIds: ids } : { staffRoleIds: ids });
        notice = ok(t(action === 'admins' ? 'panels_core.general.admins_set' : 'panels_core.general.staff_set', { count: ids.length }));
        break;
      }
      case 'modules': {
        if (!interaction.isStringSelectMenu()) return;
        const modules = modulesFromSelection(interaction.values);
        await guildConfigService.updateSettings(guildId, { modules });
        notice = ok(t('panels_core.general.modules_set', { count: Object.values(modules).filter(Boolean).length }));
        view = 'modules';
        break;
      }
      case 'palette': {
        if (!interaction.isStringSelectMenu()) return;
        const color = EMBED_COLOR_PALETTE.find((c) => c.key === interaction.values[0]);
        view = 'color';
        if (!color) {
          notice = ko(t('panels_core.general.invalid_color', { details: interaction.values[0] ?? '' }));
          break;
        }
        await guildConfigService.updateSettings(guildId, { brandColor: color.hex.toUpperCase() });
        notice = ok(t('panels_core.general.color_set', { color: `${t(`embeds.palette.${color.key}`)} (${color.hex})` }));
        break;
      }
      default:
        return unknownAction(interaction, t, action);
    }

    const config = (await guildConfigService.get(guildId)) ?? ctx.config;
    await show(interaction, renderGeneral({ guild: interaction.guild, config, t, view, notice }));
  },
});
