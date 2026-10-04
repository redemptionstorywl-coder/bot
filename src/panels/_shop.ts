import { ButtonStyle, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder, TextInputStyle, type Guild, type ModalBuilder } from 'discord.js';
import { GuildKind } from '@prisma/client';
import { buildCustomId } from '../utils/customId';
import { TTLCache } from '../utils/cache';
import { embedService } from '../services/EmbedService';
import { formatPrice, parsePrice, shopService, type ProductWithCategory } from '../services/ShopService';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import { PanelError, btn, channelMention, labelled, modal, moduleButton, moduleLine, option, parseIntField, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload, type Row } from './_modulesKit';
import { liveChannel } from '../utils/liveIds';

/**
 * Panneau `/config module:shop` — namespace `cfg-shop` (admin) :
 *  - produits  : `main:<page>`, `module`, `product` (StringSelect → fiche), `product-new` (modal),
 *                `edit:<id>` / `desc:<id>` / `tebex:<id>` (modals), `cat:<id>` (StringSelect catégorie), `toggle:<id>`, `del:<id>` → `del-ok:<id>`
 *  - catégories: `cats`, `cat-new` (modal), `cat-del` (StringSelect)
 *  - annonce   : `ann:<id?>`, `ann-product` (StringSelect), `ann-channel` (ChannelSelect), `ann-send`
 * Restent en commandes : /shop catalog · /shop order create|status|list|history.
 */

export const SHOP_NS = 'cfg-shop';
export const SHOP_KINDS: GuildKind[] = [GuildKind.SHOP];
export const PRODUCTS_PER_PAGE = 10;
export const shcid = (action: string, ...args: (string | number)[]): string => buildCustomId(SHOP_NS, action, ...args);

// ───── Brouillon d'annonce (par utilisateur, 15 min) ─────

export interface AnnounceDraft {
  productId?: number;
  channelId?: string;
}
const drafts = new TTLCache<AnnounceDraft>(15 * 60_000, 1000);
export const getAnnounceDraft = (guildId: string, userId: string): AnnounceDraft => drafts.get(`${guildId}:${userId}`) ?? {};
export function setAnnounceDraft(guildId: string, userId: string, patch: AnnounceDraft): AnnounceDraft {
  const next = { ...getAnnounceDraft(guildId, userId), ...patch };
  drafts.set(`${guildId}:${userId}`, next);
  return next;
}

// ───── Fonctions pures ─────

export interface ProductForm {
  name: string;
  price: string;
  currency: string;
  stock: number | null;
  imageUrl: string | null;
}

const URL_RE = /^https?:\/\/\S+$/i;
const UNLIMITED = /^(|∞|-1|inf|infini|illimité|illimite|unlimited)$/i;

/** Valide le formulaire produit `nom | prix | devise | stock | image` (stock vide = illimité). */
export function parseProductForm(input: { name?: string; price?: string; currency?: string; stock?: string; image?: string }, labels: { name: string; stock: string }): ProductForm {
  const name = (input.name ?? '').trim();
  if (!name) throw new PanelError('panels_modules.common.required_field', { field: labels.name });
  const price = parsePrice(input.price ?? '').toFixed(2);
  const currency = (input.currency ?? 'EUR').trim().toUpperCase() || 'EUR';
  if (!/^[A-Z]{1,8}$/.test(currency)) throw new PanelError('panels_modules.shop.invalid_currency', { value: currency });
  const stockRaw = (input.stock ?? '').trim();
  const stock = UNLIMITED.test(stockRaw) ? null : parseIntField(stockRaw, labels.stock, { min: 0, max: 1_000_000 });
  const image = (input.image ?? '').trim();
  if (image && !URL_RE.test(image)) throw new PanelError('panels_modules.shop.invalid_url', { value: truncate(image, 80) });
  return { name: name.slice(0, 100), price, currency, stock, imageUrl: image || null };
}

/** Lien Tebex : identifiant de package + URL (vides = retirés). */
export function parseTebexForm(input: { packageId?: string; url?: string }): { tebexPackageId: string | null; tebexUrl: string | null } {
  const packageId = (input.packageId ?? '').trim();
  const url = (input.url ?? '').trim();
  if (packageId && !/^[\w-]{1,64}$/.test(packageId)) throw new PanelError('panels_modules.shop.invalid_package', { value: truncate(packageId, 64) });
  if (url && !URL_RE.test(url)) throw new PanelError('panels_modules.shop.invalid_url', { value: truncate(url, 80) });
  return { tebexPackageId: packageId || null, tebexUrl: url || null };
}

// ───── Rendu ─────

export interface ShopRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  userId: string;
  notice?: PanelNotice;
}

const stockLabel = (p: ProductWithCategory, t: Translator) => (p.stock === null ? '∞' : p.stock > 0 ? String(p.stock) : t('shop.catalog.sold_out'));

function productLine(p: ProductWithCategory, t: Translator): string {
  return `${p.enabled ? '🟢' : '⚪'} \`#${p.id}\` **${truncate(p.name, 60)}** · ${formatPrice(p.price, p.currency)} · 📦 ${stockLabel(p, t)}${p.category ? ` · ${p.category.emoji ?? '📂'} ${p.category.name}` : ''}${p.tebexPackageId || p.tebexUrl ? ' · 🔗 Tebex' : ''}`;
}

export async function renderProducts(page: number, opts: ShopRenderOptions): Promise<PanelPayload> {
  const { guild, config, t, notice } = opts;
  const [products, categories] = await Promise.all([shopService.listProducts(guild.id), shopService.listCategories(guild.id)]);
  const pages = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_PAGE));
  const current = Math.min(Math.max(0, Number.isInteger(page) ? page : 0), pages - 1);
  const items = products.slice(current * PRODUCTS_PER_PAGE, (current + 1) * PRODUCTS_PER_PAGE);
  const embed = embedService
    .brand(t('panels_modules.shop.title', { server: guild.name }))
    .setDescription(withNotice(notice, `${t(products.length ? 'panels_modules.shop.hint' : 'panels_modules.shop.empty')}\n\n${moduleLine(config, 'shop', t, SHOP_KINDS)}`))
    .addFields({ name: t('panels_modules.shop.field_products', { count: products.length, categories: categories.length }), value: truncate(items.map((p) => productLine(p, t)).join('\n') || t('core.none'), 1024) })
    .setFooter({ text: t('core.page', { current: current + 1, total: pages }) });
  const components: Row[] = [];
  if (items.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(shcid('product'))
          .setPlaceholder(truncate(t('panels_modules.shop.product_placeholder'), 150))
          .addOptions(items.map((p) => option(`#${p.id} · ${p.name}`, String(p.id), { description: `${formatPrice(p.price, p.currency)} · ${stockLabel(p, t)}${p.category ? ` · ${p.category.name}` : ''}`, emoji: p.enabled ? '🟢' : '⚪' }))),
      ),
    );
  }
  components.push(
    row(
      btn(shcid('main', current - 1), t('panels_modules.common.previous'), ButtonStyle.Secondary, '◀️', current <= 0),
      btn(shcid('main', current + 1), t('panels_modules.common.next'), ButtonStyle.Secondary, '▶️', current >= pages - 1),
      btn(shcid('product-new'), t('panels_modules.shop.btn_new_product'), ButtonStyle.Success, '➕'),
      btn(shcid('cats'), t('panels_modules.shop.btn_categories'), ButtonStyle.Secondary, '📂'),
      btn(shcid('ann'), t('panels_modules.shop.btn_announce'), ButtonStyle.Primary, '📢', !products.some((p) => p.enabled)),
    ),
    row(moduleButton(shcid('module'), 'shop', config.modules.shop, t), btn(shcid('main', current), t('panels_modules.common.refresh'), ButtonStyle.Secondary, '🔄')),
  );
  return { embeds: [embed], components };
}

export async function renderProduct(product: ProductWithCategory, opts: ShopRenderOptions): Promise<PanelPayload> {
  const { guild, t, notice } = opts;
  const categories = await shopService.listCategories(guild.id);
  const none = t('core.none');
  const embed = embedService
    .brand(`${product.enabled ? '🟢' : '⚪'} #${product.id} · ${product.name}`)
    .setDescription(withNotice(notice, product.description ? truncate(product.description, 1500) : t('panels_modules.shop.no_description')))
    .addFields(
      { name: t('shop.product.price'), value: formatPrice(product.price, product.currency), inline: true },
      { name: t('shop.product.stock'), value: product.stock === null ? t('shop.catalog.unlimited') : String(product.stock), inline: true },
      { name: t('shop.product.category'), value: product.category ? `${product.category.emoji ?? '📂'} ${product.category.name}` : none, inline: true },
      { name: t('panels_modules.shop.field_state'), value: product.enabled ? t('panels_modules.shop.visible') : t('panels_modules.shop.hidden'), inline: true },
      { name: t('panels_modules.shop.field_tebex'), value: [product.tebexPackageId ? `\`${product.tebexPackageId}\`` : '', product.tebexUrl ? truncate(product.tebexUrl, 200) : ''].filter(Boolean).join('\n') || none, inline: true },
    );
  if (product.imageUrl) embed.setThumbnail(product.imageUrl);
  const id = product.id;
  const category = new StringSelectMenuBuilder()
    .setCustomId(shcid('cat', id))
    .setPlaceholder(truncate(t('panels_modules.shop.category_placeholder'), 150))
    .addOptions(option(t('panels_modules.shop.no_category'), 'none', { emoji: '➖', default: product.categoryId === null }), ...categories.slice(0, 24).map((c) => option(c.name, String(c.id), { emoji: c.emoji ?? '📂', description: c.description, default: c.id === product.categoryId })));
  return {
    embeds: [embed],
    components: [
      row(category),
      row(
        btn(shcid('edit', id), t('core.edit'), ButtonStyle.Secondary, '✏️'),
        btn(shcid('desc', id), t('panels_modules.shop.btn_description'), ButtonStyle.Secondary, '📝'),
        btn(shcid('tebex', id), t('panels_modules.shop.btn_tebex'), ButtonStyle.Secondary, '🔗'),
        btn(shcid('toggle', id), product.enabled ? t('panels_modules.shop.btn_hide') : t('panels_modules.shop.btn_show'), product.enabled ? ButtonStyle.Success : ButtonStyle.Secondary, product.enabled ? '🟢' : '⚪'),
        btn(shcid('del', id), t('core.delete'), ButtonStyle.Danger, '🗑️'),
      ),
      row(btn(shcid('ann', id), t('panels_modules.shop.btn_announce'), ButtonStyle.Primary, '📢', !product.enabled), btn(shcid('main', 0), t('core.back'), ButtonStyle.Secondary, '↩️')),
    ],
  };
}

export function renderDeleteConfirm(product: ProductWithCategory, t: Translator): PanelPayload {
  return {
    embeds: [embedService.warning(t('panels_modules.shop.delete_confirm', { name: product.name, id: product.id }))],
    components: [row(btn(shcid('del-ok', product.id), t('core.confirm'), ButtonStyle.Danger, '🗑️'), btn(shcid('view', product.id), t('core.cancel'), ButtonStyle.Secondary))],
  };
}

export async function renderCategories(opts: ShopRenderOptions): Promise<PanelPayload> {
  const { guild, t, notice } = opts;
  const categories = await shopService.listCategories(guild.id);
  const embed = embedService
    .brand(t('panels_modules.shop.categories_title'))
    .setDescription(withNotice(notice, t('panels_modules.shop.categories_hint')))
    .addFields({ name: t('shop.category.list_title'), value: truncate(categories.map((c) => `\`#${c.id}\` ${c.emoji ?? '📂'} **${c.name}**${c.description ? ` — ${c.description}` : ''}`).join('\n') || t('shop.category.empty'), 1024) });
  const components: Row[] = [];
  if (categories.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(shcid('cat-del')).setPlaceholder(truncate(t('panels_modules.shop.category_delete_placeholder'), 150)).addOptions(categories.slice(0, 25).map((c) => option(c.name, String(c.id), { emoji: '🗑️' })))));
  }
  components.push(row(btn(shcid('cat-new'), t('panels_modules.shop.btn_new_category'), ButtonStyle.Success, '➕'), btn(shcid('main', 0), t('core.back'), ButtonStyle.Secondary, '↩️')));
  return { embeds: [embed], components };
}

export async function renderAnnounce(opts: ShopRenderOptions): Promise<PanelPayload> {
  const { guild, t, notice, userId } = opts;
  const products = (await shopService.listProducts(guild.id, { enabledOnly: true })).slice(0, 25);
  const draft = getAnnounceDraft(guild.id, userId);
  const selected = products.find((p) => p.id === draft.productId) ?? null;
  const embed = embedService
    .brand(t('panels_modules.shop.announce_title'))
    .setDescription(withNotice(notice, t('panels_modules.shop.announce_hint')))
    .addFields(
      { name: t('shop.order.product'), value: selected ? `**${selected.name}** · ${formatPrice(selected.price, selected.currency)}` : t('core.none'), inline: true },
      { name: t('core.channel'), value: channelMention(draft.channelId, t('core.none')), inline: true },
    );
  const components: Row[] = [];
  if (products.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(shcid('ann-product')).setPlaceholder(truncate(t('panels_modules.shop.announce_product_placeholder'), 150)).addOptions(products.map((p) => option(`#${p.id} · ${p.name}`, String(p.id), { description: formatPrice(p.price, p.currency), default: p.id === selected?.id })))));
  }
  const channel = new ChannelSelectMenuBuilder().setCustomId(shcid('ann-channel')).setPlaceholder(truncate(t('panels_modules.shop.announce_channel_placeholder'), 150)).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (liveChannel(opts.guild, draft.channelId)) channel.setDefaultChannels(draft.channelId!);
  components.push(row(channel), row(btn(shcid('ann-send'), t('panels_modules.shop.btn_publish'), ButtonStyle.Success, '🚀', !selected || !draft.channelId), btn(shcid('main', 0), t('core.back'), ButtonStyle.Secondary, '↩️')));
  return { embeds: [embed], components };
}

// ───── Modals ─────

export function buildProductModal(t: Translator, product?: ProductWithCategory): ModalBuilder {
  return modal(
    product ? shcid('edit', product.id) : shcid('product-new'),
    product ? t('panels_modules.shop.modal_edit_title', { id: product.id }) : t('panels_modules.shop.modal_new_title'),
    labelled(t('panels_modules.shop.modal_name'), textInput('name', TextInputStyle.Short, { required: true, max: 100, value: product?.name })),
    labelled(t('panels_modules.shop.modal_price'), textInput('price', TextInputStyle.Short, { required: true, max: 12, value: product ? product.price.toFixed(2) : undefined, placeholder: '9.99' })),
    labelled(t('panels_modules.shop.modal_currency'), textInput('currency', TextInputStyle.Short, { max: 8, value: product?.currency ?? 'EUR' })),
    labelled(t('panels_modules.shop.modal_stock'), textInput('stock', TextInputStyle.Short, { max: 9, value: product?.stock !== null && product?.stock !== undefined ? String(product.stock) : undefined }), t('panels_modules.shop.modal_stock_help')),
    labelled(t('panels_modules.shop.modal_image'), textInput('image', TextInputStyle.Short, { max: 500, value: product?.imageUrl, placeholder: 'https://…' })),
  );
}

export function buildDescriptionModal(product: ProductWithCategory, t: Translator): ModalBuilder {
  return modal(shcid('desc', product.id), t('panels_modules.shop.modal_description_title', { id: product.id }), labelled(t('panels_modules.shop.modal_description'), textInput('description', TextInputStyle.Paragraph, { max: 1000, value: product.description })));
}

export function buildTebexModal(product: ProductWithCategory, t: Translator): ModalBuilder {
  return modal(
    shcid('tebex', product.id),
    t('panels_modules.shop.modal_tebex_title', { id: product.id }),
    labelled(t('panels_modules.shop.modal_tebex_package'), textInput('packageId', TextInputStyle.Short, { max: 64, value: product.tebexPackageId }), t('panels_modules.shop.modal_tebex_help')),
    labelled(t('panels_modules.shop.modal_tebex_url'), textInput('url', TextInputStyle.Short, { max: 500, value: product.tebexUrl, placeholder: 'https://…tebex.io/package/…' })),
  );
}

export function buildCategoryModal(t: Translator): ModalBuilder {
  return modal(
    shcid('cat-new'),
    t('panels_modules.shop.modal_category_title'),
    labelled(t('panels_modules.shop.modal_name'), textInput('name', TextInputStyle.Short, { required: true, max: 100 })),
    labelled(t('panels_modules.shop.modal_emoji'), textInput('emoji', TextInputStyle.Short, { max: 32, placeholder: '📂' })),
    labelled(t('panels_modules.shop.modal_description'), textInput('description', TextInputStyle.Short, { max: 200 })),
    labelled(t('panels_modules.shop.modal_order'), textInput('order', TextInputStyle.Short, { max: 4, placeholder: '0' })),
  );
}
