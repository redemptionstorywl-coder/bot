import { MessageFlags } from 'discord.js';
import { defineSelectMenu } from '../structures';
import { embedService } from '../services/EmbedService';
import { welcomeService } from '../services/WelcomeService';
import { checkPanelAccess, ensureTabModule, isWelcomeTab, renderPanel } from '../commands/roles/_welcomeShared';

/**
 * Menus du panneau `/config bienvenue` :
 *  - `welcome:cfg:channel:<tab>` (ChannelSelect) → enregistre le salon de bienvenue / départ (et active le message + le module).
 */
export default defineSelectMenu({
  id: 'welcome',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    const { t, config } = ctx;
    const [kind, action, tabArg] = args;
    const tab = isWelcomeTab(tabArg) ? tabArg : 'welcome';
    const denied = checkPanelAccess(interaction, ctx);
    if (denied) {
      await interaction.reply({ embeds: [embedService.error(t(denied.key, denied.vars))], flags: MessageFlags.Ephemeral });
      return;
    }
    if (kind !== 'cfg' || action !== 'channel' || !interaction.isChannelSelectMenu() || !interaction.guild) {
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: `${kind ?? ''}:${action ?? ''}` }))], flags: MessageFlags.Ephemeral });
      return;
    }
    const channelId = interaction.values[0];
    if (!channelId) return;
    const guildId = interaction.guild.id;
    const notice = { type: 'success' as const, text: '' };
    await ensureTabModule(guildId, tab);
    if (tab === 'welcome') {
      await welcomeService.updateConfig(guildId, { channelId, enabled: true });
      notice.text = t('welcome.config.channel_set', { channel: `<#${channelId}>` });
    } else {
      await welcomeService.updateLeaveConfig(guildId, { channelId, enabled: true });
      notice.text = t('welcome.leave.config.channel_set', { channel: `<#${channelId}>` });
    }
    const payload = await renderPanel({ guild: interaction.guild, tab, t, lang: ctx.lang, notice });
    await interaction.update(payload);
  },
});
