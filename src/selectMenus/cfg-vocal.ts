import { ChannelType } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { MAX_RULES, getVoicePreset, ruleFromPreset, tempVoiceService } from '../services/TempVoiceService';
import { attempt, ko, ok, show, unknownAction, type PanelNotice } from '../panels/_modulesKit';
import { renderVocal, type VocalView } from '../panels/_vocal';

/**
 * Menus du panneau `/config module:vocal` (namespace `cfg-vocal`, admin) :
 *  - `lobbies`        (ChannelSelect vocaux, 0–10) : salons « Créer un salon » ; vide = aucun
 *  - `category`       (ChannelSelect catégorie, 0–1) : catégorie des salons créés ; vide = celle du lobby
 *  - `preset`         (StringSelect) : langue à associer → affiche le menu de rôle
 *  - `role:<langue>`  (RoleSelect) : ajoute (ou remplace) la règle du rôle avec le modèle de la langue
 *  - `rule`           (StringSelect) : sélectionne une règle (monter, descendre, modifier, retirer)
 */
export default defineSelectMenu({
  id: 'cfg-vocal',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t } = ctx;
    const guild = interaction.guild;
    const [action = '', arg = ''] = args;
    let view: VocalView = 'main';
    let picked: string | undefined;
    let selected: number | undefined;
    let notice: PanelNotice | undefined;

    switch (action) {
      case 'lobbies': {
        if (!interaction.isChannelSelectMenu()) return unknownAction(interaction, t, action);
        const ids = interaction.values.filter((id) => guild.channels.cache.get(id)?.type === ChannelType.GuildVoice);
        notice = await attempt(t, async () => {
          await tempVoiceService.updateConfig(guild.id, { lobbyIds: ids });
          return ids.length ? t('vocal.panel.lobbies_set', { count: ids.length, channels: ids.map((id) => `<#${id}>`).join(' ') }) : t('vocal.panel.lobbies_cleared');
        });
        break;
      }
      case 'category': {
        if (!interaction.isChannelSelectMenu()) return unknownAction(interaction, t, action);
        const id = interaction.values[0] ?? null;
        await tempVoiceService.updateConfig(guild.id, { categoryId: id });
        notice = ok(id ? t('vocal.panel.category_set', { category: `<#${id}>` }) : t('vocal.panel.category_cleared'));
        break;
      }
      case 'preset': {
        if (!interaction.isStringSelectMenu()) return unknownAction(interaction, t, action);
        view = 'rules';
        picked = getVoicePreset(interaction.values[0])?.key;
        break;
      }
      case 'role': {
        if (!interaction.isRoleSelectMenu()) return unknownAction(interaction, t, action);
        view = 'rules';
        const roleId = interaction.values[0];
        const preset = getVoicePreset(arg);
        if (!roleId || !preset) return unknownAction(interaction, t, arg);
        const settings = await tempVoiceService.getConfig(guild.id);
        const existing = settings.rules.findIndex((r) => r.roleId === roleId);
        if (existing === -1 && settings.rules.length >= MAX_RULES) {
          notice = ko(t('vocal.panel.rules_full', { max: MAX_RULES }));
          break;
        }
        const rule = ruleFromPreset(roleId, preset.key);
        const rules = existing === -1 ? [...settings.rules, rule] : settings.rules.map((r, i) => (i === existing ? rule : r));
        notice = await attempt(t, async () => {
          await tempVoiceService.updateConfig(guild.id, { rules });
          selected = existing === -1 ? rules.length - 1 : existing;
          return t(existing === -1 ? 'vocal.panel.rule_added' : 'vocal.panel.rule_updated', { role: `<@&${roleId}>`, language: `${preset.emoji} ${preset.label}` });
        });
        break;
      }
      case 'rule': {
        if (!interaction.isStringSelectMenu()) return unknownAction(interaction, t, action);
        view = 'rules';
        const n = Number.parseInt(interaction.values[0] ?? '', 10);
        selected = Number.isInteger(n) && n >= 0 ? n : undefined;
        break;
      }
      default:
        return unknownAction(interaction, t, action);
    }
    return show(interaction, await renderVocal({ guild, config: ctx.config, t, member: interaction.member, view, picked, selected, notice }));
  },
});
