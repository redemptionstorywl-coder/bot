import type { ButtonInteraction } from 'discord.js';
import { defineButton } from '../structures';
import type { InteractionContext } from '../structures/types';
import { buildProductAnnouncement, shopService } from '../services/ShopService';
import { PanelError, attempt, ko, show, toggleModule, unknownAction } from '../panels/_modulesKit';
import {
  buildCategoryModal,
  buildDescriptionModal,
  buildProductModal,
  buildTebexModal,
  getAnnounceDraft,
  renderAnnounce,
  renderCategories,
  renderDeleteConfirm,
  renderProduct,
  renderProducts,
  setAnnounceDraft,
} from '../panels/_shop';

/**
 * Boutons du panneau `/config module:shop` (namespace `cfg-shop`, admin) :
 * `main:<page>`, `module`, `product-new` / `cat-new` (modals), `view:<id>`, `edit:<id>` / `desc:<id>` / `tebex:<id>` (modals),
 * `toggle:<id>`, `del:<id>` → `del-ok:<id>`, `cats`, `ann:<id?>`, `ann-send`.
 */
export default defineButton({
  id: 'cfg-shop',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', arg = ''] = args;
    await handle(interaction, action, arg, ctx);
  },
});

async function handle(interaction: ButtonInteraction<'cached'>, action: string, arg: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  let config = ctx.config!;
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const opts = () => ({ guild, config, t, userId });
  const load = async () => {
    const product = await shopService.getProduct(guild.id, Number(arg));
    if (!product) await show(interaction, await renderProducts(0, { ...opts(), notice: ko(t('shop.errors.product_not_found')) }));
    return product;
  };

  switch (action) {
    case 'main':
      return show(interaction, await renderProducts(Number(arg) || 0, opts()));
    case 'module': {
      const r = await toggleModule(config, 'shop', t);
      config = r.config;
      return show(interaction, await renderProducts(0, { ...opts(), notice: r.notice }));
    }
    case 'product-new':
      return interaction.showModal(buildProductModal(t));
    case 'cat-new':
      return interaction.showModal(buildCategoryModal(t));
    case 'cats':
      return show(interaction, await renderCategories(opts()));
    case 'view': {
      const product = await load();
      return product && show(interaction, await renderProduct(product, opts()));
    }
    case 'edit': {
      const product = await load();
      return product && interaction.showModal(buildProductModal(t, product));
    }
    case 'desc': {
      const product = await load();
      return product && interaction.showModal(buildDescriptionModal(product, t));
    }
    case 'tebex': {
      const product = await load();
      return product && interaction.showModal(buildTebexModal(product, t));
    }
    case 'toggle': {
      const product = await load();
      if (!product) return;
      const notice = await attempt(t, async () => {
        await shopService.editProduct(guild.id, product.id, { enabled: !product.enabled }, userId);
        return t(product.enabled ? 'panels_modules.shop.hidden_notice' : 'panels_modules.shop.visible_notice', { name: product.name });
      });
      const fresh = (await shopService.getProduct(guild.id, product.id)) ?? product;
      return show(interaction, await renderProduct(fresh, { ...opts(), notice }));
    }
    case 'del': {
      const product = await load();
      return product && show(interaction, renderDeleteConfirm(product, t));
    }
    case 'del-ok': {
      const notice = await attempt(t, async () => {
        const removed = await shopService.removeProduct(guild.id, Number(arg), userId);
        return t('shop.product.removed', { name: removed.name });
      });
      return show(interaction, await renderProducts(0, { ...opts(), notice }));
    }
    case 'ann': {
      if (arg) setAnnounceDraft(guild.id, userId, { productId: Number(arg) });
      return show(interaction, await renderAnnounce(opts()));
    }
    case 'ann-send': {
      await interaction.deferUpdate();
      const notice = await attempt(t, async () => {
        const draft = getAnnounceDraft(guild.id, userId);
        const product = draft.productId ? await shopService.getProduct(guild.id, draft.productId) : null;
        if (!product || !product.enabled) throw new PanelError('shop.errors.product_not_found');
        const channel = draft.channelId ? await guild.channels.fetch(draft.channelId).catch(() => null) : null;
        if (!channel || !channel.isTextBased() || !('send' in channel)) throw new PanelError('core.channel_not_found');
        await channel.send(buildProductAnnouncement(product, config.defaultLanguage, config.brandColor));
        return t('shop.announce.done', { product: product.name, channel: `<#${channel.id}>` });
      });
      return show(interaction, await renderAnnounce({ ...opts(), notice }));
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
