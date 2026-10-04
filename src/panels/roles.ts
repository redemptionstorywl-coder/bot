import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { renderRoles } from './_roles';

/**
 * 🎭 Rôles : auto-roles, role menus, reaction roles, notifications — un seul panneau à onglets.
 * Chaque onglet affiche (et permet de basculer) l’état de son propre module : pas de `module` unique ici.
 */
export default defineConfigPanel({
  key: 'roles',
  label: 'Rôles',
  emoji: '🎭',
  order: 6,
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return;
    const payload = await renderRoles('auto', { guild: interaction.guild, config: ctx.config, t: ctx.t, userId: interaction.user.id });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
