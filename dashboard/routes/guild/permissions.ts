import { Router } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import { commandPermissionService, LOCKED_COMMANDS, type CommandRule } from '../../../src/services/CommandPermissionService';
import { invalidateCommandPermissions } from '../../../src/events/interactionCreate';
import { loggingService } from '../../../src/services/LoggingService';
import { MODULE_LABELS, type ModuleKey } from '../../../src/config/constants';
import { MODULE_INFO } from '../../lib/modules';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdArray, checkbox } from '../../lib/validate';
import { formAction } from '../../lib/serviceErrors';

/** Catégories de commandes (dossiers de src/commands) → libellé et icône de l'écran Permissions. */
export const COMMAND_CATEGORIES: Record<string, { label: string; icon: string }> = {
  admin: { label: 'Administration', icon: 'wrench' },
  moderation: { label: 'Modération', icon: 'shield' },
  tickets: { label: 'Tickets', icon: 'ticket' },
  roles: { label: 'Rôles', icon: 'tags' },
  announcements: { label: 'Annonces', icon: 'megaphone' },
  embeds: { label: 'Embeds', icon: 'layout-template' },
  events: { label: 'Événements', icon: 'calendar' },
  whitelist: { label: 'Whitelist', icon: 'clipboard-check' },
  'battle-royale': { label: 'Battle Royale', icon: 'swords' },
  school: { label: 'School RP', icon: 'graduation-cap' },
  shop: { label: 'Boutique', icon: 'shopping-bag' },
  misc: { label: 'Autres', icon: 'layers' },
};

export const LEVEL_LABELS: Record<string, { label: string; icon: string; hint: string }> = {
  everyone: { label: 'Tout le monde', icon: 'users', hint: 'Utilisable par tous les membres.' },
  staff: { label: 'Staff', icon: 'user-check', hint: 'Réservée aux rôles staff et administrateurs.' },
  admin: { label: 'Administrateurs', icon: 'shield', hint: 'Réservée aux rôles administrateurs.' },
  owner: { label: 'Propriétaire du bot', icon: 'crown', hint: 'Réservée aux propriétaires du bot.' },
};

const commandParams = z.object({ command: z.string().regex(/^[\w-]{1,64}$/, 'nom de commande invalide') });
const categoryParams = z.object({ category: z.string().regex(/^[\w-]{1,64}$/, 'catégorie invalide') });
const setBody = z.object({ roleIds: discordIdArray, enabled: checkbox });
const bulkBody = z.object({ roleIds: discordIdArray, mode: z.enum(['replace', 'add']).default('replace') });

export interface PermissionCommandView {
  name: string;
  description: string;
  category: string;
  level: string;
  locked: boolean;
  moduleLabel: string | null;
  moduleOff: boolean;
  rule: CommandRule | null;
  state: 'default' | 'roles' | 'disabled' | 'locked';
}

/** Page « Permissions des commandes » : rôles autorisés, activation et retour au défaut, par commande ou par catégorie. */
export function createPermissionsRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/permissions`;

  function commandNames(): Set<string> {
    return new Set([...client.commands.values()].map((c) => c.data.name));
  }
  function catalog() {
    return commandPermissionService.catalog(client.commands.values());
  }
  /** Rôles du formulaire limités aux rôles existants du serveur (hors rôles gérés par une intégration). */
  function checkRoles(guildRoles: { id: string; managed: boolean }[], ids: string[]): string[] {
    const known = new Set(guildRoles.filter((r) => !r.managed).map((r) => r.id));
    const unique = [...new Set(ids)];
    const unknown = unique.filter((id) => !known.has(id));
    if (unknown.length) throw new HttpError(400, 'Rôle inconnu ou géré par une intégration : actualisez la page et choisissez un rôle du serveur.');
    if (unique.length > 25) throw new HttpError(400, '25 rôles au maximum par commande.');
    return unique;
  }
  function audit(guildId: string, actorId: string | null, title: string, data: Record<string, unknown>): void {
    void loggingService.log({ guildId, category: 'SYSTEM', action: 'commands.permissions', title, actorId, data: { ...data, source: 'dashboard' } });
  }

  router.get(
    '/permissions',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const rules = await commandPermissionService.rules(guild.id);
      const modules = new Map([...client.commands.values()].map((c) => [c.data.name, c.module ?? null]));
      const commands: PermissionCommandView[] = catalog().map((c) => {
        const rule = c.locked ? null : rules.get(c.name) ?? null;
        const mod = (modules.get(c.name) ?? null) as ModuleKey | null;
        return {
          name: c.name,
          description: c.description,
          category: c.category,
          level: c.defaultLevel,
          locked: c.locked,
          moduleLabel: mod ? MODULE_INFO[mod]?.label ?? MODULE_LABELS[mod] : null,
          moduleOff: Boolean(mod && !config.modules[mod]),
          rule,
          state: c.locked ? 'locked' : !rule ? 'default' : !rule.enabled ? 'disabled' : rule.roleIds.length ? 'roles' : 'default',
        };
      });
      const order = Object.keys(COMMAND_CATEGORIES);
      const keys = [...new Set(commands.map((c) => c.category))].sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b));
      const categories = keys.map((key) => {
        const list = commands.filter((c) => c.category === key);
        return {
          key,
          label: COMMAND_CATEGORIES[key]?.label ?? key.charAt(0).toUpperCase() + key.slice(1),
          icon: COMMAND_CATEGORIES[key]?.icon ?? 'layers',
          commands: list,
          editable: list.filter((c) => !c.locked).length,
          custom: list.filter((c) => c.state === 'roles' || c.state === 'disabled').length,
        };
      });
      render(res, 'permissions', {
        title: 'Permissions des commandes',
        page: 'permissions',
        categories,
        levels: LEVEL_LABELS,
        lockedCommands: LOCKED_COMMANDS,
        summary: {
          total: commands.length,
          custom: commands.filter((c) => c.state === 'roles').length,
          disabled: commands.filter((c) => c.state === 'disabled').length,
        },
      });
    }),
  );

  router.post(
    '/permissions/command/:command',
    validate({ params: commandParams, body: setBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}#cmd-${encodeURIComponent(String(req.params.command ?? ''))}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof setBody>, unknown, z.infer<typeof commandParams>>(req);
        if (!commandNames().has(params.command)) throw new HttpError(404, `Commande /${params.command} introuvable.`);
        if (LOCKED_COMMANDS.includes(params.command)) throw new HttpError(400, `/${params.command} reste toujours accessible : elle ne peut pas être restreinte.`);
        const roleIds = checkRoles(guild.roles, body.roleIds);
        await commandPermissionService.set(guild.id, params.command, { roleIds, enabled: body.enabled });
        invalidateCommandPermissions(guild.id);
        audit(guild.id, req.session.user?.id ?? null, `Permissions de /${params.command} mises à jour`, { command: params.command, roleIds, enabled: body.enabled });
        flash(req, 'success', !body.enabled ? `/${params.command} désactivée.` : roleIds.length ? `/${params.command} : ${roleIds.length} rôle(s) autorisé(s). Enregistré.` : `/${params.command} : réglage par défaut. Enregistré.`);
        return `${base(guild.id)}#cmd-${params.command}`;
      },
    ),
  );

  router.post(
    '/permissions/command/:command/reset',
    validate({ params: commandParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}#cmd-${encodeURIComponent(String(req.params.command ?? ''))}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof commandParams>>(req);
        if (!commandNames().has(params.command)) throw new HttpError(404, `Commande /${params.command} introuvable.`);
        await commandPermissionService.reset(guild.id, params.command);
        invalidateCommandPermissions(guild.id);
        audit(guild.id, req.session.user?.id ?? null, `Permissions de /${params.command} remises par défaut`, { command: params.command, reset: true });
        flash(req, 'success', `/${params.command} est revenue à son réglage par défaut.`);
        return `${base(guild.id)}#cmd-${params.command}`;
      },
    ),
  );

  router.post(
    '/permissions/category/:category',
    validate({ params: categoryParams, body: bulkBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}#cat-${encodeURIComponent(String(req.params.category ?? ''))}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof bulkBody>, unknown, z.infer<typeof categoryParams>>(req);
        const names = catalog().filter((c) => c.category === params.category && !c.locked).map((c) => c.name);
        if (!names.length) throw new HttpError(404, 'Aucune commande modifiable dans cette catégorie.');
        const roleIds = checkRoles(guild.roles, body.roleIds);
        if (!roleIds.length) throw new HttpError(400, 'Choisissez au moins un rôle à appliquer.');
        if (body.mode === 'replace') {
          await commandPermissionService.set(guild.id, names, { roleIds });
        } else {
          const rules = await commandPermissionService.rules(guild.id);
          for (const name of names) {
            const merged = [...new Set([...(rules.get(name)?.roleIds ?? []), ...roleIds])].slice(0, 25);
            await commandPermissionService.set(guild.id, name, { roleIds: merged });
          }
        }
        invalidateCommandPermissions(guild.id);
        const label = COMMAND_CATEGORIES[params.category]?.label ?? params.category;
        audit(guild.id, req.session.user?.id ?? null, `Rôles appliqués à la catégorie ${label}`, { category: params.category, roleIds, mode: body.mode, commands: names.length });
        flash(req, 'success', `${label} : ${roleIds.length} rôle(s) ${body.mode === 'add' ? 'ajouté(s) à' : 'appliqué(s) à'} ${names.length} commande(s).`);
        return `${base(guild.id)}#cat-${params.category}`;
      },
    ),
  );

  router.post(
    '/permissions/category/:category/reset',
    validate({ params: categoryParams }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}#cat-${encodeURIComponent(String(req.params.category ?? ''))}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof categoryParams>>(req);
        const names = catalog().filter((c) => c.category === params.category && !c.locked).map((c) => c.name);
        if (!names.length) throw new HttpError(404, 'Aucune commande modifiable dans cette catégorie.');
        const count = await commandPermissionService.reset(guild.id, names);
        invalidateCommandPermissions(guild.id);
        const label = COMMAND_CATEGORIES[params.category]?.label ?? params.category;
        audit(guild.id, req.session.user?.id ?? null, `Catégorie ${label} remise par défaut`, { category: params.category, reset: count });
        flash(req, 'success', count ? `${label} : ${count} commande(s) remise(s) par défaut.` : `${label} : tout était déjà par défaut.`);
        return `${base(guild.id)}#cat-${params.category}`;
      },
    ),
  );

  router.post(
    '/permissions/reset',
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const count = await commandPermissionService.reset(guild.id);
        invalidateCommandPermissions(guild.id);
        audit(guild.id, req.session.user?.id ?? null, 'Permissions des commandes remises par défaut', { reset: count });
        flash(req, 'success', count ? `${count} réglage(s) supprimé(s) : toutes les commandes suivent leur réglage par défaut.` : 'Toutes les commandes suivaient déjà leur réglage par défaut.');
      },
    ),
  );

  return router;
}
