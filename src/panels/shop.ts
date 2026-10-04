import { MessageFlags } from 'discord.js';
import { defineConfigPanel } from '../structures/configPanel';
import { SHOP_KINDS, renderProducts } from './_shop';

/** 🛒 Shop : produits (prix, stock, image, catégorie, Tebex), catégories, annonce d'un produit. */
export default defineConfigPanel({
  key: 'shop',
  label: 'Shop',
  emoji: '🛒',
  order: 11,
  module: 'shop',
  guildKinds: SHOP_KINDS,
  async open(interaction, ctx) {
    if (!interaction.guild || !ctx.config) return;
    const payload = await renderProducts(0, { guild: interaction.guild, config: ctx.config, t: ctx.t, userId: interaction.user.id });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
});
