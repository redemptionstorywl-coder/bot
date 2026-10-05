import { defineModal } from '../structures';
import { CUSTOM_PRESET, tempVoiceService, voiceNameRuleSchema } from '../services/TempVoiceService';
import { PanelError, attempt, modalText, respond, unknownAction, type PanelNotice } from '../panels/_modulesKit';
import { parseLimitField, renderVocal, ruleExample, type VocalView } from '../panels/_vocal';

/**
 * Modals du panneau `/config module:vocal` (namespace `cfg-vocal`, admin) :
 *  - `limit`      : limite de membres (vide = celle du lobby, 0 = illimitée)
 *  - `edit:<i>`   : emoji + modèle de la règle n°i
 *  - `fallback`   : emoji + modèle de la règle de repli (aucun rôle de langue)
 */
export default defineModal({
  id: 'cfg-vocal',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t } = ctx;
    const guild = interaction.guild;
    const [action = '', arg = ''] = args;
    let view: VocalView = 'rules';
    let selected: number | undefined;
    let notice: PanelNotice;

    /** Règle saisie dans le modal (emoji optionnel, modèle avec {name}). */
    const readRule = () => {
      const parsed = voiceNameRuleSchema.safeParse({ preset: CUSTOM_PRESET, emoji: modalText(interaction, 'emoji') ?? '', template: modalText(interaction, 'template') ?? '' });
      if (!parsed.success) throw new PanelError('vocal.panel.invalid_rule');
      return parsed.data;
    };

    switch (action) {
      case 'limit':
        view = 'main';
        notice = await attempt(t, async () => {
          const limit = parseLimitField(modalText(interaction, 'limit'), t);
          await tempVoiceService.updateConfig(guild.id, { userLimit: limit });
          return limit === null ? t('vocal.panel.limit_inherit_set') : limit === 0 ? t('vocal.panel.limit_none_set') : t('vocal.panel.limit_set', { limit });
        });
        break;
      case 'edit': {
        const index = Number.parseInt(arg, 10);
        selected = index;
        notice = await attempt(t, async () => {
          const settings = await tempVoiceService.getConfig(guild.id);
          const current = settings.rules[index];
          if (!current) throw new PanelError('vocal.panel.rule_not_found');
          const rule = { ...readRule(), roleId: current.roleId };
          await tempVoiceService.updateConfig(guild.id, { rules: settings.rules.map((r, i) => (i === index ? rule : r)) });
          return t('vocal.panel.rule_saved', { n: index + 1, example: ruleExample(rule, t) });
        });
        break;
      }
      case 'fallback':
        notice = await attempt(t, async () => {
          const rule = readRule();
          await tempVoiceService.updateConfig(guild.id, { fallback: rule });
          return t('vocal.panel.fallback_saved', { example: ruleExample(rule, t) });
        });
        break;
      default:
        return unknownAction(interaction, t, action);
    }
    return respond(interaction, await renderVocal({ guild, config: ctx.config, t, member: interaction.member, view, selected, notice }));
  },
});
