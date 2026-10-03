import { MessageFlags } from 'discord.js';
import { defineModal } from '../structures';
import { shopService, ShopError, buildOrderSummary } from '../services/ShopService';
import { embedService } from '../services/EmbedService';

/** Modal `shop:order:<productId>` : quantité + note → crée la commande, récap éphémère + DM (lien Tebex si présent). */
export default defineModal({
  id: 'shop',
  module: 'shop',
  async execute(interaction, args, { t, lang, config }) {
    if (!interaction.guildId || !config) return;
    const [action, rawId] = args;
    if (action !== 'order') return;
    const productId = Number(rawId);
    const quantity = Number(interaction.fields.getTextInputValue('quantity').trim() || '1');
    const note = interaction.fields.fields.has('note') ? interaction.fields.getTextInputValue('note').trim() : '';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const order = await shopService.createOrder({ guildId: interaction.guildId, userId: interaction.user.id, productId, quantity: Number.isInteger(quantity) ? quantity : 1, note: note || null });
      const summary = buildOrderSummary(order, lang, config.brandColor);
      await interaction.user.send(summary).catch(() => null);
      await interaction.editReply({ embeds: [embedService.success(t('shop.order.placed', { id: order.id })), ...summary.embeds], components: summary.components });
    } catch (err) {
      if (err instanceof ShopError) return interaction.editReply({ embeds: [embedService.error(t(`shop.errors.${err.code}`))] });
      throw err;
    }
  },
});
