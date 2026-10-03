import type { RequestHandler } from 'express';
import type { RedemptionClient } from '../../src/core/Client';
import { env } from '../../src/config/env';
import { BRAND, LANGUAGES, MODULE_LABELS, GUILD_KIND_LABELS, LOG_CATEGORY_LABELS } from '../../src/config/constants';
import { NAVIGATION, NAV_GROUP_LABELS, navHref } from '../lib/navigation';
import { fmt, avatarUrl, guildIconUrl } from '../lib/format';
import { takeFlash } from '../lib/flash';
import { manageableGuilds } from '../lib/access';
import { botGuildIds } from '../lib/guildData';
import { buildBotInviteUrl } from '../auth/oauth';

/**
 * Variables disponibles dans toutes les vues :
 * user, isOwner, brand, nav, navGroups, navHref, fmt, avatarUrl, guildIconUrl, flash, csrfToken,
 * switcherGuilds (serveurs gérables où le bot est présent), constants (langues, modules, types…).
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
    Object.assign(res.locals, {
      user,
      isOwner,
      brand: { name: BRAND.name, footer: BRAND.footer, primary: fmt.hex(BRAND.colors.primary) },
      nav: NAVIGATION,
      navGroups: NAV_GROUP_LABELS,
      navHref,
      fmt,
      avatarUrl,
      guildIconUrl,
      flash: takeFlash(req),
      switcherGuilds,
      botReady: client.isReady(),
      botUser: client.isReady() ? { id: client.user.id, username: client.user.username, avatarUrl: client.user.displayAvatarURL({ size: 64 }) } : null,
      inviteUrl: buildBotInviteUrl(cfg.CLIENT_ID),
      oauthConfigured: Boolean(cfg.DISCORD_CLIENT_SECRET),
      currentPath: req.path,
      constants: { LANGUAGES, MODULE_LABELS, GUILD_KIND_LABELS, LOG_CATEGORY_LABELS },
      guild: res.locals.guild ?? null,
      config: res.locals.config ?? null,
      page: res.locals.page ?? null,
    });
    next();
  };
}
