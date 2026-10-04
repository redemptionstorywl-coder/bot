import { Router } from 'express';
import { z } from 'zod';
import { AutoRoleType, PanelStyle } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { roleService, roleMenuOptionSchema, parseRoleMenuOptions, MAX_AUTOROLE_DELAY_SECONDS, ACTIVE_AUTOROLE_TYPES, DEFAULT_NOTIFICATIONS } from '../../../src/services/RoleService';
import { translationService } from '../../../src/services/TranslationService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema, optionalText, checkbox } from '../../lib/validate';
import { embedFormSchema, toEmbedSpec, jsonArray, safeEmbedSpec } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { requireBotGuild } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const TABS = ['autoroles', 'menus', 'notifications'] as const;
const tabQuery = z.object({ tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'autoroles'), z.enum(TABS)) });
const menuParams = z.object({ menuId: z.coerce.number().int().positive() });
const keyParams = z.object({ key: z.string().regex(/^[a-z0-9_-]{1,64}$/) });

export const AUTOROLE_TYPE_LABELS: Record<AutoRoleType, string> = {
  JOIN: "À l'arrivée",
  BOT: 'Bots',
  VERIFIED: 'Après vérification',
  MEMBER: 'Membre (obsolète)',
  LANGUAGE: 'Langue (obsolète)',
  SPECIAL: 'Spécial (manuel)',
};

const autoroleBody = z.object({
  roleId: discordIdSchema,
  type: z.enum(ACTIVE_AUTOROLE_TYPES),
  delayMinutes: z.coerce.number().int().min(0).max(MAX_AUTOROLE_DELAY_SECONDS / 60).default(0),
});
const autoroleDeleteBody = z.object({ roleId: discordIdSchema, type: z.nativeEnum(AutoRoleType) });

/** Option de role menu saisie dans l'éditeur : les valeurs vides sont retirées. */
const optionInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = { roleId: o.roleId };
  for (const k of ['label', 'emoji', 'description', 'style'] as const) if (typeof o[k] === 'string' && (o[k] as string).trim()) out[k] = (o[k] as string).trim();
  return out;
}, roleMenuOptionSchema);

const menuBody = z.object({
  name: z.string().trim().min(1, 'nom requis').max(100),
  style: z.nativeEnum(PanelStyle),
  exclusive: checkbox,
  placeholder: optionalText(150),
  minValues: z.coerce.number().int().min(0).max(25).default(0),
  maxValues: z.coerce.number().int().min(1).max(25).default(25),
  embed: embedFormSchema,
  optionsJson: jsonArray(optionInput, 25),
});
const publishBody = z.object({ channelId: discordIdSchema });

const notificationBody = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,64}$/, 'clé : lettres minuscules, chiffres, tirets'),
  roleId: discordIdSchema,
  label: z.string().trim().min(1, 'libellé requis').max(100),
  emoji: optionalText(64),
  description: optionalText(100),
  order: z.coerce.number().int().min(0).max(1000).default(0),
  enabled: checkbox,
});
const notifPublishBody = z.object({ channelId: discordIdSchema, style: z.nativeEnum(PanelStyle).default(PanelStyle.SELECT) });

/** Pages Rôles : auto-roles, role menus (éditeur + publication), rôles de notification. */
export function createRolesRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/roles`;

  async function loadMenu(guildId: string, id: number) {
    const menu = await roleService.getRoleMenu(id);
    if (!menu || menu.guildId !== guildId) throw new HttpError(404, 'Role menu introuvable.');
    return menu;
  }

  router.get(
    '/roles',
    validate({ query: tabQuery }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof tabQuery>>(req);
      const [autoroles, menus, notifications, reactions] = await Promise.all([roleService.listAutoRoles(guild.id), roleService.listRoleMenus(guild.id), roleService.listNotificationRoles(guild.id), roleService.listReactionRoles(guild.id)]);
      const t = translationService.bind(config.defaultLanguage, guild.id);
      render(res, 'roles', {
        title: 'Rôles',
        page: 'roles',
        tab: query.tab,
        crumbs: query.tab === 'autoroles' ? [] : [{ label: query.tab === 'menus' ? 'Menus de rôles' : 'Notifications' }],
        counts: { autoroles: autoroles.length, menus: menus.length, notifications: notifications.length, reactions: reactions.length },
        placeholderDefault: t('roles.rolemenu.default_placeholder'),
        autoroles,
        autoroleTypes: Object.values(AutoRoleType).map((t) => ({ value: t, label: AUTOROLE_TYPE_LABELS[t], active: (ACTIVE_AUTOROLE_TYPES as readonly string[]).includes(t) })),
        menus: menus.map((m) => ({ ...m, optionList: parseRoleMenuOptions(m.options) })),
        notifications,
        defaultNotifications: DEFAULT_NOTIFICATIONS,
        roleName: (id: string | null) => guild.roles.find((r) => r.id === id)?.name ?? id ?? '—',
        channelName: (id: string | null) => guild.textChannels.find((c) => c.id === id)?.name ?? id ?? '—',
        modules: { autorole: config.modules.autorole, rolemenu: config.modules.rolemenu, notifications: config.modules.notifications },
      });
    }),
  );

  // ───── Auto-roles ─────

  router.post(
    '/roles/autoroles',
    validate({ body: autoroleBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=autoroles`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof autoroleBody>>(req);
        const role = guild.roles.find((r) => r.id === body.roleId);
        if (!role) throw new HttpError(400, 'Rôle inconnu.');
        if (role.managed) throw new HttpError(400, 'Ce rôle est géré par une intégration et ne peut pas être attribué.');
        await roleService.addAutoRole(guild.id, body.roleId, body.type, body.delayMinutes * 60);
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'autorole' });
        flash(req, 'success', `Auto-role « ${role.name} » (${AUTOROLE_TYPE_LABELS[body.type]}) enregistré.`);
      },
    ),
  );

  router.post(
    '/roles/autoroles/delete',
    validate({ body: autoroleDeleteBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=autoroles`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof autoroleDeleteBody>>(req);
        const count = await roleService.removeAutoRole(guild.id, body.roleId, body.type);
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'autorole' });
        flash(req, count ? 'success' : 'info', count ? 'Auto-role retiré.' : 'Aucun auto-role correspondant.');
      },
    ),
  );

  // ───── Role menus ─────

  router.get(
    '/roles/menus/new',
    wrap(async (_req, res) => {
      render(res, 'role-menu', { title: 'Nouveau menu de rôles', page: 'roles', layout: 'wide', crumbs: [{ label: 'Menus de rôles', href: `${base(res.locals.guild!.id)}?tab=menus` }, { label: 'Nouveau menu' }], menu: null, spec: {}, options: [], placeholderDefault: translationService.translate(res.locals.config!.defaultLanguage, 'roles.rolemenu.default_placeholder'), scripts: ['roles'] });
    }),
  );

  router.get(
    '/roles/menus/:menuId(\\d+)',
    validate({ params: menuParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof menuParams>>(req);
      const menu = await loadMenu(guild.id, params.menuId);
      render(res, 'role-menu', { title: `Menu · ${menu.name}`, page: 'roles', layout: 'wide', crumbs: [{ label: 'Menus de rôles', href: `${base(res.locals.guild!.id)}?tab=menus` }, { label: menu.name }], menu, spec: safeEmbedSpec(menu.embed), options: parseRoleMenuOptions(menu.options), placeholderDefault: translationService.translate(res.locals.config!.defaultLanguage, 'roles.rolemenu.default_placeholder'), scripts: ['roles'] });
    }),
  );

  function menuInput(body: z.infer<typeof menuBody>, guildRoles: { id: string; managed: boolean }[]) {
    const options = body.optionsJson.filter((o) => guildRoles.some((r) => r.id === o.roleId));
    if (options.some((o) => guildRoles.find((r) => r.id === o.roleId)?.managed)) throw new HttpError(400, 'Un rôle géré par une intégration ne peut pas figurer dans un role menu.');
    const seen = new Set<string>();
    const unique = options.filter((o) => (seen.has(o.roleId) ? false : (seen.add(o.roleId), true)));
    const spec = toEmbedSpec(body.embed) ?? { title: body.name };
    return { name: body.name, embed: spec, style: body.style, options: unique, exclusive: body.exclusive, placeholder: body.placeholder ?? null, minValues: Math.min(body.minValues, body.maxValues), maxValues: body.maxValues };
  }

  router.post(
    '/roles/menus',
    validate({ body: menuBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/menus/new`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof menuBody>>(req);
        const menu = await roleService.createRoleMenu(guild.id, menuInput(body, guild.roles));
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'menu', menuId: menu.id });
        flash(req, 'success', `Role menu « ${menu.name} » créé. Publiez-le dans un salon.`);
        return `${base(guild.id)}/menus/${menu.id}`;
      },
    ),
  );

  router.post(
    '/roles/menus/:menuId(\\d+)',
    validate({ params: menuParams, body: menuBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/menus/${req.params.menuId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof menuBody>, unknown, z.infer<typeof menuParams>>(req);
        const existing = await loadMenu(guild.id, params.menuId);
        const menu = await roleService.updateRoleMenu(existing.id, menuInput(body, guild.roles));
        let refreshed = false;
        if (menu.messageId && client.isReady()) refreshed = await roleService.refreshRoleMenu(menu.id).catch(() => false);
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'menu', menuId: menu.id });
        flash(req, 'success', refreshed ? 'Role menu enregistré et message Discord mis à jour.' : 'Role menu enregistré.');
      },
    ),
  );

  router.post(
    '/roles/menus/:menuId(\\d+)/publish',
    validate({ params: menuParams, body: publishBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/menus/${req.params.menuId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof publishBody>, unknown, z.infer<typeof menuParams>>(req);
        const menu = await loadMenu(guild.id, params.menuId);
        requireBotGuild(client, guild.id);
        if (!guild.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        if (!parseRoleMenuOptions(menu.options).length) throw new HttpError(400, 'Ajoutez au moins un rôle au menu avant de le publier.');
        await roleService.publishRoleMenu(menu.id, body.channelId);
        flash(req, 'success', `Role menu publié dans #${guild.textChannels.find((c) => c.id === body.channelId)?.name}.`);
      },
    ),
  );

  router.post(
    '/roles/menus/:menuId(\\d+)/refresh',
    validate({ params: menuParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/menus/${req.params.menuId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof menuParams>>(req);
        const menu = await loadMenu(guild.id, params.menuId);
        requireBotGuild(client, guild.id);
        const ok = await roleService.refreshRoleMenu(menu.id);
        flash(req, ok ? 'success' : 'warning', ok ? 'Message du role menu mis à jour.' : 'Le menu n’est pas publié (ou son message a été supprimé) : publiez-le.');
      },
    ),
  );

  router.post(
    '/roles/menus/:menuId(\\d+)/delete',
    validate({ params: menuParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=menus`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof menuParams>>(req);
        const menu = await loadMenu(guild.id, params.menuId);
        await roleService.deleteRoleMenu(menu.id, true);
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'menu', menuId: menu.id, deleted: true });
        flash(req, 'success', `Role menu « ${menu.name} » supprimé.`);
      },
    ),
  );

  // ───── Notifications ─────

  router.post(
    '/roles/notifications',
    validate({ body: notificationBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=notifications`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof notificationBody>>(req);
        if (!guild.roles.some((r) => r.id === body.roleId)) throw new HttpError(400, 'Rôle inconnu.');
        const row = await roleService.upsertNotificationRole(guild.id, { key: body.key, roleId: body.roleId, label: body.label, emoji: body.emoji ?? null, description: body.description ?? null, order: body.order, enabled: body.enabled });
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'notification' });
        flash(req, 'success', `Notification « ${row.label} » enregistrée.`);
      },
    ),
  );

  router.post(
    '/roles/notifications/setup',
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=notifications`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const guild = requireBotGuild(client, guildView.id);
        const result = await roleService.setupDefaults(guild);
        broadcastToGuild(guildView.id, 'roles:update', { guildId: guildView.id, kind: 'notification' });
        flash(req, 'success', `Notifications par défaut : ${result.created.length} rôle(s) créé(s), ${result.linked.length} rôle(s) existant(s) relié(s).`);
      },
    ),
  );

  router.post(
    '/roles/notifications/publish',
    validate({ body: notifPublishBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=notifications`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof notifPublishBody>>(req);
        requireBotGuild(client, guild.id);
        if (!guild.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        await roleService.publishNotificationPanel(guild.id, body.channelId, body.style);
        flash(req, 'success', `Panneau de notifications publié dans #${guild.textChannels.find((c) => c.id === body.channelId)?.name}.`);
      },
    ),
  );

  router.post(
    '/roles/notifications/:key/delete',
    validate({ params: keyParams }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=notifications`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof keyParams>>(req);
        const count = await roleService.removeNotificationRole(guild.id, params.key);
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'notification' });
        flash(req, count ? 'success' : 'info', count ? 'Notification retirée (le rôle Discord est conservé).' : 'Notification introuvable.');
      },
    ),
  );

  return router;
}
