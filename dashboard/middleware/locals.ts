import type { RequestHandler } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { env } from '../../src/config/env';
import { BRAND, LANGUAGES, MODULE_LABELS, GUILD_KIND_LABELS, LOG_CATEGORY_LABELS, TEMPLATE_VARIABLES, EMBED_COLOR_PALETTE } from '../../src/config/constants';
import { buildSidebar, buildBreadcrumbs } from '../lib/navigation';
import { MODULE_INFO } from '../lib/modules';
import { fmt, avatarUrl, guildIconUrl } from '../lib/format';
import { icon } from '../lib/icons';
import { discordPreview, type PreviewContext } from '../lib/discordPreview';
import { takeFlash } from '../lib/flash';
import { manageableGuilds } from '../lib/access';
import { botGuildIds, type GuildView } from '../lib/guildData';
import { buildBotInviteUrl } from '../auth/oauth';

/** Sérialise une valeur pour un `<script type="application/json">` (aucune fermeture de balise possible). */
export function jsonScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Variables disponibles dans toutes les vues :
 * user, isOwner, brand, fmt, icon(name, opts), avatarUrl, guildIconUrl, flash, csrfToken, switcherGuilds, botReady, botUser,
 * buildSidebar / buildBreadcrumbs (layout), discordPreview + previewContext() (aperçus Discord), jsonScript(value),
 * constants (MODULE_LABELS, MODULE_INFO, GUILD_KIND_LABELS, LOG_CATEGORY_LABELS, TEMPLATE_VARIABLES, EMBED_COLOR_PALETTE, LANGUAGES).
 */
export function viewLocals(client: RedemptionClient): RequestHandler {
  return (req, res, next) => {
    const cfg = env();
    const user = req.session?.user ?? null;
    const isOwner = Boolean(user && cfg.OWNER_IDS.includes(user.id));
    const present = botGuildIds(client);
    const switcherGuilds = user
      ? manageableGuilds(req.session.guilds, user.id, cfg.OWNER_IDS)
          .filter((g) => present.has(g.id))
          .map((g) => ({ id: g.id, name: g.name, iconUrl: guildIconUrl(g.id, g.icon, 64) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    const botUser = client.isReady() ? { id: client.user.id, username: client.user.username, avatarUrl: client.user.displayAvatarURL({ size: 64 }) } : null;
    let previewCache: PreviewContext | null = null;
    Object.assign(res.locals, {
      user,
      userAvatarUrl: user ? avatarUrl(user.id, user.avatar, 64) : null,
      isOwner,
      brand: { name: BRAND.name, footer: BRAND.footer, primary: fmt.hex(BRAND.colors.primary) },
      buildSidebar,
      buildBreadcrumbs,
      fmt,
      icon,
      avatarUrl,
      guildIconUrl,
      discordPreview,
      jsonScript,
      /** Contexte des aperçus Discord (rôles, salons, bot, couleur de marque) du serveur courant — calculé à la demande. */
      previewContext(): PreviewContext {
        if (previewCache) return previewCache;
        const guild = (res.locals.guild ?? null) as GuildView | null;
        const config = res.locals.config ?? null;
        previewCache = discordPreview.contextFromGuild(guild, botUser, {
          defaultColor: config ? fmt.hex(config.brandColor) : fmt.hex(BRAND.colors.primary),
          users: user ? { [user.id]: user.globalName || user.username } : {},
        });
        return previewCache;
      },
      flash: takeFlash(req),
      switcherGuilds,
      botReady: client.isReady(),
      botUser,
      inviteUrl: buildBotInviteUrl(cfg.CLIENT_ID),
      oauthConfigured: Boolean(cfg.DISCORD_CLIENT_SECRET),
      currentPath: req.path,
      constants: { LANGUAGES, MODULE_LABELS, MODULE_INFO, GUILD_KIND_LABELS, LOG_CATEGORY_LABELS, TEMPLATE_VARIABLES, EMBED_COLOR_PALETTE },
      guild: res.locals.guild ?? null,
      config: res.locals.config ?? null,
      page: res.locals.page ?? null,
      crumbs: [],
      scripts: [],
    });
    next();
  };
}
