import { Router } from 'express';
import { z } from 'zod';
import { GuildKind, TranslationMode, type Prisma } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { prisma } from '../../../src/database/client';
import { guildConfigService } from '../../../src/services/GuildConfigService';
import { loggingService } from '../../../src/services/LoggingService';
import { invalidateCommandPermissions } from '../../../src/events/interactionCreate';
import { LANGUAGE_CODES, MODULE_KEYS, MODULE_LABELS, GUILD_KIND_LABELS, LANGUAGES } from '../../../src/config/constants';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { validate, valid, stringArray, discordIdArray, hexColorSchema, optionalText, checkbox } from '../../lib/validate';
import { toggleModuleHandler } from './modules';

const languageCode = z.enum(LANGUAGE_CODES as [string, ...string[]]);

const settingsBody = z.object({
  kind: z.nativeEnum(GuildKind),
  displayName: optionalText(100),
  defaultLanguage: languageCode,
  enabledLanguages: stringArray.pipe(z.array(languageCode).min(1, 'activez au moins une langue')),
  brandColor: hexColorSchema,
  adminRoleIds: discordIdArray,
  staffRoleIds: discordIdArray,
  translationMode: z.nativeEnum(TranslationMode),
  autoTranslate: checkbox,
  languageChannels: z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.record(z.string(), z.string())).transform((map) => {
    const out: Record<string, string> = {};
    for (const [lang, channelId] of Object.entries(map)) if (LANGUAGE_CODES.includes(lang) && /^\d{15,22}$/.test(channelId)) out[lang] = channelId;
    return out;
  }),
  footerText: optionalText(200),
  footerIconUrl: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().url('URL invalide').max(500).nullable().optional()),
  timezone: z.string().trim().min(1).max(64).default('Europe/Paris'),
});

const commandsBody = z.object({
  perms: z
    .preprocess(
      (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
      z.record(
        z.string().regex(/^[\w-]{1,64}$/),
        z.object({ enabled: z.union([z.string(), z.array(z.string())]).optional(), roleIds: discordIdArray }).passthrough(),
      ),
    )
    .default({}),
});

/** GET/POST /guilds/:guildId/settings (+ modules + permissions de commandes). */
export function createSettingsRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/settings',
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const permRows = await prisma.commandPermission.findMany({ where: { guildId: guild.id } });
      const permMap = new Map(permRows.map((r) => [r.commandName, { roleIds: Array.isArray(r.roleIds) ? (r.roleIds as string[]) : [], enabled: r.enabled }]));
      const commands = [...client.commands.values()]
        .map((cmd) => ({
          name: cmd.data.name,
          description: cmd.data.description,
          category: cmd.category ?? 'autre',
          module: cmd.module ?? null,
          moduleLabel: cmd.module ? MODULE_LABELS[cmd.module] : null,
          internal: cmd.permissions?.internal ?? 'everyone',
          enabled: permMap.get(cmd.data.name)?.enabled ?? true,
          roleIds: permMap.get(cmd.data.name)?.roleIds ?? [],
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      const tab = typeof req.query.tab === 'string' && ['general', 'modules', 'commands'].includes(req.query.tab) ? req.query.tab : 'general';
      render(res, 'settings', {
        title: 'Paramètres',
        page: 'settings',
        tab,
        kinds: Object.entries(GUILD_KIND_LABELS).map(([value, label]) => ({ value, label })),
        languages: LANGUAGES,
        modules: MODULE_KEYS.map((key) => ({ key, label: MODULE_LABELS[key], enabled: config.modules[key] })),
        commands,
        settings: config.raw.settings,
      });
    }),
  );

  router.post(
    '/settings',
    validate({ body: settingsBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { body } = valid<z.infer<typeof settingsBody>>(req);
      const enabledLanguages = body.enabledLanguages.includes(body.defaultLanguage) ? body.enabledLanguages : [body.defaultLanguage, ...body.enabledLanguages];
      const data: Prisma.GuildSettingsUpdateInput = {
        displayName: body.displayName ?? null,
        defaultLanguage: body.defaultLanguage,
        enabledLanguages,
        brandColor: body.brandColor,
        adminRoleIds: body.adminRoleIds,
        staffRoleIds: body.staffRoleIds,
        translationMode: body.translationMode,
        autoTranslate: body.autoTranslate,
        languageChannels: body.languageChannels,
        footerText: body.footerText ?? null,
        footerIconUrl: body.footerIconUrl ?? null,
        timezone: body.timezone,
      };
      if (body.kind !== config.kind) await guildConfigService.setKind(guild.id, body.kind);
      await guildConfigService.updateSettings(guild.id, data);
      void loggingService.log({ guildId: guild.id, category: 'SYSTEM', action: 'settings.update', title: 'Paramètres mis à jour depuis le dashboard', actorId: req.session.user?.id ?? null, data: { kind: body.kind, defaultLanguage: body.defaultLanguage, enabledLanguages, translationMode: body.translationMode } });
      flash(req, 'success', 'Paramètres enregistrés.');
      res.redirect(`/guilds/${guild.id}/settings`);
    }),
  );

  router.post('/modules/:key', toggleModuleHandler(client));

  router.post(
    '/commands',
    validate({ body: commandsBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { body } = valid<z.infer<typeof commandsBody>>(req);
      const known = new Set(client.commands.keys());
      let changed = 0;
      for (const name of known) {
        const entry = body.perms[name];
        const enabled = entry ? entry.enabled !== undefined : false;
        const roleIds = entry ? [...new Set(entry.roleIds)] : [];
        const isDefault = enabled && roleIds.length === 0;
        if (isDefault) {
          const { count } = await prisma.commandPermission.deleteMany({ where: { guildId: guild.id, commandName: name } });
          changed += count;
        } else {
          await prisma.commandPermission.upsert({
            where: { guildId_commandName: { guildId: guild.id, commandName: name } },
            create: { guildId: guild.id, commandName: name, roleIds, enabled },
            update: { roleIds, enabled },
          });
          changed++;
        }
      }
      invalidateCommandPermissions(guild.id);
      void loggingService.log({ guildId: guild.id, category: 'SYSTEM', action: 'commands.permissions', title: 'Permissions des commandes mises à jour', actorId: req.session.user?.id ?? null, data: { changed } });
      flash(req, 'success', 'Permissions des commandes enregistrées.');
      res.redirect(`/guilds/${guild.id}/settings?tab=commands`);
    }),
  );

  return router;
}
