import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { embedService } from '../services/EmbedService';
import { welcomeService, type Localized } from '../services/WelcomeService';
import {
  buildButtonsModal,
  buildDmModal,
  buildEmbedModal,
  buildImageModal,
  buildMessageModal,
  checkPanelAccess,
  ensureTabModule,
  isTabModuleEnabled,
  isWelcomeTab,
  onOff,
  renderPanel,
  variablesEmbed,
  type PanelNotice,
  type WelcomeTab,
} from '../commands/roles/_welcomeShared';

/**
 * Boutons du namespace `welcome` :
 *  - `welcome:cfg:<action>:<tab>`      → panneau `/config bienvenue` (admin, vérifié ici ; utilisable module désactivé).
 *      tab ∈ welcome | leave ; actions : tab, toggle, test, message, embed, image, imgtoggle, dm, dmmsg, buttons, logs, vars.
 * Les autres boutons configurés par le staff utilisent leur propre namespace (ex. `rolemenu:toggle:<roleId>`) ou sont des liens.
 */
export default defineButton({
  id: 'welcome',
  cooldown: 1,
  async execute(interaction, args, ctx) {
    const [action, second, third] = args;
    if (action === 'cfg') {
      await panelAction(interaction, second ?? '', third, ctx);
      return;
    }
    await interaction.reply({ embeds: [embedService.error(ctx.t('core.invalid_input', { details: action ?? '' }))], flags: MessageFlags.Ephemeral });
  },
});

async function refresh(interaction: ButtonInteraction, tab: WelcomeTab, ctx: InteractionContext, notice?: PanelNotice): Promise<void> {
  const payload = await renderPanel({ guild: interaction.guild!, tab, t: ctx.t, lang: ctx.lang, notice });
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

async function panelAction(interaction: ButtonInteraction, action: string, tabArg: string | undefined, ctx: InteractionContext): Promise<void> {
  const { t, config } = ctx;
  const tab: WelcomeTab = isWelcomeTab(tabArg) ? tabArg : 'welcome';
  const denied = checkPanelAccess(interaction, ctx);
  if (denied) {
    await interaction.reply({ embeds: [embedService.error(t(denied.key, denied.vars))], flags: MessageFlags.Ephemeral });
    return;
  }
  const guild = interaction.guild!;
  const guildId = guild.id;
  const lang = ctx.lang;
  const ok = (text: string): PanelNotice => ({ type: 'success', text });

  // ── Modals ──
  if (action === 'message' || action === 'embed' || action === 'image' || action === 'dmmsg' || action === 'buttons') {
    const current = tab === 'welcome' ? await welcomeService.getConfig(guildId) : await welcomeService.getLeaveConfig(guildId);
    switch (action) {
      case 'message':
        await interaction.showModal(buildMessageModal(tab, current?.message as Localized<string> | null, t, lang));
        return;
      case 'embed':
        await interaction.showModal(buildEmbedModal(tab, current?.embed, t, lang));
        return;
      case 'image':
        await interaction.showModal(buildImageModal(tab, current, t));
        return;
      case 'dmmsg':
        await interaction.showModal(buildDmModal(tab === 'welcome' ? (current as Awaited<ReturnType<typeof welcomeService.getConfig>>) : null, t, lang));
        return;
      case 'buttons':
        await interaction.showModal(buildButtonsModal(tab === 'welcome' ? (current as Awaited<ReturnType<typeof welcomeService.getConfig>>)?.buttons : [], t));
        return;
    }
  }

  switch (action) {
    case 'tab':
      await refresh(interaction, tab, ctx);
      return;
    case 'vars':
      await interaction.reply({ embeds: [variablesEmbed(t)], flags: MessageFlags.Ephemeral });
      return;
    case 'toggle': {
      // Un seul interrupteur : activer le message active aussi le module du serveur.
      const moduleOn = await isTabModuleEnabled(guildId, tab);
      const c = tab === 'welcome' ? await welcomeService.getConfig(guildId) : await welcomeService.getLeaveConfig(guildId);
      const enabled = !((c?.enabled ?? false) && moduleOn);
      if (tab === 'welcome') await welcomeService.updateConfig(guildId, { enabled });
      else await welcomeService.updateLeaveConfig(guildId, { enabled });
      if (enabled) await ensureTabModule(guildId, tab);
      await refresh(interaction, tab, ctx, ok(t(tab === 'welcome' ? 'welcome.config.enabled_set' : 'welcome.leave.config.enabled_set', { state: onOff(enabled, t) })));
      return;
    }
    case 'imgtoggle': {
      if (tab === 'welcome') {
        const c = await welcomeService.getConfig(guildId);
        const imageEnabled = !(c?.imageEnabled ?? false);
        await welcomeService.updateConfig(guildId, { imageEnabled });
        await refresh(interaction, tab, ctx, ok(t('welcome.config.image_set', { state: onOff(imageEnabled, t) })));
      } else {
        const c = await welcomeService.getLeaveConfig(guildId);
        const imageEnabled = !(c?.imageEnabled ?? false);
        await welcomeService.updateLeaveConfig(guildId, { imageEnabled });
        await refresh(interaction, tab, ctx, ok(t('welcome.leave.config.image_set', { state: onOff(imageEnabled, t) })));
      }
      return;
    }
    case 'dm': {
      const c = await welcomeService.getConfig(guildId);
      const dmEnabled = !(c?.dmEnabled ?? false);
      await welcomeService.updateConfig(guildId, { dmEnabled });
      await refresh(interaction, 'welcome', ctx, ok(t('welcome.config.dm_set', { state: onOff(dmEnabled, t) })));
      return;
    }
    case 'logs': {
      const c = await welcomeService.getLeaveConfig(guildId);
      const logEnabled = !(c?.logEnabled ?? true);
      await welcomeService.updateLeaveConfig(guildId, { logEnabled });
      await refresh(interaction, 'leave', ctx, ok(t('welcome.leave.config.logs_set', { state: onOff(logEnabled, t) })));
      return;
    }
    case 'test': {
      await interaction.deferUpdate();
      const member = await guild.members.fetch(interaction.user.id);
      const payload = tab === 'welcome' ? await welcomeService.preview(guild, member) : await welcomeService.previewLeave(guild, member);
      const prefix = tab === 'welcome' ? 'welcome.config' : 'welcome.leave.config';
      if (!payload) {
        await refresh(interaction, tab, ctx, { type: 'warning', text: t(`${prefix}.not_configured`) });
        return;
      }
      const current = tab === 'welcome' ? await welcomeService.getConfig(guildId) : await welcomeService.getLeaveConfig(guildId);
      const channel = current?.channelId ? await guild.channels.fetch(current.channelId).catch(() => null) : null;
      if (channel?.isTextBased() && 'send' in channel) {
        await channel.send({ content: payload.content, embeds: payload.embeds, files: payload.files, components: payload.components });
        await refresh(interaction, tab, ctx, ok(t(`${prefix}.test_sent`, { channel: `<#${channel.id}>` })));
      } else {
        await refresh(interaction, tab, ctx, { type: 'info', text: t('welcome.panel.test_preview_here') });
        await interaction.followUp({ content: payload.content, embeds: payload.embeds, files: payload.files, components: payload.components, flags: MessageFlags.Ephemeral });
      }
      return;
    }
    default:
      await interaction.reply({ embeds: [embedService.error(t('core.invalid_input', { details: action }))], flags: MessageFlags.Ephemeral });
  }
}
