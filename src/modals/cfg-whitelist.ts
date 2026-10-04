import { defineModal } from '../structures';
import { MAX_QUESTIONS, whitelistService } from '../services/WhitelistService';
import { attempt, modalText, respond, unknownAction } from '../panels/_modulesKit';
import { parseWhitelistQuestionSlots, renderWhitelist } from '../panels/_whitelist';

/** Modal `cfg-whitelist:questions` : 5 lignes `Libellé | paragraph/short | required/optional | placeholder` (vides = questions par défaut). */
export default defineModal({
  id: 'cfg-whitelist',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t, lang } = ctx;
    const [action = ''] = args;
    if (action !== 'questions') return unknownAction(interaction, t, action);
    const notice = await attempt(t, async () => {
      const questions = parseWhitelistQuestionSlots(Array.from({ length: MAX_QUESTIONS }, (_, i) => modalText(interaction, `q${i + 1}`)));
      await whitelistService.updateConfig(interaction.guildId, { questions });
      return questions.length ? t('whitelist.config.questions_saved', { count: questions.length }) : t('panels_modules.whitelist.questions_default');
    });
    return respond(interaction, await renderWhitelist({ guild: interaction.guild, config: ctx.config, t, lang, notice }));
  },
});
