import { MessageFlags } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { embedService } from '../services/EmbedService';
import { renderRemoveConfirm, selectSources } from '../commands/admin/_templateLogs';

/**
 * Menus de `/template logs` (namespace `tpl`, rattachés à la commande `template`, admin) :
 *  - `tpl:sources` → serveurs Discord à relier (multiple)
 *  - `tpl:unlink`  → source / serveur de jeu à retirer (puis confirmation)
 */
export default defineSelectMenu({
  id: 'tpl',
  command: 'template',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const guild = interaction.guild;
    if (!guild || !interaction.isStringSelectMenu()) return;
    const [action = ''] = args;
    switch (action) {
      case 'sources':
        return selectSources(interaction, ctx, guild);
      case 'unlink': {
        const [scope, id] = (interaction.values[0] ?? '').split(':');
        if ((scope !== 's' && scope !== 'g') || !id) return interaction.reply({ embeds: [embedService.error(ctx.t('core.not_found'))], flags: MessageFlags.Ephemeral });
        return interaction.update(await renderRemoveConfirm(ctx, guild, scope, id));
      }
      default:
        return interaction.reply({ embeds: [embedService.error(ctx.t('core.not_found'))], flags: MessageFlags.Ephemeral });
    }
  },
});
