import type { AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { shopService } from '../services/ShopService';
import { attempt, ko, show, unknownAction } from '../panels/_modulesKit';
import { renderAnnounce, renderCategories, renderProduct, renderProducts, setAnnounceDraft } from '../panels/_shop';

/**
 * Menus du panneau `/config module:shop` (namespace `cfg-shop`, admin) :
 * `product` (fiche), `cat:<id>` (catégorie du produit), `cat-del` (supprime une catégorie),
 * `ann-product` / `ann-channel` (brouillon d'annonce).
 */
export default defineSelectMenu({
  id: 'cfg-shop',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', arg = ''] = args;
    await handle(interaction, action, arg, ctx);
  },
});

async function handle(interaction: AnySelectMenuInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const opts = { guild, config: ctx.config!, t, userId };
  const value = interaction.values[0] ?? '';
  const notFound = async () => show(interaction, await renderProducts(0, { ...opts, notice: ko(t('shop.errors.product_not_found')) }));

  switch (action) {
    case 'product': {
      const product = await shopService.getProduct(guild.id, Number(value));
      return product ? show(interaction, await renderProduct(product, opts)) : notFound();
    }
    case 'cat': {
      const product = await shopService.getProduct(guild.id, Number(arg));
      if (!product) return notFound();
      const notice = await attempt(t, async () => {
        await shopService.editProduct(guild.id, product.id, { categoryId: value === 'none' ? null : Number(value) }, userId);
        return t('shop.product.edited', { id: product.id, name: product.name });
      });
      const fresh = (await shopService.getProduct(guild.id, product.id)) ?? product;
      return show(interaction, await renderProduct(fresh, { ...opts, notice }));
    }
    case 'cat-del': {
      const notice = await attempt(t, async () => {
        const removed = await shopService.removeCategory(guild.id, Number(value));
        return t('shop.category.removed', { name: removed.name });
      });
      return show(interaction, await renderCategories({ ...opts, notice }));
    }
    case 'ann-product':
      setAnnounceDraft(guild.id, userId, { productId: Number(value) });
      return show(interaction, await renderAnnounce(opts));
    case 'ann-channel':
      setAnnounceDraft(guild.id, userId, { channelId: value });
      return show(interaction, await renderAnnounce(opts));
    default:
      return unknownAction(interaction, t, action);
  }
}
