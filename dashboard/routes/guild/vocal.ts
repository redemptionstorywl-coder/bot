import { Router } from 'express';
import { PermissionsBitField } from 'discord.js';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import {
  CUSTOM_PRESET,
  DEFAULT_LOBBY_ID,
  MAX_LOBBIES,
  MAX_RULES,
  MAX_USER_LIMIT,
  VOICE_LANGUAGE_PRESETS,
  missingBotPermissions,
  tempVoiceService,
  voiceNameRuleSchema,
  voiceRuleSchema,
} from '../../../src/services/TempVoiceService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, checkbox, discordIdArray, optionalDiscordId } from '../../lib/validate';
import { jsonArray } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { resolveUserProfiles } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

/** Règle de langue saisie (liste dynamique) : preset vide → personnalisé. */
const ruleInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const r = v as Record<string, unknown>;
  return { roleId: trimmed(r.roleId), preset: trimmed(r.preset) || CUSTOM_PRESET, emoji: trimmed(r.emoji) ?? '', template: trimmed(r.template) };
}, voiceRuleSchema);

const configBody = z.object({
  lobbyIds: discordIdArray,
  categoryId: optionalDiscordId,
  userLimit: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().min(0).max(MAX_USER_LIMIT).nullable()),
  rulesJson: jsonArray(ruleInput, MAX_RULES),
  fallbackPreset: z.preprocess((v) => trimmed(v) || CUSTOM_PRESET, z.string().max(16)),
  fallbackEmoji: z.preprocess((v) => trimmed(v) ?? '', z.string()),
  fallbackTemplate: z.preprocess(trimmed, z.string()),
  ownerPermissions: checkbox,
  transferOwnership: checkbox,
});

/** Page « Salons vocaux » : lobbies « Créer un salon », règles de langue (aperçu des noms), salons temporaires actifs. */
export function createVocalRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/vocal`;

  router.get(
    '/vocal',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const discordGuild = client.guilds.cache.get(guild.id) ?? null;
      const settings = await tempVoiceService.getConfig(guild.id);
      const lobbyIds = settings.configured ? settings.lobbyIds : guild.voiceChannels.some((c) => c.id === DEFAULT_LOBBY_ID) ? [DEFAULT_LOBBY_ID] : [];
      const active = await tempVoiceService.listActive(guild.id, discordGuild);
      const profiles = await resolveUserProfiles(client, guild.id, active.map((a) => a.ownerId));
      const me = discordGuild?.members.me ?? null;
      const missing = me ? missingBotPermissions(me.permissions) : [];
      render(res, 'vocal', {
        title: 'Salons vocaux',
        page: 'vocal',
        scripts: ['vocal'],
        settings,
        lobbyIds,
        defaultLobby: !settings.configured && lobbyIds.length > 0,
        missingLobbies: settings.lobbyIds.filter((id) => !guild.voiceChannels.some((c) => c.id === id)),
        presets: VOICE_LANGUAGE_PRESETS.map(({ key, label, emoji, template }) => ({ key, label, emoji, template })),
        active: active.filter((a) => a.exists),
        profiles,
        missingPermissions: missing.length ? new PermissionsBitField(missing.reduce((a, b) => a | b, 0n)).toArray() : [],
        limits: { lobbies: MAX_LOBBIES, rules: MAX_RULES, userLimit: MAX_USER_LIMIT },
        moduleEnabled: config.modules.vocal,
      });
    }),
  );

  router.post(
    '/vocal/config',
    validate({ body: configBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof configBody>>(req);
        const lobbyIds = [...new Set(body.lobbyIds)];
        if (lobbyIds.length > MAX_LOBBIES) throw new HttpError(400, `${MAX_LOBBIES} salons lobby au maximum.`);
        for (const id of lobbyIds) if (!guild.voiceChannels.some((c) => c.id === id && c.type === 'voice')) throw new HttpError(400, 'Salon lobby inconnu (choisissez un salon vocal du serveur).');
        if (body.categoryId && !guild.categories.some((c) => c.id === body.categoryId)) throw new HttpError(400, 'Catégorie inconnue.');
        const roles = body.rulesJson.map((r) => r.roleId);
        for (const roleId of roles) if (!guild.roles.some((r) => r.id === roleId)) throw new HttpError(400, 'Rôle inconnu dans les règles de langue.');
        if (new Set(roles).size !== roles.length) throw new HttpError(400, 'Un rôle ne peut avoir qu’une seule règle de langue.');
        const fallback = voiceNameRuleSchema.safeParse({ preset: body.fallbackPreset, emoji: body.fallbackEmoji, template: body.fallbackTemplate });
        if (!fallback.success) throw new HttpError(400, 'Règle de repli invalide : le modèle doit contenir {name} (90 caractères max) et l’emoji être un emoji Unicode.');
        await tempVoiceService.updateConfig(guild.id, {
          lobbyIds,
          categoryId: body.categoryId,
          userLimit: body.userLimit,
          rules: body.rulesJson,
          fallback: fallback.data,
          ownerPermissions: body.ownerPermissions,
          transferOwnership: body.transferOwnership,
        });
        broadcastToGuild(guild.id, 'vocal:update', { guildId: guild.id, action: 'config' });
        flash(req, 'success', `Salons vocaux enregistrés : ${lobbyIds.length} lobby(s), ${body.rulesJson.length} règle(s) de langue.`);
      },
    ),
  );

  return router;
}
