import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { fivemService } from '../services/FiveMService';
import { paginate } from '../utils/pagination';
import { attempt, describeError, ko, show, toggleModule, unknownAction, type PanelNotice } from '../panels/_modulesKit';
import { buildAddModal, buildEditModal, buildGroupModal, buildLinkModal, buildNicknameModal, buildPlayerPages, renderDeleteConfirm, renderGroupsView, renderMain, renderRolesView, renderServer } from '../panels/_fivem';
import { embedService } from '../services/EmbedService';

/**
 * Boutons du panneau `/config module:fivem` (namespace `cfg-fivem`, admin) :
 * `main`, `module`, `add` / `link` (modals), `server:<key>`, `maint:<key>`, `players:<key>`, `test:<key>`,
 * `delete:<key>` → `delete-ok:<key>`, `nick:<key>` / `edit:<key>` (modals), `roles:<key>`, `groups:<key>`, `group-add:<key>` (modal).
 */
export default defineButton({
  id: 'cfg-fivem',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', key = ''] = args;
    await handle(interaction, action, key, ctx);
  },
});

async function handle(interaction: ButtonInteraction<'cached'>, action: string, key: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  let config = ctx.config!;
  const guild = interaction.guild;
  const main = async (notice?: PanelNotice) => show(interaction, await renderMain({ guild, config, t, notice }));
  /** Charge le serveur ; s'il a disparu, revient à la vue principale avec une notice. */
  const load = async () => {
    const server = await fivemService.getServer(guild.id, key);
    if (!server) await main(ko(t('fivem.errors.not_found')));
    return server;
  };

  switch (action) {
    case 'main':
      return main();
    case 'module': {
      const r = await toggleModule(config, 'fivem', t);
      config = r.config;
      return main(r.notice);
    }
    case 'add':
      return interaction.showModal(buildAddModal(t));
    case 'link':
      return interaction.showModal(buildLinkModal(t));
    case 'server': {
      const server = await load();
      return server && show(interaction, renderServer(server, { guild, config, t }));
    }
    case 'roles': {
      const server = await load();
      return server && show(interaction, renderRolesView(server, { guild, config, t }));
    }
    case 'groups': {
      const server = await load();
      return server && show(interaction, renderGroupsView(server, { guild, config, t }));
    }
    case 'group-add': {
      const server = await load();
      return server && interaction.showModal(buildGroupModal(server, t));
    }
    case 'nick': {
      const server = await load();
      return server && interaction.showModal(buildNicknameModal(server, t));
    }
    case 'edit': {
      const server = await load();
      return server && interaction.showModal(buildEditModal(server, t));
    }
    case 'maint': {
      const server = await load();
      if (!server) return;
      await interaction.deferUpdate();
      let updated = server;
      const notice = await attempt(t, async () => {
        updated = await fivemService.setMaintenance(guild.id, server.key, !server.maintenance, interaction.user.id);
        return t(updated.maintenance ? 'fivem.maintenance.on' : 'fivem.maintenance.off', { name: updated.name });
      });
      return show(interaction, renderServer(updated, { guild, config, t, notice }));
    }
    case 'test': {
      const server = await load();
      if (!server) return;
      await interaction.deferUpdate();
      let current = server;
      const notice = await attempt(t, async () => {
        const status = await fivemService.testConnection(server);
        current = await fivemService.applyStatus(server, status, 'poll');
        return t('panels_modules.fivem.test_ok', { players: status.players, max: status.maxPlayers || '—', version: status.version ?? '—' });
      });
      return show(interaction, renderServer(current, { guild, config, t, notice }));
    }
    case 'players': {
      const server = await load();
      if (!server) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const pages = await buildPlayerPages(server, t);
        return paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
      } catch (err) {
        const text = describeError(err, t);
        if (text === null) throw err;
        return interaction.editReply({ embeds: [embedService.error(text)] });
      }
    }
    case 'delete': {
      const server = await load();
      return server && show(interaction, renderDeleteConfirm(server, t));
    }
    case 'delete-ok': {
      const notice = await attempt(t, async () => {
        const removed = await fivemService.removeServer(guild.id, key);
        return t('fivem.remove.done', { name: removed.name });
      });
      return main(notice);
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
