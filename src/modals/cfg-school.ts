import type { ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { schoolService } from '../services/SchoolService';
import { PanelError, attempt, modalText, parseIntField, respond, unknownAction } from '../panels/_modulesKit';
import { isEntityKind, normalizeColor, renderEntityOrList, renderSchool, KIND_TAB, type EntityKind } from '../panels/_school';

/**
 * Modals du panneau `/config module:school` (namespace `cfg-school`, admin) :
 * `<class|house|club>-new` (création) et `edit:<kind>:<id>` (modification).
 * Classe : nom + capacité · Maison : nom + emoji + couleur · Club : nom + description + membres max.
 */
export default defineModal({
  id: 'cfg-school',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', a = '', b = ''] = args;
    const created = action.match(/^(class|house|club)-new$/);
    if (created && isEntityKind(created[1])) return save(interaction, created[1], null, ctx);
    if (action === 'edit' && isEntityKind(a)) return save(interaction, a, Number(b), ctx);
    return unknownAction(interaction, ctx.t, action);
  },
});

async function save(interaction: ModalSubmitInteraction<'cached'>, kind: EntityKind, id: number | null, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const guild = interaction.guild;
  const opts = { guild, config: ctx.config!, t };
  const field = (f: string) => modalText(interaction, f);
  let targetId = id;
  const notice = await attempt(t, async () => {
    const name = field('name');
    if (!name) throw new PanelError('panels_modules.common.required_field', { field: t('panels_modules.school.modal_name') });
    const actor = interaction.user.id;
    if (kind === 'class') {
      const capacity = parseIntField(field('capacity'), t('panels_modules.school.modal_capacity'), { min: 1, max: 9999, allowEmpty: true });
      const c = id === null ? await schoolService.createClass(guild.id, { name, capacity }, actor) : await schoolService.updateClass(guild.id, id, { name, capacity }, actor);
      targetId = c.id;
    } else if (kind === 'house') {
      const h = { name, emoji: field('emoji') ?? null, color: normalizeColor(field('color')) };
      targetId = (id === null ? await schoolService.createHouse(guild.id, h, actor) : await schoolService.updateHouse(guild.id, id, h, actor)).id;
    } else {
      const maxMembers = parseIntField(field('max'), t('panels_modules.school.modal_max_members'), { min: 1, max: 9999, allowEmpty: true });
      const c = { name, description: field('description') ?? null, maxMembers };
      targetId = (id === null ? await schoolService.createClub(guild.id, c, actor) : await schoolService.updateClub(guild.id, id, c, actor)).id;
    }
    return t(id === null ? `school.${kind}.created` : 'panels_modules.school.saved', { name });
  });
  if (targetId === null) return respond(interaction, await renderSchool(KIND_TAB[kind], { ...opts, notice }));
  return respond(interaction, await renderEntityOrList(kind, targetId, { ...opts, notice }));
}
