import { ChannelType, GuildMember, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { GuildKind, OrderStatus } from '@prisma/client';
import { defineCommand } from '../../structures';
import { shopService, ShopError, formatPrice, buildCatalogPage, buildProductAnnouncement, buildOrderSummary } from '../../services/ShopService';
import { embedService } from '../../services/EmbedService';
import { env } from '../../config/env';
import { hasInternalPermission } from '../../utils/permissions';
import { chunk, paginate } from '../../utils/pagination';
import { discordTimestamp } from '../../utils/time';

const STATUS_CHOICES = Object.values(OrderStatus).map((s) => ({ name: s, value: s }));
const STATUS_ICON: Record<OrderStatus, string> = { PENDING: '⏳', PAID: '💳', DELIVERED: '📦', CANCELLED: '✖️', REFUNDED: '↩️' };

/** /shop — catalogue, produits, catégories, commandes, annonces produit. */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Boutique')
    .addSubcommand((s) => s.setName('catalog').setDescription('Afficher le catalogue').addStringOption((o) => o.setName('category').setDescription('Catégorie').setAutocomplete(true)))
    .addSubcommand((s) =>
      s
        .setName('announce')
        .setDescription('[Staff] Annoncer un produit dans un salon')
        .addIntegerOption((o) => o.setName('product').setDescription('Produit').setRequired(true).setAutocomplete(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Salon').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('product')
        .setDescription('[Staff] Produits')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Ajouter un produit')
            .addStringOption((o) => o.setName('name').setDescription('Nom').setRequired(true).setMaxLength(100))
            .addStringOption((o) => o.setName('price').setDescription('Prix (ex: 9.99)').setRequired(true).setMaxLength(12))
            .addStringOption((o) => o.setName('currency').setDescription('Devise (EUR, USD…)').setMaxLength(8))
            .addStringOption((o) => o.setName('category').setDescription('Catégorie').setAutocomplete(true))
            .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(1000))
            .addStringOption((o) => o.setName('image').setDescription('URL de l’image').setMaxLength(500))
            .addIntegerOption((o) => o.setName('stock').setDescription('Stock (vide = illimité)').setMinValue(0))
            .addStringOption((o) => o.setName('tebex_package').setDescription('ID du package Tebex').setMaxLength(64))
            .addStringOption((o) => o.setName('tebex_url').setDescription('URL de la page Tebex').setMaxLength(500)),
        )
        .addSubcommand((s) =>
          s
            .setName('edit')
            .setDescription('Modifier un produit')
            .addIntegerOption((o) => o.setName('product').setDescription('Produit').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('name').setDescription('Nom').setMaxLength(100))
            .addStringOption((o) => o.setName('price').setDescription('Prix').setMaxLength(12))
            .addStringOption((o) => o.setName('currency').setDescription('Devise').setMaxLength(8))
            .addStringOption((o) => o.setName('category').setDescription('Catégorie (« none » pour retirer)').setAutocomplete(true))
            .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(1000))
            .addStringOption((o) => o.setName('image').setDescription('URL de l’image').setMaxLength(500))
            .addIntegerOption((o) => o.setName('stock').setDescription('Stock (-1 = illimité)').setMinValue(-1))
            .addStringOption((o) => o.setName('tebex_package').setDescription('ID du package Tebex').setMaxLength(64))
            .addStringOption((o) => o.setName('tebex_url').setDescription('URL Tebex').setMaxLength(500))
            .addBooleanOption((o) => o.setName('enabled').setDescription('Visible dans le catalogue ?')),
        )
        .addSubcommand((s) => s.setName('remove').setDescription('Supprimer un produit').addIntegerOption((o) => o.setName('product').setDescription('Produit').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('list').setDescription('Lister les produits (y compris masqués)')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('category')
        .setDescription('[Staff] Catégories')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Ajouter une catégorie')
            .addStringOption((o) => o.setName('name').setDescription('Nom').setRequired(true).setMaxLength(100))
            .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setMaxLength(32))
            .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(200))
            .addIntegerOption((o) => o.setName('order').setDescription('Ordre d’affichage')),
        )
        .addSubcommand((s) => s.setName('remove').setDescription('Supprimer une catégorie').addStringOption((o) => o.setName('category').setDescription('Catégorie').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('list').setDescription('Lister les catégories')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('order')
        .setDescription('Commandes')
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('[Staff] Créer une commande pour un client')
            .addUserOption((o) => o.setName('user').setDescription('Client').setRequired(true))
            .addIntegerOption((o) => o.setName('product').setDescription('Produit').setRequired(true).setAutocomplete(true))
            .addIntegerOption((o) => o.setName('quantity').setDescription('Quantité').setMinValue(1).setMaxValue(99))
            .addStringOption((o) => o.setName('note').setDescription('Note').setMaxLength(500)),
        )
        .addSubcommand((s) =>
          s
            .setName('status')
            .setDescription('[Staff] Changer le statut d’une commande')
            .addIntegerOption((o) => o.setName('id').setDescription('Numéro de commande').setRequired(true).setMinValue(1))
            .addStringOption((o) => o.setName('status').setDescription('Statut').setRequired(true).addChoices(...STATUS_CHOICES))
            .addStringOption((o) => o.setName('note').setDescription('Note').setMaxLength(500)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('[Staff] Lister les commandes').addStringOption((o) => o.setName('status').setDescription('Filtrer').addChoices(...STATUS_CHOICES)))
        .addSubcommand((s) => s.setName('history').setDescription('Historique d’un client (le vôtre par défaut)').addUserOption((o) => o.setName('user').setDescription('Client ([Staff] pour un autre membre)'))),
    ),
  module: 'shop',
  guildKinds: [GuildKind.SHOP],
  cooldown: 3,
  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    const q = String(focused.value).toLowerCase();
    if (focused.name === 'category') {
      const cats = await shopService.listCategories(interaction.guildId);
      const list = cats.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 24).map((c) => ({ name: `${c.emoji ?? ''} ${c.name}`.trim(), value: String(c.id) }));
      return interaction.respond(interaction.options.getSubcommand(false) === 'edit' ? [{ name: 'none', value: 'none' }, ...list] : list);
    }
    if (focused.name === 'product') {
      const products = await shopService.listProducts(interaction.guildId);
      return interaction.respond(products.filter((p) => p.name.toLowerCase().includes(q) || String(p.id) === q).slice(0, 25).map((p) => ({ name: `#${p.id} ${p.name} — ${formatPrice(p.price, p.currency)}${p.enabled ? '' : ' (off)'}`, value: p.id })));
    }
    return interaction.respond([]);
  },
  async execute(interaction, { t, lang, config }) {
    if (!interaction.guild || !config) return;
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const isStaff = hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: 'staff' });
    const deny = () => interaction.reply({ embeds: [embedService.error(t('core.insufficient_level', { level: 'staff' }))], ...ephemeral });
    const parseCategory = async (raw: string | null): Promise<number | null | undefined> => {
      if (raw === null) return undefined;
      if (raw === 'none') return null;
      const id = Number(raw);
      if (Number.isInteger(id)) return id;
      const cat = (await shopService.listCategories(guildId)).find((c) => c.name.toLowerCase() === raw.toLowerCase());
      return cat?.id ?? null;
    };

    try {
      // ───── Catalogue ─────
      if (!group && sub === 'catalog') {
        await interaction.deferReply();
        const categoryId = (await parseCategory(interaction.options.getString('category'))) ?? null;
        const [products, categories] = await Promise.all([shopService.listProducts(guildId, { enabledOnly: true }), shopService.listCategories(guildId)]);
        const page = buildCatalogPage({ guildId, lang, products, categories, page: 0, categoryId, color: config.brandColor });
        await interaction.editReply({ embeds: page.embeds, components: page.components });
        return;
      }
      if (!group && sub === 'announce') {
        if (!isStaff) return deny();
        const product = await shopService.getProduct(guildId, interaction.options.getInteger('product', true));
        if (!product) throw new ShopError('product_not_found');
        const channel = interaction.options.getChannel('channel', true);
        const target = await interaction.guild.channels.fetch(channel.id).catch(() => null);
        if (!target || !target.isTextBased()) return interaction.reply({ embeds: [embedService.error(t('core.channel_not_found'))], ...ephemeral });
        const msg = buildProductAnnouncement(product, config.defaultLanguage, config.brandColor);
        await target.send(msg);
        return interaction.reply({ embeds: [embedService.success(t('shop.announce.done', { product: product.name, channel: `<#${channel.id}>` }))], ...ephemeral });
      }

      // ───── Produits ─────
      if (group === 'product') {
        if (!isStaff) return deny();
        if (sub === 'add') {
          const product = await shopService.addProduct(
            guildId,
            {
              name: interaction.options.getString('name', true),
              price: interaction.options.getString('price', true),
              currency: interaction.options.getString('currency') ?? undefined,
              categoryId: (await parseCategory(interaction.options.getString('category'))) ?? null,
              description: interaction.options.getString('description'),
              imageUrl: interaction.options.getString('image'),
              stock: interaction.options.getInteger('stock'),
              tebexPackageId: interaction.options.getString('tebex_package'),
              tebexUrl: interaction.options.getString('tebex_url'),
            },
            interaction.user.id,
          );
          return interaction.reply({ embeds: [embedService.success(t('shop.product.added', { id: product.id, name: product.name, price: formatPrice(product.price, product.currency) }))], ...ephemeral });
        }
        if (sub === 'edit') {
          const id = interaction.options.getInteger('product', true);
          const stock = interaction.options.getInteger('stock');
          const categoryId = await parseCategory(interaction.options.getString('category'));
          const product = await shopService.editProduct(
            guildId,
            id,
            {
              ...(interaction.options.getString('name') !== null ? { name: interaction.options.getString('name', true) } : {}),
              ...(interaction.options.getString('price') !== null ? { price: interaction.options.getString('price', true) } : {}),
              ...(interaction.options.getString('currency') !== null ? { currency: interaction.options.getString('currency', true) } : {}),
              ...(categoryId !== undefined ? { categoryId } : {}),
              ...(interaction.options.getString('description') !== null ? { description: interaction.options.getString('description') } : {}),
              ...(interaction.options.getString('image') !== null ? { imageUrl: interaction.options.getString('image') } : {}),
              ...(stock !== null ? { stock: stock < 0 ? null : stock } : {}),
              ...(interaction.options.getString('tebex_package') !== null ? { tebexPackageId: interaction.options.getString('tebex_package') } : {}),
              ...(interaction.options.getString('tebex_url') !== null ? { tebexUrl: interaction.options.getString('tebex_url') } : {}),
              ...(interaction.options.getBoolean('enabled') !== null ? { enabled: interaction.options.getBoolean('enabled', true) } : {}),
            },
            interaction.user.id,
          );
          return interaction.reply({ embeds: [embedService.success(t('shop.product.edited', { id: product.id, name: product.name }))], ...ephemeral });
        }
        if (sub === 'remove') {
          const product = await shopService.removeProduct(guildId, interaction.options.getInteger('product', true), interaction.user.id);
          return interaction.reply({ embeds: [embedService.success(t('shop.product.removed', { name: product.name }))], ...ephemeral });
        }
        if (sub === 'list') {
          const products = await shopService.listProducts(guildId);
          if (!products.length) return interaction.reply({ embeds: [embedService.info(t('shop.catalog.empty'))], ...ephemeral });
          const pages = chunk(products, 15).map((grp, i, all) =>
            embedService
              .brand(t('shop.product.list_title', { count: products.length }), grp.map((p) => `${p.enabled ? '🟢' : '⚪'} \`#${p.id}\` **${p.name}** · ${formatPrice(p.price, p.currency)} · ${p.stock === null ? '∞' : p.stock}${p.category ? ` · ${p.category.emoji ?? ''} ${p.category.name}` : ''}${p.tebexPackageId ? ` · Tebex ${p.tebexPackageId}` : ''}`).join('\n'))
              .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
          );
          return paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
        }
      }

      // ───── Catégories ─────
      if (group === 'category') {
        if (!isStaff) return deny();
        if (sub === 'add') {
          const cat = await shopService.addCategory(guildId, { name: interaction.options.getString('name', true), emoji: interaction.options.getString('emoji'), description: interaction.options.getString('description'), order: interaction.options.getInteger('order') ?? 0 });
          return interaction.reply({ embeds: [embedService.success(t('shop.category.added', { name: cat.name }))], ...ephemeral });
        }
        if (sub === 'remove') {
          const id = await parseCategory(interaction.options.getString('category', true));
          if (!id) throw new ShopError('category_not_found');
          const cat = await shopService.removeCategory(guildId, id);
          return interaction.reply({ embeds: [embedService.success(t('shop.category.removed', { name: cat.name }))], ...ephemeral });
        }
        if (sub === 'list') {
          const cats = await shopService.listCategories(guildId);
          if (!cats.length) return interaction.reply({ embeds: [embedService.info(t('shop.category.empty'))], ...ephemeral });
          return interaction.reply({ embeds: [embedService.brand(t('shop.category.list_title'), cats.map((c) => `\`#${c.id}\` ${c.emoji ?? '📦'} **${c.name}**${c.description ? ` — ${c.description}` : ''}`).join('\n'))], ...ephemeral });
        }
      }

      // ───── Commandes ─────
      if (group === 'order') {
        if (sub === 'create') {
          if (!isStaff) return deny();
          const user = interaction.options.getUser('user', true);
          await interaction.deferReply(ephemeral);
          const order = await shopService.createOrder({ guildId, userId: user.id, productId: interaction.options.getInteger('product', true), quantity: interaction.options.getInteger('quantity') ?? 1, note: interaction.options.getString('note'), actorId: interaction.user.id });
          const summary = buildOrderSummary(order, config.defaultLanguage, config.brandColor);
          await user.send(summary).catch(() => null);
          await interaction.editReply({ embeds: [embedService.success(t('shop.order.created', { id: order.id, user: `<@${user.id}>`, total: formatPrice(order.total, order.currency) })), ...summary.embeds], components: summary.components });
          return;
        }
        if (sub === 'status') {
          if (!isStaff) return deny();
          const order = await shopService.updateOrderStatus(guildId, interaction.options.getInteger('id', true), interaction.options.getString('status', true) as OrderStatus, interaction.user.id, interaction.options.getString('note') ?? undefined);
          const customer = await interaction.client.users.fetch(order.userId).catch(() => null);
          await customer?.send({ embeds: [embedService.brand(t('shop.order.status_dm_title', { id: order.id }), t('shop.order.status_dm', { status: t(`shop.status.${order.status.toLowerCase()}`), product: order.product?.name ?? '—' }))] }).catch(() => null);
          return interaction.reply({ embeds: [embedService.success(t('shop.order.status_updated', { id: order.id, status: t(`shop.status.${order.status.toLowerCase()}`) }))], ...ephemeral });
        }
        if (sub === 'list') {
          if (!isStaff) return deny();
          const status = interaction.options.getString('status') as OrderStatus | null;
          const orders = await shopService.listOrders(guildId, status ?? undefined, 200);
          if (!orders.length) return interaction.reply({ embeds: [embedService.info(t('shop.order.empty'))], ...ephemeral });
          const pages = chunk(orders, 10).map((grp, i, all) =>
            embedService
              .brand(t('shop.order.list_title', { status: status ? t(`shop.status.${status.toLowerCase()}`) : t('shop.order.all') }), grp.map((o) => `${STATUS_ICON[o.status]} **#${o.id}** <@${o.userId}> · ${o.product?.name ?? '—'} ×${o.quantity} · ${formatPrice(o.total, o.currency)} · ${discordTimestamp(o.createdAt, 'R')}${o.ticketId ? ` · 🎫 #${o.ticketId}` : ''}`).join('\n'))
              .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
          );
          return paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
        }
        if (sub === 'history') {
          const user = interaction.options.getUser('user') ?? interaction.user;
          if (user.id !== interaction.user.id && !isStaff) return deny();
          const orders = await shopService.history(guildId, user.id);
          if (!orders.length) return interaction.reply({ embeds: [embedService.info(t('shop.order.history_empty', { user: `<@${user.id}>` }))], ...ephemeral });
          const pages = chunk(orders, 10).map((grp, i, all) =>
            embedService
              .brand(t('shop.order.history_title', { user: user.displayName }), grp.map((o) => `${STATUS_ICON[o.status]} **#${o.id}** ${o.product?.name ?? '—'} ×${o.quantity} · ${formatPrice(o.total, o.currency)} · ${t(`shop.status.${o.status.toLowerCase()}`)} · ${discordTimestamp(o.createdAt, 'R')}`).join('\n'))
              .setFooter({ text: t('core.page', { current: i + 1, total: all.length }) }),
          );
          return paginate(interaction, { pages, userId: interaction.user.id, ephemeral: true });
        }
      }
    } catch (err) {
      if (err instanceof ShopError) {
        const embeds = [embedService.error(t(`shop.errors.${err.code}`))];
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
        else await interaction.reply({ embeds, ...ephemeral });
        return;
      }
      throw err;
    }
  },
});
