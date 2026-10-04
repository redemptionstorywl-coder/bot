import { defineButton } from '../structures';
import { show, toggleModule, unknownAction } from '../panels/_modulesKit';
import { buildEntityModal, isEntityKind, isSchoolTab, loadEntity, renderEntityOrList, renderSchool } from '../panels/_school';

/**
 * Boutons du panneau `/config module:school` (namespace `cfg-school`, admin) :
 * `tab:<onglet>`, `module`, `<class|house|club>-new` (modal), `edit:<kind>:<id>` (modal).
 */
export default defineButton({
  id: 'cfg-school',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t } = ctx;
    const guild = interaction.guild;
    const [action = '', a = '', b = ''] = args;
    const opts = { guild, config: ctx.config, t };

    if (action === 'tab') return show(interaction, await renderSchool(isSchoolTab(a) ? a : 'config', opts));
    if (action === 'module') {
      const r = await toggleModule(ctx.config, 'school', t);
      return show(interaction, await renderSchool('config', { ...opts, config: r.config, notice: r.notice }));
    }
    const created = action.match(/^(class|house|club)-new$/);
    if (created && isEntityKind(created[1])) return interaction.showModal(buildEntityModal(created[1], t));
    if (action === 'edit' && isEntityKind(a)) {
      const entity = await loadEntity(a, guild.id, Number(b)).catch(() => null);
      if (!entity) return show(interaction, await renderEntityOrList(a, Number(b), opts));
      return interaction.showModal(buildEntityModal(a, t, entity));
    }
    return unknownAction(interaction, t, action);
  },
});
