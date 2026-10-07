import { MessageFlags } from 'discord.js';
import { defineButton } from '../structures';
import { embedService } from '../services/EmbedService';
import { currentSession, loadSession, nextGameState, renderMain, renderRemove, runCreate, runUnlink, sessionKey, templateSessions } from '../commands/admin/_templateLogs';

/**
 * Boutons de `/template logs` (namespace `tpl`, rattachés à la commande `template`, admin) :
 *  - `tpl:game:<id>`             → logs en jeu du serveur FiveM : non → oui → oui + chat
 *  - `tpl:create`                → relie la sélection et crée / répare la structure
 *  - `tpl:remove`                → vue « Retirer une source »
 *  - `tpl:unlinkok:<s|g>:<id>`   → retrait confirmé
 *  - `tpl:back`                  → retour à l'état du hub
 *  - `tpl:cancel`                → ferme l'assistant
 */
export default defineButton({
  id: 'tpl',
  command: 'template',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const guild = interaction.guild;
    if (!guild) return;
    const [action = '', scope, id] = args;
    switch (action) {
      case 'game': {
        const session = await currentSession(ctx, guild, interaction.user.id);
        const server = session.gameServers.find((g) => String(g.id) === scope);
        if (server) session.games[String(server.id)] = nextGameState(session.games[String(server.id)] ?? 'off', server.linked);
        templateSessions.set(sessionKey(guild.id, interaction.user.id), session);
        return interaction.update(await renderMain(ctx, guild, session));
      }
      case 'create': {
        const session = await currentSession(ctx, guild, interaction.user.id);
        await interaction.deferUpdate();
        await runCreate(interaction, ctx, guild, session);
        templateSessions.delete(sessionKey(guild.id, interaction.user.id));
        return;
      }
      case 'remove':
        return interaction.update(await renderRemove(ctx, guild));
      case 'unlinkok': {
        if ((scope !== 's' && scope !== 'g') || !id) return interaction.reply({ embeds: [embedService.error(ctx.t('core.not_found'))], flags: MessageFlags.Ephemeral });
        await interaction.deferUpdate();
        const notice = await runUnlink(ctx, guild, interaction.user.id, scope, id);
        const session = await loadSession(ctx, guild, interaction.user.id);
        return interaction.editReply(await renderMain(ctx, guild, session, notice));
      }
      case 'back': {
        await interaction.deferUpdate();
        const session = await loadSession(ctx, guild, interaction.user.id);
        return interaction.editReply(await renderMain(ctx, guild, session));
      }
      case 'cancel':
        templateSessions.delete(sessionKey(guild.id, interaction.user.id));
        return interaction.update({ embeds: [embedService.info(ctx.t('loghub.template.cancelled'))], components: [] });
      default:
        return interaction.reply({ embeds: [embedService.error(ctx.t('core.not_found'))], flags: MessageFlags.Ephemeral });
    }
  },
});
