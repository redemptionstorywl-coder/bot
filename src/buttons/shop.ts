import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { defineButton } from '../structures';
import { shopService, buildCatalogPage } from '../services/ShopService';
import { embedService } from '../services/EmbedService';
import { buildCustomId } from '../utils/customId';

/**
 * Boutons `shop:order:<productId>` (ouvre la modal de commande) et `shop:page:<n>:<categoryId|all>` (pagination catalogue).
 */
export default defineButton({
  id: 'shop',
  module: 'shop',
  cooldown: 2,
  async execute(interaction, args, { t, lang, config }) {
    if (!interaction.guildId || !config) return;
    const [action, a, b] = args;

    if (action === 'order') {
      const productId = Number(a);
      const product = Number.isInteger(productId) ? await shopService.getProduct(interaction.guildId, productId) : null;
      if (!product || !product.enabled) return interaction.reply({ embeds: [embedService.error(t('shop.errors.product_not_found'))], flags: MessageFlags.Ephemeral });
      if (product.stock !== null && product.stock <= 0) return interaction.reply({ embeds: [embedService.error(t('shop.errors.out_of_stock'))], flags: MessageFlags.Ephemeral });
      const modal = new ModalBuilder()
        .setCustomId(buildCustomId('shop', 'order', product.id))
        .setTitle(t('shop.order.modal_title', { product: product.name }).slice(0, 45))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('quantity').setLabel(t('shop.order.quantity').slice(0, 45)).setStyle(TextInputStyle.Short).setValue('1').setRequired(true).setMaxLength(2)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('note').setLabel(t('shop.order.note').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
        );
      await interaction.showModal(modal);
      return;
    }

    if (action === 'page') {
      const page = Number(a);
      if (!Number.isInteger(page)) return interaction.deferUpdate();
      const categoryId = b && b !== 'all' ? Number(b) : null;
      await interaction.deferUpdate();
      const [products, categories] = await Promise.all([shopService.listProducts(interaction.guildId, { enabledOnly: true }), shopService.listCategories(interaction.guildId)]);
      const rendered = buildCatalogPage({ guildId: interaction.guildId, lang, products, categories, page, categoryId, color: config.brandColor });
      await interaction.editReply({ embeds: rendered.embeds, components: rendered.components });
    }
  },
});
