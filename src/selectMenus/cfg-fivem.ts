import type { AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { fivemService } from '../services/FiveMService';
import { fivemSyncService } from '../services/FiveMSyncService';
import { attempt, ko, show, unknownAction } from '../panels/_modulesKit';
import { ROLE_FIELDS, isRoleField, renderGroupsView, renderMain, renderRolesView, renderServer, syncPatchFromSelection } from '../panels/_fivem';
import { moveRoleGroupToTop, parseRoleGroups, removeRoleGroups } from '../services/fivem/groups';

/**
 * Menus du panneau `/config module:fivem` (namespace `cfg-fivem`, admin) :
 *  - `pick` (StringSelect)                    → vue d'un serveur
 *  - `status:<key>` (ChannelSelect, 0–1)      → salon du message de statut (vide = désactivé)
 *  - `counter:<key>` (ChannelSelect, 0–1)     → salon vocal / catégorie renommé avec le nombre de joueurs
 *  - `sync:<key>` (StringSelect multi)        → options de synchronisation actives
 *  - `role:<linked|online|require>:<key>`     → rôle lié / en jeu / requis (RoleSelect, 0–1)
 *  - `group-del:<key>` (StringSelect multi)   → retire des associations rôle → groupe en jeu
 *  - `group-top:<key>` (StringSelect)         → place une association en tête (groupe le plus prioritaire)
 */
export default defineSelectMenu({
  id: 'cfg-fivem',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', a = '', b = ''] = args;
    await handle(interaction, action, a, b, ctx);
  },
});

async function handle(interaction: AnySelectMenuInteraction<'cached'>, action: string, a: string, b: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const config = ctx.config!;
  const guild = interaction.guild;
  const opts = { guild, config, t };
  const key = action === 'role' ? b : action === 'pick' ? (interaction.values[0] ?? '') : a;
  const server = await fivemService.getServer(guild.id, key);
  if (!server) return show(interaction, await renderMain({ ...opts, notice: ko(t('fivem.errors.not_found')) }));

  switch (action) {
    case 'pick':
      return show(interaction, renderServer(server, opts));
    case 'status': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0] ?? null;
      await interaction.deferUpdate();
      let updated = server;
      const notice = await attempt(t, async () => {
        updated = await fivemService.setStatusChannel(guild.id, server.key, channelId);
        return channelId ? t('fivem.status_channel.set', { name: server.name, channel: `<#${channelId}>` }) : t('fivem.status_channel.removed', { name: server.name });
      });
      return show(interaction, renderServer(updated, { ...opts, notice }));
    }
    case 'counter':
    case 'sync': {
      const patch = action === 'counter' ? { playerCountChannelId: interaction.values[0] ?? null } : syncPatchFromSelection(interaction.values);
      await interaction.deferUpdate();
      let updated = server;
      const notice = await attempt(t, async () => {
        updated = await fivemSyncService.updateSyncSettings(guild.id, server.key, patch);
        return t('fivem.sync.updated', { name: server.name });
      });
      return show(interaction, renderServer(updated, { ...opts, notice }));
    }
    case 'role': {
      if (!interaction.isRoleSelectMenu() || !isRoleField(a)) return;
      let updated = server;
      const notice = await attempt(t, async () => {
        updated = await fivemSyncService.updateSyncSettings(guild.id, server.key, { [ROLE_FIELDS[a]]: interaction.values[0] ?? null });
        return t('fivem.sync.updated', { name: server.name });
      });
      return show(interaction, renderRolesView(updated, { ...opts, notice }));
    }
    case 'group-del':
    case 'group-top': {
      if (!interaction.isStringSelectMenu()) return;
      const current = parseRoleGroups(server.roleGroups);
      const roleGroups = action === 'group-del' ? removeRoleGroups(current, interaction.values) : moveRoleGroupToTop(current, interaction.values[0] ?? '');
      await interaction.deferUpdate();
      let updated = server;
      const notice = await attempt(t, async () => {
        updated = await fivemSyncService.updateSyncSettings(guild.id, server.key, { roleGroups });
        return t('panels_modules.fivem.groups_updated', { name: server.name });
      });
      return show(interaction, renderGroupsView(updated, { ...opts, notice }));
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
