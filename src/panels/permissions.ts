import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { embedService } from '../services/EmbedService';
import { commandPermissionService } from '../services/CommandPermissionService';
import { openPanel } from './_coreKit';
import { renderPermissions } from './_permissions';

/** 🔐 Permissions : rôles autorisés par commande, commandes désactivées, par catégorie. */
export default defineConfigPanel({
  key: 'permissions',
  label: 'Permissions',
  emoji: '🔐',
  order: 2,
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return interaction.reply({ embeds: [embedService.error(ctx.t('core.guild_only'))], flags: MessageFlags.Ephemeral });
    const rules = await commandPermissionService.rules(interaction.guild.id);
    await openPanel(interaction, renderPermissions({ guild: interaction.guild, config: ctx.config, t: ctx.t, commands: ctx.client.commands.values(), rules }));
  },
});
