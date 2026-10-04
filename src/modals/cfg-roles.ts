import type { ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { attempt, deferModal, modalText, modalValues, respond, unknownAction, type PanelNotice } from '../panels/_modulesKit';
import { addReactionRole, renderRoles, saveDelays, saveNotification, type RolesTab } from '../panels/_roles';

/**
 * Modals du panneau `/config module:roles` (namespace `cfg-roles`, admin) :
 *  - `delays`  : délai par déclencheur (JOIN / BOT / VERIFIED)
 *  - `rr-add`  : reaction role (lien du message, emoji, rôle)
 *  - `nf-add`  : rôle de notification (clé, rôle, libellé, emoji, description)
 */
export default defineModal({
  id: 'cfg-roles',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = ''] = args;
    await handle(interaction, action, ctx);
  },
});

async function handle(interaction: ModalSubmitInteraction<'cached'>, action: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const config = ctx.config!;
  const guild = interaction.guild;
  const field = (id: string) => modalText(interaction, id);
  const view = async (tab: RolesTab, notice?: PanelNotice) => respond(interaction, await renderRoles(tab, { guild, config, t, userId: interaction.user.id, notice }));

  switch (action) {
    case 'delays': {
      const notice = await attempt(t, () => saveDelays(guild.id, { JOIN: field('delay_JOIN'), BOT: field('delay_BOT'), VERIFIED: field('delay_VERIFIED') }, t));
      return view('auto', notice);
    }
    case 'rr-add': {
      await deferModal(interaction);
      const notice = await attempt(t, () => addReactionRole(guild, { link: field('link'), emoji: field('emoji'), roleId: modalValues(interaction, 'role')[0] }, t));
      return view('reactions', notice);
    }
    case 'nf-add': {
      const notice = await attempt(t, () => saveNotification(guild, { key: field('key'), roleId: modalValues(interaction, 'role')[0], label: field('label'), emoji: field('emoji'), description: field('description') }, t));
      return view('notifs', notice);
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
