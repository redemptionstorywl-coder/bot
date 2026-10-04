import { defineSelectMenu } from '../structures';
import { whitelistService } from '../services/WhitelistService';
import { ok, show, unknownAction } from '../panels/_modulesKit';
import { renderWhitelist } from '../panels/_whitelist';

/**
 * Menus du panneau `/config module:whitelist` (namespace `cfg-whitelist`, admin) :
 * `review` (ChannelSelect, 0–1), `accepted` / `pending` (RoleSelect, 0–1). Vide = retiré.
 */
export default defineSelectMenu({
  id: 'cfg-whitelist',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const { t, lang } = ctx;
    const guild = interaction.guild;
    const [action = ''] = args;
    const value = interaction.values[0] ?? null;
    if (action === 'review' && interaction.isChannelSelectMenu()) await whitelistService.updateConfig(guild.id, { reviewChannelId: value });
    else if (action === 'accepted' && interaction.isRoleSelectMenu()) await whitelistService.updateConfig(guild.id, { acceptedRoleId: value });
    else if (action === 'pending' && interaction.isRoleSelectMenu()) await whitelistService.updateConfig(guild.id, { pendingRoleId: value });
    else return unknownAction(interaction, t, action);
    return show(interaction, await renderWhitelist({ guild, config: ctx.config, t, lang, notice: ok(t('whitelist.config.updated')) }));
  },
});
