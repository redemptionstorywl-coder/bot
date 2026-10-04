import type { ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { shopService } from '../services/ShopService';
import { PanelError, attempt, ko, modalText, parseIntField, respond, unknownAction } from '../panels/_modulesKit';
import { parseProductForm, parseTebexForm, renderCategories, renderProduct, renderProducts } from '../panels/_shop';

/**
 * Modals du panneau `/config module:shop` (namespace `cfg-shop`, admin) :
 * `product-new` / `edit:<id>` (nom | prix | devise | stock | image), `desc:<id>`, `tebex:<id>`, `cat-new`.
 */
export default defineModal({
  id: 'cfg-shop',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', arg = ''] = args;
    await handle(interaction, action, arg, ctx);
  },
});

async function handle(interaction: ModalSubmitInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const opts = { guild, config: ctx.config!, t, userId };
  const field = (id: string) => modalText(interaction, id);
  const labels = { name: t('panels_modules.shop.modal_name'), stock: t('panels_modules.shop.modal_stock') };
  const form = () => parseProductForm({ name: field('name'), price: field('price'), currency: field('currency'), stock: field('stock'), image: field('image') }, labels);

  if (action === 'product-new') {
    let createdId: number | null = null;
    const notice = await attempt(t, async () => {
      const f = form();
      const product = await shopService.addProduct(guild.id, { name: f.name, price: f.price, currency: f.currency, stock: f.stock, imageUrl: f.imageUrl }, userId);
      createdId = product.id;
      return t('shop.product.added', { id: product.id, name: product.name, price: `${f.price} ${f.currency}` });
    });
    const created = createdId !== null ? await shopService.getProduct(guild.id, createdId) : null;
    return respond(interaction, created ? await renderProduct(created, { ...opts, notice }) : await renderProducts(0, { ...opts, notice }));
  }
  if (action === 'cat-new') {
    const notice = await attempt(t, async () => {
      const name = field('name');
      if (!name) throw new PanelError('panels_modules.common.required_field', { field: t('panels_modules.shop.modal_name') });
      const order = parseIntField(field('order'), t('panels_modules.shop.modal_order'), { min: -999, max: 9999, allowEmpty: true }) ?? 0;
      const cat = await shopService.addCategory(guild.id, { name, emoji: field('emoji') ?? null, description: field('description') ?? null, order });
      return t('shop.category.added', { name: cat.name });
    });
    return respond(interaction, await renderCategories({ ...opts, notice }));
  }

  const product = await shopService.getProduct(guild.id, Number(arg));
  if (!product) return respond(interaction, await renderProducts(0, { ...opts, notice: ko(t('shop.errors.product_not_found')) }));
  let notice;
  switch (action) {
    case 'edit':
      notice = await attempt(t, async () => {
        const f = form();
        await shopService.editProduct(guild.id, product.id, { name: f.name, price: f.price, currency: f.currency, stock: f.stock, imageUrl: f.imageUrl }, userId);
        return t('shop.product.edited', { id: product.id, name: f.name });
      });
      break;
    case 'desc':
      notice = await attempt(t, async () => {
        await shopService.editProduct(guild.id, product.id, { description: field('description') ?? null }, userId);
        return t('shop.product.edited', { id: product.id, name: product.name });
      });
      break;
    case 'tebex':
      notice = await attempt(t, async () => {
        await shopService.editProduct(guild.id, product.id, parseTebexForm({ packageId: field('packageId'), url: field('url') }), userId);
        return t('shop.product.edited', { id: product.id, name: product.name });
      });
      break;
    default:
      return unknownAction(interaction, t, action);
  }
  const fresh = (await shopService.getProduct(guild.id, product.id)) ?? product;
  return respond(interaction, await renderProduct(fresh, { ...opts, notice }));
}
