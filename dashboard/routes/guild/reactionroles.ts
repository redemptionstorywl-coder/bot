import { Router } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import { roleService, parseEmojiInput } from '../../../src/services/RoleService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, discordIdSchema } from '../../lib/validate';
import { formAction } from '../../lib/serviceErrors';
import { requireBotGuild } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const idParams = z.object({ reactionId: z.coerce.number().int().positive() });

const addBody = z.object({
  channelId: discordIdSchema,
  /** ID de message ou lien `https://discord.com/channels/g/c/m` */
  messageId: z
    .string()
    .trim()
    .transform((v) => v.match(/(\d{15,22})\/?$/)?.[1] ?? v)
    .pipe(discordIdSchema),
  emoji: z.string().trim().min(1, 'emoji requis').max(128),
  roleId: discordIdSchema,
});

/** Page Reaction Roles : liste (salon, message, emoji, rôle), ajout avec réaction du bot, suppression. */
export function createReactionRolesRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/reaction-roles`;

  router.get(
    '/reaction-roles',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const [rows, autoroles, menus, notifications] = await Promise.all([roleService.listReactionRoles(guild.id), roleService.listAutoRoles(guild.id), roleService.listRoleMenus(guild.id), roleService.listNotificationRoles(guild.id)]);
      const byMessage = new Map<string, typeof rows>();
      for (const r of rows) byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r]);
      render(res, 'reactionroles', {
        title: 'Reaction roles',
        page: 'roles',
        crumbs: [{ label: 'Reaction roles' }],
        counts: { autoroles: autoroles.length, menus: menus.length, notifications: notifications.length, reactions: rows.length },
        groups: [...byMessage.entries()].map(([messageId, items]) => ({ messageId, channelId: items[0]!.channelId, items })),
        total: rows.length,
        roleName: (id: string) => guild.roles.find((r) => r.id === id)?.name ?? id,
        channelName: (id: string) => guild.textChannels.find((c) => c.id === id)?.name ?? id,
        moduleEnabled: res.locals.config!.modules.reactionrole,
      });
    }),
  );

  router.post(
    '/reaction-roles',
    validate({ body: addBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guildView = res.locals.guild!;
        const { body } = valid<z.infer<typeof addBody>>(req);
        const role = guildView.roles.find((r) => r.id === body.roleId);
        if (!role) throw new HttpError(400, 'Rôle inconnu.');
        if (role.managed) throw new HttpError(400, 'Ce rôle est géré par une intégration et ne peut pas être attribué.');
        if (!guildView.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        const emoji = parseEmojiInput(body.emoji);
        if (!emoji) throw new HttpError(400, 'Emoji invalide : utilisez un emoji Unicode ou un emoji personnalisé (<:nom:id>).');
        const guild = requireBotGuild(client, guildView.id);
        const channel = guild.channels.cache.get(body.channelId);
        if (!channel || !channel.isTextBased()) throw new HttpError(400, 'Salon introuvable côté bot.');
        const message = await channel.messages.fetch(body.messageId).catch(() => null);
        if (!message) throw new HttpError(400, 'Message introuvable dans ce salon : vérifiez l’ID et les permissions du bot.');
        await message.react(emoji).catch(() => {
          throw new HttpError(400, 'Impossible de réagir avec cet emoji (emoji inconnu ou permissions manquantes).');
        });
        await roleService.addReactionRole({ guildId: guildView.id, channelId: body.channelId, messageId: body.messageId, emoji, roleId: body.roleId });
        broadcastToGuild(guildView.id, 'roles:update', { guildId: guildView.id, kind: 'reaction' });
        flash(req, 'success', `Reaction role ajouté : ${body.emoji} → ${role.name}.`);
      },
    ),
  );

  router.post(
    '/reaction-roles/:reactionId(\\d+)/delete',
    validate({ params: idParams }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const [rows, autoroles, menus, notifications] = await Promise.all([roleService.listReactionRoles(guild.id), roleService.listAutoRoles(guild.id), roleService.listRoleMenus(guild.id), roleService.listNotificationRoles(guild.id)]);
        if (!rows.some((r) => r.id === params.reactionId)) throw new HttpError(404, 'Reaction role introuvable.');
        await roleService.removeReactionRole({ id: params.reactionId });
        broadcastToGuild(guild.id, 'roles:update', { guildId: guild.id, kind: 'reaction' });
        flash(req, 'success', 'Reaction role supprimé (la réaction reste sur le message).');
      },
    ),
  );

  return router;
}
